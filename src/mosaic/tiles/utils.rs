use std::collections::{BTreeMap, HashMap};
use std::ops::Div;
use std::path::{Path, PathBuf};
use std::sync::{Once, OnceLock, RwLock};
use std::time::UNIX_EPOCH;

use ::image::imageops;
use ::image::Rgb;
use exif::In;
use exif::Tag;
use image::error::LimitError;
use image::imageops::FilterType;
use image::DynamicImage;
use num_integer::Roots;
use serde::{Deserialize, Serialize};
use std::ops::Deref;

use crate::mosaic::error::ImageError;

/// Flip coordinates horizontally for tile flipping operations.
pub fn flipped_coords<A, const N: usize>(coords: &mut [A; N]) {
    // coords is a flattened array of pixel rows for a square image.
    // The first 3 items correspond to the first pixel of the first row, the next 3 to the second pixel, etc.
    // In total there are N/3 pixels and sqrt(N/3) rows
    // We want to flip the pixels in each row to get an horizontally flipped image

    // For 3 rows, there are 9 pixels and 27 coordinates
    // For 4 rows there are 16 pixels and 48 coordinates

    let rows = N.div_euclid(3).sqrt();
    let cols = rows;
    let coords_in_row = cols * 3;

    // We iterate over the rows
    for i in 0..rows {
        // We iterate over the pixels in the row
        for j in 0..cols.div_euclid(2) {
            // swap with the mirror column
            let start = i * coords_in_row + j * 3;
            let start_flipped = (i + 1) * coords_in_row - (j + 1) * 3;
            for h in 0..3 {
                coords.swap(start + h, start_flipped + h);
            }
        }
    }
}

/// Schema version for the per-tile cache filename. Bump this whenever the
/// preprocessing logic in `prepare_tile` changes in a way that should
/// invalidate previously-cached entries (white-trim threshold, EXIF rotation
/// handling, resize filter, output format, etc.).
///
/// The value is embedded in the cache filename as `.v<N>.`. Old entries
/// from prior versions are simply ignored on lookup.
const PREPARE_TILE_CACHE_VERSION: u32 = 2;

/// Prepare a tile image by resizing, cropping, and caching it, and extract date information.
pub fn prepare_tile_with_date(
    path: &Path,
    tile_size: u32,
    crop: bool,
    force: bool,
) -> Result<
    (
        ::image::ImageBuffer<::image::Rgb<u8>, Vec<u8>>,
        Option<String>,
    ),
    ImageError,
> {
    // Try EXIF date first, then fall back to extracting year from file path
    let date_taken = get_exif_date(path).or_else(|| get_year_from_path(path));
    let image = prepare_tile(path, tile_size, crop, force)?;
    Ok((image, date_taken))
}

