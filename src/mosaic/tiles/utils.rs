use std::cell::Cell;
use std::collections::{BTreeMap, HashMap};
use std::ops::Div;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Once, OnceLock, RwLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

use ::image::imageops;
use ::image::Rgb;
use exif::In;
use exif::Tag;
use image::error::LimitError;
use image::imageops::FilterType;
use image::DynamicImage;
use num_integer::Roots;
use std::ops::Deref;

use crate::mosaic::error::ImageError;
use crate::mosaic::tiles::source::TileLocator;

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
///
/// For Local sources the date is read from EXIF (or falls back to year-in-path).
/// For S3 sources we skip the EXIF probe (would require an extra GetObject) and
/// rely solely on the year-in-path heuristic against the S3 key.
pub fn prepare_tile_with_date(
    locator: TileLocator<'_>,
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
    let date_taken = match locator {
        TileLocator::Local(path) => get_exif_date(path).or_else(|| get_year_from_path(path)),
        TileLocator::S3 { key, .. } => get_year_from_path(Path::new(key)),
    };
    let image = prepare_tile(locator, tile_size, crop, force)?;
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
    locator: TileLocator<'_>,
    tile_size: u32,
    crop: bool,
    force: bool,
) -> Result<::image::ImageBuffer<::image::Rgb<u8>, Vec<u8>>, ImageError> {
    // === Phase 1: cache hit without raw-byte fetch ===
    //
    // For S3 sources the etag is the cache key directly. For Local sources
    // we consult the metadata index (path → mtime → md5) which lets us skip
    // re-hashing unchanged files.
    if !force {
        if let Some(key) = try_cache_key_without_bytes(locator) {
            if let Some(cache_path) = cache_path_for_key(&key, crop, tile_size) {
                if let Ok(img) = ::image::open(&cache_path) {
                    return Ok(img.to_rgb8());
                }
                if try_s3_pull_key(&key, crop, tile_size, &cache_path) {
                    if let Ok(img) = ::image::open(&cache_path) {
                        return Ok(img.to_rgb8());
                    }
                }
            }
        }
    }

    // === Phase 2: cache miss; fetch raw bytes + prep + write cache ===
    // Wall-clock via a Drop guard; we subtract this thread's S3 duration
    // (accumulated by record_s3_dur) to get the CPU-only contribution
    // before adding to the global CPU_NS counter.
    THREAD_S3_DUR.with(|c| c.set(Duration::ZERO));
    let _cpu_timer = CpuTimerGuard {
        start: Instant::now(),
    };

    let err_path = err_path_for(locator);
    let raw_bytes = fetch_raw_bytes(locator)?;

    // Determine cache key (S3 etag wins; Local computes MD5 and updates the
    // metadata index in the process).
    let cache_key: String = match locator {
        TileLocator::S3 { etag, .. } => normalise_etag(etag).to_owned(),
        TileLocator::Local(path) => {
            let h = md5::compute(&raw_bytes);
            if let Some(meta_key) = metadata_key(path) {
                update_index(path, meta_key, h.0);
            }
            hex_md5(&h.0)
        }
    };

    let cache_path_opt: Option<PathBuf> = cache_path_for_key(&cache_key, crop, tile_size);
    if cache_path_opt.is_none() {
        warn_once_no_cache_dir();
    }

    // === Re-check the cache now that we know the key (Local source's
    //     post-MD5 entry; or S3 entry the etag fast path skipped because
    //     of a transient I/O glitch). Avoids redundant prep + re-upload.
    if !force {
        if let Some(cache_path) = &cache_path_opt {
            if let Ok(img) = ::image::open(cache_path) {
                return Ok(img.to_rgb8());
            }
            if try_s3_pull_key(&cache_key, crop, tile_size, cache_path) {
                if let Ok(img) = ::image::open(cache_path) {
                    return Ok(img.to_rgb8());
                }
            }
        }
    }

    // === Full prep from raw_bytes ===
    let mut tile_img = ::image::load_from_memory(&raw_bytes)
        .map_err(|e| ImageError {
            path: err_path.clone(),
            error: e,
        })?
        .to_rgb8();
    let orientation = jpeg_orientation_from_bytes(&raw_bytes).unwrap_or(1);
    // Drop raw_bytes early — the prep is significant memory pressure
    drop(raw_bytes);

    // Crop all the white pixels from the edges
    let is_white_pixel = |pixel: &Rgb<u8>| pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240;

    let w = tile_img.width();
    let h = tile_img.height();

    if w < tile_size || h < tile_size {
        return Err(ImageError {
            path: err_path.clone(),
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

    let tile_img = imageops::resize(tile_img.deref(), tile_size, tile_size, FilterType::Lanczos3);
    let tile_img = rotate(tile_img.into(), orientation);

    if let Some(cache_path) = &cache_path_opt {
        if let Some(parent) = cache_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent).and_then(|_| {
                tile_img
                    .save(cache_path)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
            }) {
                warn_once_cache_write_failed(parent, &e);
            } else {
                // Best-effort write-through to S3; never fatal.
                try_s3_push_key(&cache_key, crop, tile_size, cache_path);
            }
        }
    }
    Ok(tile_img.into())
}

/// Cache key derivable without reading the tile's raw bytes:
/// - S3 source: the etag (always available).
/// - Local source: only if the metadata index has a (path, mtime, size) → md5
///   entry for this file.
fn try_cache_key_without_bytes(locator: TileLocator<'_>) -> Option<String> {
    match locator {
        TileLocator::S3 { etag, .. } => {
            let key = normalise_etag(etag);
            if key.is_empty() {
                None
            } else {
                Some(key.to_owned())
            }
        }
        TileLocator::Local(path) => {
            let mk = metadata_key(path)?;
            let md5 = lookup_index(path, &mk)?;
            Some(hex_md5(&md5))
        }
    }
}

/// Synthesise a path-shaped value to feed to ImageError for log clarity.
fn err_path_for(locator: TileLocator<'_>) -> PathBuf {
    match locator {
        TileLocator::Local(p) => p.to_owned(),
        TileLocator::S3 { bucket, key, .. } => PathBuf::from(format!("s3://{}/{}", bucket, key)),
    }
}

/// Fetch a tile's raw bytes. For Local sources this is `std::fs::read`; for
/// S3 sources it's a GetObject.
fn fetch_raw_bytes(locator: TileLocator<'_>) -> Result<Vec<u8>, ImageError> {
    match locator {
        TileLocator::Local(path) => std::fs::read(path).map_err(|e| ImageError {
            path: path.to_owned(),
            error: e.into(),
        }),
        TileLocator::S3 { bucket, key, .. } => s3_get_raw(bucket, key).map_err(|e| ImageError {
            path: PathBuf::from(format!("s3://{}/{}", bucket, key)),
            error: ::image::ImageError::IoError(e),
        }),
    }
}

fn s3_get_raw(bucket: &str, key: &str) -> std::io::Result<Vec<u8>> {
    let h = s3_handle_for_listing().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::Other,
            "S3 client unavailable (EMOSAIC_S3_CACHE_BUCKET unset?)",
        )
    })?;
    let t = Instant::now();
    let bytes = h.runtime.block_on(async {
        let resp = h
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("{}", e)))?;
        let data = resp
            .body
            .collect()
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("{}", e)))?;
        Ok::<Vec<u8>, std::io::Error>(data.into_bytes().to_vec())
    })?;
    record_s3_dur(t.elapsed());
    Ok(bytes)
}

