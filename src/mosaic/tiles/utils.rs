use std::collections::HashMap;
use std::ops::Div;
use std::path::Path;

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

/// Prepare a tile image by resizing, cropping, and caching it, and extract date information.
pub fn prepare_tile_with_date(
    path: &Path,
    tile_size: u32,
    crop: bool,
) -> Result<(::image::ImageBuffer<::image::Rgb<u8>, Vec<u8>>, Option<String>), ImageError> {
    let date_taken = get_exif_date(path);
    let image = prepare_tile(path, tile_size, crop)?;
    Ok((image, date_taken))
}

/// Prepare a tile image by resizing, cropping, and caching it.
pub fn prepare_tile(
    path: &Path,
    tile_size: u32,
    crop: bool,
) -> Result<::image::ImageBuffer<::image::Rgb<u8>, Vec<u8>>, ImageError> {
    // We cache resized images in the home cache path using their content hash
    let content_hash = md5::compute(std::fs::read(path).map_err(|e| ImageError {
        path: path.to_owned(),
        error: e.into(),
    })?);
    let cache_path = dirs::cache_dir().unwrap().join("mosaic").join(format!(
        "{:x}{}.{}.jpg",
        content_hash,
        if crop { "_cropped" } else { "" },
        tile_size
    ));
    // check if the cache path exists and load it, otherwise resize and save it
    let cached_img: Result<::image::ImageBuffer<_, _>, _> = ::image::open(&cache_path)
        .map_err(|e| ImageError {
            path: path.to_owned(),
            error: e,
        })
        .map(|img| img.to_rgb8());
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
            tile_img.change_bounds(x0, y0, size, size);
        }

        let tile_img =
            imageops::resize(tile_img.deref(), tile_size, tile_size, FilterType::Lanczos3);
        let orientation = get_jpeg_orientation(path).unwrap_or(1);
        let tile_img = rotate(tile_img.into(), orientation);
        tile_img.save(cache_path).unwrap();
        Ok(tile_img.into())
    })
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
    let date_tags = [
        Tag::DateTimeOriginal,
        Tag::DateTime,
        Tag::DateTimeDigitized,
    ];
    
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
        let result = prepare_tile(path, tile_size, true);
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
}