/// Prepare a tile image by resizing, cropping, and caching it.
///
/// When `force` is true, the on-disk cache entry is bypassed (but still overwritten
/// with the freshly-prepared image). Use this to invalidate stale cache entries after
/// modifying tile contents in place.
///
/// The on-disk cache is treated as a best-effort optimization: if the cache directory
/// can't be located or written to, a one-shot warning is emitted to stderr and the
/// function still returns the prepared tile.
pub fn prepare_tile(
    path: &Path,
    tile_size: u32,
    crop: bool,
    force: bool,
) -> Result<::image::ImageBuffer<::image::Rgb<u8>, Vec<u8>>, ImageError> {
    // === Fast path: try to skip reading the full file when (path, mtime, size)
    //                still matches an indexed (md5, cache file) pair.
    if !force {
        if let Some(meta_key) = metadata_key(path) {
            if let Some(known_md5) = lookup_index(path, &meta_key) {
                if let Some(cache_path) = cache_path_for(known_md5, crop, tile_size) {
                    if let Ok(img) = ::image::open(&cache_path) {
                        return Ok(img.to_rgb8());
                    }
                    // Local miss for an indexed entry: try S3 before falling
                    // through to the slow path's full file read + hash.
                    if try_s3_pull(&known_md5, crop, tile_size, &cache_path) {
                        if let Ok(img) = ::image::open(&cache_path) {
                            return Ok(img.to_rgb8());
                        }
                    }
                }
            }
        }
    }

    // === Slow path: read full bytes, hash, and (re)populate the index.
    let bytes = std::fs::read(path).map_err(|e| ImageError {
        path: path.to_owned(),
        error: e.into(),
    })?;
    let content_hash = md5::compute(&bytes);
    if let Some(meta_key) = metadata_key(path) {
        update_index(path, meta_key, content_hash.0);
    }

    let cache_paths: Option<(PathBuf, PathBuf)> = dirs::cache_dir().map(|d| {
        let cache_dir = d.join("mosaic");
        let cache_path = cache_dir.join(format!(
            "{:x}{}.v{}.{}.png",
            content_hash,
            if crop { "_cropped" } else { "" },
            PREPARE_TILE_CACHE_VERSION,
            tile_size
        ));
        (cache_dir, cache_path)
    });
    if cache_paths.is_none() {
        warn_once_no_cache_dir();
    }
    // check if the cache path exists and load it, otherwise resize and save it
    let cached_img: Result<::image::ImageBuffer<_, _>, _> = if force {
        Err(ImageError {
            path: path.to_owned(),
            error: ::image::ImageError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                "force",
            )),
        })
    } else if let Some((_, cache_path)) = &cache_paths {
        let local = ::image::open(cache_path).map(|img| img.to_rgb8());
        if local.is_ok() {
            local.map_err(|e| ImageError {
                path: path.to_owned(),
                error: e,
            })
        } else if try_s3_pull(&content_hash.0, crop, tile_size, cache_path) {
            ::image::open(cache_path)
                .map_err(|e| ImageError {
                    path: path.to_owned(),
                    error: e,
                })
                .map(|img| img.to_rgb8())
        } else {
            Err(ImageError {
                path: path.to_owned(),
                error: ::image::ImageError::IoError(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "local cache miss; S3 miss or disabled",
                )),
            })
        }
    } else {
        Err(ImageError {
            path: path.to_owned(),
            error: ::image::ImageError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                "no cache dir",
            )),
        })
    };
    cached_img.or_else(|_| {
        let mut tile_img = ::image::open(path)
            .map_err(|e| ImageError {
                path: path.to_owned(),
                error: e,
            })?
            .to_rgb8();
        // Crop all the white pixels from the edges
        let is_white_pixel = |pixel: &Rgb<u8>| pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240;

        let w = tile_img.width();
        let h = tile_img.height();

        if w < tile_size || h < tile_size {
            return Err(ImageError {
                path: path.to_owned(),
                error: ::image::ImageError::Limits(LimitError::from_kind(
                    image::error::LimitErrorKind::DimensionError,
                )),
            });
        }

        let from_left: Vec<u32> = (0..h)
            .map(|y| {
                (0..w)
                    .find(|x| {
                        let pixel = tile_img.get_pixel(*x, y);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(w)
            })
            .collect();

        let from_right: Vec<u32> = from_left
            .iter()
            .enumerate()
            .map(|(y, x)| {
                (*x..w)
                    .rev()
                    .find(|x| {
                        let pixel = tile_img.get_pixel(*x, y as u32);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(0)
            })
            .collect();

        let from_top: Vec<u32> = (0..w)
            .map(|x| {
                (0..h)
                    .find(|y| {
                        let pixel = tile_img.get_pixel(x, *y);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(h)
            })
            .collect();

        let from_bottom: Vec<u32> = from_top
            .iter()
            .enumerate()
            .map(|(x, y)| {
                (*y..h)
                    .rev()
                    .find(|y| {
                        let pixel = tile_img.get_pixel(x as u32, *y);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(0)
            })
            .collect();

        let first_non_white_col = most_common_value(from_left.into_iter().filter(|x| *x != w));
        let last_non_white_col = most_common_value(from_right.into_iter().filter(|x| *x != 0));
        let first_non_white_row = most_common_value(from_top.into_iter().filter(|x| *x != h));
        let last_non_white_row = most_common_value(from_bottom.into_iter().filter(|x| *x != 0));

        assert!(first_non_white_col < last_non_white_col);
        assert!(first_non_white_row < last_non_white_row);

        let w = last_non_white_col - first_non_white_col;
        let h = last_non_white_row - first_non_white_row;

        let mut tile_img = imageops::crop(
            &mut tile_img,
            first_non_white_col,
            first_non_white_row,
            w,
            h,
        );
        if crop {
            // tiles must be square, so get the largest square that fits inside the image
            let size = w.min(h);
            let x0 = (w - size).div(2);
            let y0 = (h - size).div(2);
            tile_img.change_bounds(
                first_non_white_col + x0,
                first_non_white_row + y0,
                size,
                size,
            );
        }

        let tile_img =
            imageops::resize(tile_img.deref(), tile_size, tile_size, FilterType::Lanczos3);
        let orientation = get_jpeg_orientation(path).unwrap_or(1);
        let tile_img = rotate(tile_img.into(), orientation);
        if let Some((cache_dir, cache_path)) = &cache_paths {
            if let Err(e) = std::fs::create_dir_all(cache_dir)
                .and_then(|_| tile_img.save(cache_path).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)))
            {
                warn_once_cache_write_failed(cache_dir, &e);
            } else {
                // Best-effort write-through to S3; never fatal.
                try_s3_push(&content_hash.0, crop, tile_size, cache_path);
            }
        }
        Ok(tile_img.into())
    })
}

static WARN_NO_CACHE_DIR: Once = Once::new();
static WARN_CACHE_WRITE: Once = Once::new();
static WARN_INDEX_LOAD: Once = Once::new();
static WARN_INDEX_WRITE: Once = Once::new();

fn warn_once_no_cache_dir() {
    WARN_NO_CACHE_DIR.call_once(|| {
        eprintln!(
            "⚠️  Cache disabled: dirs::cache_dir() returned None. \
             Tiles will be re-prepared on every invocation."
        );
    });
}

fn warn_once_cache_write_failed(cache_dir: &Path, err: &std::io::Error) {
    WARN_CACHE_WRITE.call_once(|| {
        eprintln!(
            "⚠️  Cache write failed at {}: {}. \
             Tile preparation will continue without caching for this run.",
            cache_dir.display(),
            err
        );
    });
}

// ===== Metadata fast-path index =====
//
// A small sidecar at `<cache_dir>/mosaic/index.bin` maps tile path → (mtime,
// size, md5). It lets prepare_tile skip the full-file read+MD5 on subsequent
// runs when the file hasn't changed. The index is purely an optimization;
// every code path still works correctly without it.

#[derive(Serialize, Deserialize, Clone, Copy)]
struct IndexEntry {
    mtime: u64,
    size: u64,
    md5: [u8; 16],
}

type IndexMap = BTreeMap<PathBuf, IndexEntry>;

static INDEX: OnceLock<RwLock<IndexMap>> = OnceLock::new();

fn index_path() -> Option<PathBuf> {
    dirs::cache_dir().map(|d| d.join("mosaic").join("index.bin"))
}

fn cache_path_for(md5: [u8; 16], crop: bool, tile_size: u32) -> Option<PathBuf> {
    dirs::cache_dir().map(|d| {
        d.join("mosaic").join(format!(
            "{}{}.v{}.{}.png",
            hex_md5(&md5),
            if crop { "_cropped" } else { "" },
            PREPARE_TILE_CACHE_VERSION,
            tile_size
        ))
    })
}

fn hex_md5(bytes: &[u8; 16]) -> String {
    let mut s = String::with_capacity(32);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn metadata_key(path: &Path) -> Option<(u64, u64)> {
    let m = std::fs::metadata(path).ok()?;
    let mtime = m
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some((mtime, m.len()))
}

fn get_index() -> &'static RwLock<IndexMap> {
    INDEX.get_or_init(|| {
        let map = match index_path() {
            Some(p) => match std::fs::read(&p) {
                Ok(bytes) => bincode::deserialize::<IndexMap>(&bytes).unwrap_or_else(|_| {
                    WARN_INDEX_LOAD.call_once(|| {
                        eprintln!(
                            "⚠️  Tile index at {} could not be deserialized, starting fresh.",
                            p.display()
                        );
                    });
                    IndexMap::new()
                }),
                Err(_) => IndexMap::new(),
            },
            None => IndexMap::new(),
        };
        RwLock::new(map)
    })
}

fn lookup_index(path: &Path, key: &(u64, u64)) -> Option<[u8; 16]> {
    let idx = get_index().read().ok()?;
    idx.get(path)
        .filter(|e| e.mtime == key.0 && e.size == key.1)
        .map(|e| e.md5)
}

fn update_index(path: &Path, key: (u64, u64), md5: [u8; 16]) {
    if let Ok(mut idx) = get_index().write() {
        idx.insert(
            path.to_owned(),
            IndexEntry {
                mtime: key.0,
                size: key.1,
                md5,
            },
        );
    }
}

// ===== Optional S3-backed Cache 1 =====
//
// When `EMOSAIC_S3_CACHE_BUCKET` is set, a remote layer sits behind the
// local per-tile cache. Read flow on local miss: try S3 GET → write bytes
// to the local cache path → caller decodes from disk. Write flow: after
// the local cache write succeeds, also PUT to S3.
//
// All S3 operations are best-effort. Errors emit a one-shot warning and
// fall through to the existing local-only behavior — the binary never
// fails because S3 is misbehaving.

struct S3Handle {
    runtime: tokio::runtime::Runtime,
    client: aws_sdk_s3::Client,
    bucket: String,
    prefix: String,
}

static S3_HANDLE: OnceLock<Option<S3Handle>> = OnceLock::new();
static WARN_S3_INIT: Once = Once::new();
static WARN_S3_PULL: Once = Once::new();
static WARN_S3_PUSH: Once = Once::new();

fn s3_handle() -> Option<&'static S3Handle> {
    S3_HANDLE
        .get_or_init(|| {
            let bucket = std::env::var("EMOSAIC_S3_CACHE_BUCKET")
                .ok()
                .filter(|s| !s.is_empty())?;
            let prefix = std::env::var("EMOSAIC_S3_CACHE_PREFIX")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "cache/v2/".to_string());
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    WARN_S3_INIT.call_once(|| {
                        eprintln!("⚠️  S3 cache disabled: tokio runtime init failed: {}", e);
                    });
                    return None;
                }
            };
            let config = runtime.block_on(
                aws_config::defaults(aws_config::BehaviorVersion::latest()).load(),
            );
            let client = aws_sdk_s3::Client::new(&config);
            Some(S3Handle {
                runtime,
                client,
                bucket,
                prefix,
            })
        })
        .as_ref()
}

fn s3_key(prefix: &str, md5: &[u8; 16], crop: bool, tile_size: u32) -> String {
    format!(
        "{}{}{}.v{}.{}.png",
        prefix,
        hex_md5(md5),
        if crop { "_cropped" } else { "" },
        PREPARE_TILE_CACHE_VERSION,
        tile_size
    )
}

/// Try to populate `local_path` from S3. Returns true on success.
/// Any error (including bucket disabled, NoSuchKey, network) returns false.
fn try_s3_pull(md5: &[u8; 16], crop: bool, tile_size: u32, local_path: &Path) -> bool {
    let h = match s3_handle() {
        Some(h) => h,
        None => return false,
    };
    let key = s3_key(&h.prefix, md5, crop, tile_size);
    let bytes_result = h.runtime.block_on(async {
        let resp = h
            .client
            .get_object()
            .bucket(&h.bucket)
            .key(&key)
            .send()
            .await
            .ok()?;
        resp.body.collect().await.ok().map(|b| b.into_bytes())
    });
    let bytes = match bytes_result {
        Some(b) => b,
        None => return false,
    };
    if let Some(parent) = local_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(local_path, &bytes) {
        Ok(()) => true,
        Err(e) => {
            WARN_S3_PULL.call_once(|| {
                eprintln!(
                    "⚠️  S3 cache: pulled {} but couldn't write {}: {}",
                    key,
                    local_path.display(),
                    e
                );
            });
            false
        }
    }
}

/// Best-effort PUT of `local_path` contents to S3. Failures are logged once.
fn try_s3_push(md5: &[u8; 16], crop: bool, tile_size: u32, local_path: &Path) {
    let h = match s3_handle() {
        Some(h) => h,
        None => return,
    };
    let key = s3_key(&h.prefix, md5, crop, tile_size);
    let bytes = match std::fs::read(local_path) {
        Ok(b) => b,
        Err(_) => return,
    };
    let res = h.runtime.block_on(async {
        h.client
            .put_object()
            .bucket(&h.bucket)
            .key(&key)
            .body(bytes.into())
            .content_type("image/png")
            .send()
            .await
    });
    if let Err(e) = res {
        WARN_S3_PUSH.call_once(|| {
            eprintln!("⚠️  S3 cache PUT failed for {}: {}", key, e);
        });
    }
}

/// Persist the in-memory tile index to disk. Best-effort; failures emit a
/// one-shot warning. Call this once near process exit (after rendering).
pub fn persist_tile_index() {
    let p = match index_path() {
        Some(p) => p,
        None => return,
    };
    let idx = match get_index().read() {
        Ok(g) => g,
        Err(_) => return,
    };
    if idx.is_empty() {
        return;
    }
    let bytes = match bincode::serialize(&*idx) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&p, bytes) {
        WARN_INDEX_WRITE.call_once(|| {
            eprintln!(
                "⚠️  Could not persist tile index to {}: {}.",
                p.display(),
                e
            );
        });
    }
}