/// Read EXIF Orientation from an in-memory JPEG buffer; returns 1 (default)
/// when the image has no EXIF or isn't a JPEG.
fn jpeg_orientation_from_bytes(bytes: &[u8]) -> Result<u32, exif::Error> {
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut std::io::Cursor::new(bytes))?;
    let orientation = match exif.get_field(Tag::Orientation, In::PRIMARY) {
        Some(o) => match o.value.get_uint(0) {
            Some(v @ 1..=8) => v,
            _ => 1,
        },
        None => 1,
    };
    Ok(orientation)
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

#[derive(rkyv::Archive, rkyv::Serialize, rkyv::Deserialize, Clone, Copy)]
struct IndexEntry {
    mtime: u64,
    size: u64,
    md5: [u8; 16],
}

type IndexMap = BTreeMap<String, IndexEntry>;
type ArchivedIndexMap = rkyv::Archived<IndexMap>;

/// Index state: an optional read-only archive backed by an mmap of the
/// on-disk index, plus an in-memory delta map for inserts made during this
/// run. Lookups consult the delta first, then the archive. The mmap and
/// archive reference are `&'static` because the index lives for the
/// process lifetime (held inside a `OnceLock`).
struct IndexState {
    archive: Option<&'static ArchivedIndexMap>,
    delta: RwLock<IndexMap>,
}