fn get_jpeg_orientation(file_path: &Path) -> Result<u32, exif::Error> {
    let file = std::fs::File::open(file_path).expect("problem opening the file");
    let mut bufreader = std::io::BufReader::new(&file);
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut bufreader)?;
    let orientation: u32 = match exif.get_field(Tag::Orientation, In::PRIMARY) {
        Some(orientation) => match orientation.value.get_uint(0) {
            Some(v @ 1..=8) => v,
            _ => 1,
        },
        None => 1,
    };

    Ok(orientation)
}

/// Extract EXIF date information from an image file.
fn get_exif_date(file_path: &Path) -> Option<String> {
    let file = std::fs::File::open(file_path).ok()?;
    let mut bufreader = std::io::BufReader::new(&file);
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut bufreader).ok()?;

    // Try different date tags in order of preference
    let date_tags = [Tag::DateTimeOriginal, Tag::DateTime, Tag::DateTimeDigitized];

    for tag in date_tags.iter() {
        if let Some(field) = exif.get_field(*tag, In::PRIMARY) {
            if let exif::Value::Ascii(values) = &field.value {
                if let Some(first_value) = values.first() {
                    // Convert bytes to string, handling potential encoding issues
                    return String::from_utf8(first_value.to_vec())
                        .ok()
                        .map(|s| s.trim_end_matches('\0').to_string())
                        .map(|s| {
                            // Extract only the date part, remove time if present
                            if let Some(space_pos) = s.find(' ') {
                                s[..space_pos].to_string()
                            } else {
                                s
                            }
                        });
                }
            }
        }
    }

    None
}

/// Extract year from file path as a fallback when EXIF date is not available.
///
/// Looks for 4-digit years (1900-2099) in the file path, checking:
/// 1. Directory names (e.g., "/photos/2023/vacation/photo.jpg")
/// 2. Filename patterns (e.g., "2023-01-15.jpg", "photo_2023.jpg")
///
/// Returns the year in EXIF-like format "YYYY:01:01" if found.
fn get_year_from_path(file_path: &Path) -> Option<String> {
    let path_str = file_path.to_string_lossy();

    // Regex to find 4-digit years between 1900-2099
    // Look for years that are either at boundaries or surrounded by non-digits
    let year_pattern = regex::Regex::new(r"(?:^|[^0-9])(19[0-9]{2}|20[0-9]{2})(?:[^0-9]|$)").ok()?;

    // Find all year matches in the path
    let mut years: Vec<i32> = year_pattern
        .captures_iter(&path_str)
        .filter_map(|cap| cap.get(1))
        .filter_map(|m| m.as_str().parse::<i32>().ok())
        .collect();

    // Sort and take the most recent year (likely to be the photo year)
    years.sort();
    years.last().map(|year| format!("{}:01:01", year))
}

fn rotate(mut img: DynamicImage, orientation: u32) -> DynamicImage {
    let rgba = img.color().has_alpha();
    img = match orientation {
        2 => DynamicImage::ImageRgba8(imageops::flip_horizontal(&img)),
        3 => DynamicImage::ImageRgba8(imageops::rotate180(&img)),
        4 => DynamicImage::ImageRgba8(imageops::flip_vertical(&img)),
        5 => DynamicImage::ImageRgba8(imageops::flip_horizontal(&imageops::rotate90(&img))),
        6 => DynamicImage::ImageRgba8(imageops::rotate90(&img)),
        7 => DynamicImage::ImageRgba8(imageops::flip_horizontal(&imageops::rotate270(&img))),
        8 => DynamicImage::ImageRgba8(imageops::rotate270(&img)),
        _ => img,
    };
    if !rgba {
        img = DynamicImage::ImageRgb8(img.into_rgb8());
    }
    img
}