static INDEX: OnceLock<IndexState> = OnceLock::new();

fn index_path() -> Option<PathBuf> {
    dirs::cache_dir().map(|d| d.join("mosaic").join("index.bin"))
}

/// Resolve the local cache path for a given opaque cache key (hex MD5 for
/// Local sources, S3 ETag for S3 sources).
fn cache_path_for_key(key: &str, crop: bool, tile_size: u32) -> Option<PathBuf> {
    dirs::cache_dir().map(|d| {
        d.join("mosaic").join(format!(
            "{}{}.v{}.{}.png",
            key,
            if crop { "_cropped" } else { "" },
            PREPARE_TILE_CACHE_VERSION,
            tile_size
        ))
    })
}

/// Trim the surrounding double-quotes that S3 wraps around ETag values.
fn normalise_etag(etag: &str) -> &str {
    etag.trim_matches('"')
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

fn get_index() -> &'static IndexState {
    INDEX.get_or_init(|| {
        let archive = index_path().and_then(|p| {
            let file = std::fs::File::open(&p).ok()?;
            // Safety: we treat the mmap as read-only for the lifetime of the
            // process. `persist_tile_index` writes via a tmp-file + rename, so
            // the original inode (and thus the bytes we have mapped) is never
            // mutated in place.
            let mmap = unsafe { memmap2::Mmap::map(&file).ok()? };
            let mmap: &'static memmap2::Mmap = Box::leak(Box::new(mmap));
            match rkyv::access::<ArchivedIndexMap, rkyv::rancor::Error>(&mmap[..]) {
                Ok(a) => Some(a),
                Err(_) => {
                    WARN_INDEX_LOAD.call_once(|| {
                        eprintln!(
                            "⚠️  Tile index at {} could not be validated, starting fresh.",
                            p.display()
                        );
                    });
                    None
                }
            }
        });
        IndexState {
            archive,
            delta: RwLock::new(IndexMap::new()),
        }
    })
}

fn lookup_index(path: &Path, key: &(u64, u64)) -> Option<[u8; 16]> {
    let st = get_index();
    let path_str = path.to_string_lossy();
    // Delta wins over the on-disk archive — it has the most recent writes
    // for this run.
    if let Ok(delta) = st.delta.read() {
        if let Some(e) = delta.get(path_str.as_ref()) {
            return (e.mtime == key.0 && e.size == key.1).then_some(e.md5);
        }
    }
    let archive = st.archive?;
    let e = archive.get(path_str.as_ref())?;
    let mtime: u64 = e.mtime.into();
    let size: u64 = e.size.into();
    (mtime == key.0 && size == key.1).then_some(e.md5)
}