fn most_common_value(values: impl Iterator<Item = u32>) -> u32 {
    let most_common = values
        .fold(HashMap::new(), |mut acc, x| {
            *acc.entry(x).or_insert(0) += 1;
            acc
        })
        .into_iter()
        .max_by_key(|&(_, count)| count)
        .unwrap_or((0, 0))
        .0;
    most_common
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_most_common_value() {
        let values = vec![1, 2, 2, 3, 3, 3, 4];
        let most_common = most_common_value(values.into_iter());
        assert_eq!(most_common, 3);
    }

    #[test]
    fn test_prepare_tile() {
        let path = Path::new("example/warhol.png");
        let tile_size = 32;
        let result = prepare_tile(path, tile_size, true, false);
        assert!(result.is_ok());
        let tile_img = result.unwrap();
        assert_eq!(tile_img.width(), tile_size);
        assert_eq!(tile_img.height(), tile_size);
    }

    #[test]
    fn test_flipped_coords() {
        let mut coords = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        flipped_coords(&mut coords);
        assert_eq!(coords, [4, 5, 6, 1, 2, 3, 10, 11, 12, 7, 8, 9]);
        flipped_coords(&mut coords);
        assert_eq!(coords, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }

    #[test]
    fn test_exif_date_extraction() {
        // Test the date extraction logic (simulating what happens in get_exif_date)
        let full_datetime = "2003:03:19 11:44:30\0";
        let trimmed = full_datetime.trim_end_matches('\0').to_string();
        let date_only = if let Some(space_pos) = trimmed.find(' ') {
            trimmed[..space_pos].to_string()
        } else {
            trimmed
        };
        assert_eq!(date_only, "2003:03:19");
        
        // Test date-only input (no time part)
        let date_only_input = "2003:03:19";
        let result = if let Some(space_pos) = date_only_input.find(' ') {
            date_only_input[..space_pos].to_string()
        } else {
            date_only_input.to_string()
        };
        assert_eq!(result, "2003:03:19");
    }

    #[test]
    fn test_get_year_from_path() {
        // Test directory structure with year
        let path = Path::new("/photos/2023/vacation/photo.jpg");
        assert_eq!(get_year_from_path(path), Some("2023:01:01".to_string()));

        // Test filename with year
        let path = Path::new("/photos/IMG_2019_summer.jpg");
        assert_eq!(get_year_from_path(path), Some("2019:01:01".to_string()));

        // Test multiple years - should return the most recent
        let path = Path::new("/backup/2020/photos_from_2021/image.jpg");
        assert_eq!(get_year_from_path(path), Some("2021:01:01".to_string()));

        // Test no year in path
        let path = Path::new("/photos/vacation/beach.jpg");
        assert_eq!(get_year_from_path(path), None);

        // Test year at start of filename
        let path = Path::new("2022-01-15-photo.jpg");
        assert_eq!(get_year_from_path(path), Some("2022:01:01".to_string()));

        // Test year shouldn't match random 4-digit numbers like image dimensions
        // 1920 is a valid year though, so let's test with something clearly not a year
        let path = Path::new("/photos/IMG_0001.jpg");
        assert_eq!(get_year_from_path(path), None);
    }
}