fn update_index(path: &Path, key: (u64, u64), md5: [u8; 16]) {
    if let Ok(mut delta) = get_index().delta.write() {
        delta.insert(
            path.to_string_lossy().into_owned(),
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

pub(crate) struct S3Handle {
    pub(crate) runtime: tokio::runtime::Runtime,
    pub(crate) client: aws_sdk_s3::Client,
    bucket: String,
    prefix: String,
}

/// Expose the lazily-initialised S3 handle for use by callers that need
/// the client + runtime but don't otherwise care about the cache bucket
/// (e.g. ListObjectsV2 on a tile-source bucket). Requires the same
/// EMOSAIC_S3_CACHE_BUCKET env var as cache operations — the client
/// itself is bucket-agnostic, but we currently key its lifetime to that
/// flag for simplicity.
pub(crate) fn s3_handle_for_listing() -> Option<&'static S3Handle> {
    s3_handle()
}

static S3_HANDLE: OnceLock<Option<S3Handle>> = OnceLock::new();
static WARN_S3_INIT: Once = Once::new();
static WARN_S3_PULL: Once = Once::new();
static WARN_S3_PUSH: Once = Once::new();
static S3_PUT_COUNT: AtomicU64 = AtomicU64::new(0);
static S3_PUT_BYTES: AtomicU64 = AtomicU64::new(0);
static CPU_NS: AtomicU64 = AtomicU64::new(0);
static S3_NS: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// Per-thread accumulator for time spent in S3 calls during the current
    /// `prepare_tile` slow-path execution. The slow path resets this on entry
    /// and reads it on exit to compute the CPU-only contribution.
    static THREAD_S3_DUR: Cell<Duration> = const { Cell::new(Duration::ZERO) };
}

fn record_s3_dur(d: Duration) {
    S3_NS.fetch_add(d.as_nanos() as u64, Ordering::Relaxed);
    THREAD_S3_DUR.with(|cell| cell.set(cell.get() + d));
}

/// RAII guard that accumulates CPU-only time (wall − S3) into CPU_NS on
/// drop. Constructed at the start of `prepare_tile`'s slow path; the drop
/// fires on any exit point including early `?` returns.
struct CpuTimerGuard {
    start: Instant,
}

impl Drop for CpuTimerGuard {
    fn drop(&mut self) {
        let wall = self.start.elapsed();
        let s3 = THREAD_S3_DUR.with(|c| c.get());
        let cpu = wall.saturating_sub(s3);
        CPU_NS.fetch_add(cpu.as_nanos() as u64, Ordering::Relaxed);
    }
}

/// Returns `(successful PUTs, bytes uploaded)` for the S3-backed cache layer
/// since the process started. Both are zero when the layer is disabled or
/// nothing has been pushed yet.
pub fn s3_put_stats() -> (u64, u64) {
    (
        S3_PUT_COUNT.load(Ordering::Relaxed),
        S3_PUT_BYTES.load(Ordering::Relaxed),
    )
}

/// Returns `(cpu_ns, s3_ns)` — cumulative time, summed across all rayon
/// threads, spent in CPU prep work vs S3 calls during `prepare_tile` slow
/// paths. Use the ratio to tell whether a long warm-up run is CPU- or
/// network-bound.
pub fn phase_time_ns() -> (u64, u64) {
    (
        CPU_NS.load(Ordering::Relaxed),
        S3_NS.load(Ordering::Relaxed),
    )
}

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

fn s3_key(prefix: &str, key: &str, crop: bool, tile_size: u32) -> String {
    format!(
        "{}{}{}.v{}.{}.png",
        prefix,
        key,
        if crop { "_cropped" } else { "" },
        PREPARE_TILE_CACHE_VERSION,
        tile_size
    )
}

/// Try to populate `local_path` from S3 using `key` as the cache-key
/// component. Returns true on success. Any error (bucket disabled,
/// NoSuchKey, network) returns false.
fn try_s3_pull_key(key: &str, crop: bool, tile_size: u32, local_path: &Path) -> bool {
    let h = match s3_handle() {
        Some(h) => h,
        None => return false,
    };
    let key = s3_key(&h.prefix, key, crop, tile_size);
    let t = Instant::now();
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
    record_s3_dur(t.elapsed());
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

/// Best-effort PUT of `local_path` contents to S3 using `key` as the
/// cache-key component. Failures are logged once.
fn try_s3_push_key(key: &str, crop: bool, tile_size: u32, local_path: &Path) {
    let h = match s3_handle() {
        Some(h) => h,
        None => return,
    };
    let key = s3_key(&h.prefix, key, crop, tile_size);
    let bytes = match std::fs::read(local_path) {
        Ok(b) => b,
        Err(_) => return,
    };
    let bytes_len = bytes.len() as u64;
    let t = Instant::now();
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
    record_s3_dur(t.elapsed());
    match res {
        Ok(_) => {
            S3_PUT_COUNT.fetch_add(1, Ordering::Relaxed);
            S3_PUT_BYTES.fetch_add(bytes_len, Ordering::Relaxed);
        }
        Err(e) => {
            WARN_S3_PUSH.call_once(|| {
                eprintln!("⚠️  S3 cache PUT failed for {}: {}", key, e);
            });
        }
    }
}

/// Persist the in-memory tile index to disk. Best-effort; failures emit a
/// one-shot warning. Call this once near process exit (after rendering).
///
/// Writes via a tmp-file + rename so we never mutate the bytes the existing
/// mmap is pointing at — the new file gets a new inode, the old one stays
/// valid until the leaked Mmap is dropped at process exit.
pub fn persist_tile_index() {
    let p = match index_path() {
        Some(p) => p,
        None => return,
    };
    let st = get_index();
    let delta = match st.delta.read() {
        Ok(g) => g,
        Err(_) => return,
    };
    // Nothing new this run AND we already have a valid on-disk archive →
    // no point rewriting the same bytes.
    if delta.is_empty() && st.archive.is_some() {
        return;
    }
    // Merge: start with the existing archive (skipping keys overridden by
    // the delta), then overlay the delta.
    let mut merged: IndexMap = BTreeMap::new();
    if let Some(archive) = st.archive {
        for (k, v) in archive.iter() {
            let k_str: &str = k.as_ref();
            if !delta.contains_key(k_str) {
                merged.insert(
                    k_str.to_owned(),
                    IndexEntry {
                        mtime: v.mtime.into(),
                        size: v.size.into(),
                        md5: v.md5,
                    },
                );
            }
        }
    }
    for (k, v) in delta.iter() {
        merged.insert(k.clone(), *v);
    }
    if merged.is_empty() {
        return;
    }
    let bytes = match rkyv::to_bytes::<rkyv::rancor::Error>(&merged) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = p.with_extension("bin.tmp");
    if let Err(e) = std::fs::write(&tmp, &bytes[..]).and_then(|_| std::fs::rename(&tmp, &p)) {
        let _ = std::fs::remove_file(&tmp);
        WARN_INDEX_WRITE.call_once(|| {
            eprintln!(
                "⚠️  Could not persist tile index to {}: {}.",
                p.display(),
                e
            );
        });
    }
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
        let result = prepare_tile(TileLocator::Local(path), tile_size, true, false);
        assert!(result.is_ok());
        let tile_img = result.unwrap();
        assert_eq!(tile_img.width(), tile_size);
        assert_eq!(tile_img.height(), tile_size);
    }

    #[test]
    fn test_index_archive_roundtrip() {
        let mut map: IndexMap = BTreeMap::new();
        map.insert(
            "/some/tile/a.jpg".to_string(),
            IndexEntry {
                mtime: 1_700_000_000,
                size: 4096,
                md5: [0xab; 16],
            },
        );
        map.insert(
            "/some/tile/b.png".to_string(),
            IndexEntry {
                mtime: 1_700_000_999,
                size: 8192,
                md5: [0xcd; 16],
            },
        );
        let bytes = rkyv::to_bytes::<rkyv::rancor::Error>(&map).expect("serialize");
        let archive =
            rkyv::access::<ArchivedIndexMap, rkyv::rancor::Error>(&bytes[..]).expect("access");
        let a = archive.get("/some/tile/a.jpg").expect("a present");
        assert_eq!(u64::from(a.mtime), 1_700_000_000);
        assert_eq!(u64::from(a.size), 4096);
        assert_eq!(a.md5, [0xab; 16]);
        let b = archive.get("/some/tile/b.png").expect("b present");
        assert_eq!(u64::from(b.mtime), 1_700_000_999);
        assert_eq!(u64::from(b.size), 8192);
        assert_eq!(b.md5, [0xcd; 16]);
        assert!(archive.get("/missing").is_none());
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
