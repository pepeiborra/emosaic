use image::{Rgb, RgbImage};

/// Calculate the average color of a rectangular region in an RGB image.
/// 
/// # Arguments
/// * `img` - The source image
/// * `rect` - Rectangle as (left, top, width, height)
/// 
/// # Returns
/// The average RGB color of all pixels in the specified region.
/// 
/// # Panics
/// Panics if the rectangle extends beyond image boundaries or if the rectangle is empty.
pub fn average_color(img: &RgbImage, rect: (u32, u32, u32, u32)) -> Rgb<u8> {
    let (left, top, width, height) = rect;
    
    // Validate rectangle bounds
    assert!(width > 0 && height > 0, "Rectangle dimensions must be positive");
    assert!(left + width <= img.width(), "Rectangle extends beyond image width");
    assert!(top + height <= img.height(), "Rectangle extends beyond image height");
    
    let mut r_sum = 0u64;
    let mut g_sum = 0u64;
    let mut b_sum = 0u64;
    
    for y in top..top + height {
        for x in left..left + width {
            // Safe to use get_pixel since we validated bounds above
            let pixel = img.get_pixel(x, y);
            r_sum += u64::from(pixel[0]);
            g_sum += u64::from(pixel[1]);
            b_sum += u64::from(pixel[2]);
        }
    }
    
    let pixel_count = u64::from(width * height);
    let r = (r_sum / pixel_count) as u8;
    let g = (g_sum / pixel_count) as u8;
    let b = (b_sum / pixel_count) as u8;
    
    Rgb([r, g, b])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_average_color_basic() {
        // Create a 2x2 image with known colors
        let img = RgbImage::from_fn(2, 2, |x, y| {
            match (x, y) {
                (0, 0) => Rgb([100, 150, 200]), // Top-left
                (1, 0) => Rgb([200, 100, 50]),  // Top-right  
                (0, 1) => Rgb([50, 200, 100]),  // Bottom-left
                (1, 1) => Rgb([150, 50, 150]),  // Bottom-right
                _ => unreachable!(),
            }
        });

        // Test full image average
        let avg = average_color(&img, (0, 0, 2, 2));
        assert_eq!(avg, Rgb([125, 125, 125])); // (100+200+50+150)/4 = 125 for each channel
    }

    #[test] 
    fn test_average_color_single_pixel() {
        let img = RgbImage::from_fn(3, 3, |_x, _y| Rgb([42, 84, 126]));
        
        let avg = average_color(&img, (1, 1, 1, 1));
        assert_eq!(avg, Rgb([42, 84, 126]));
    }

    #[test]
    #[should_panic(expected = "Rectangle dimensions must be positive")]
    fn test_zero_width_panic() {
        let img = RgbImage::new(10, 10);
        average_color(&img, (0, 0, 0, 5)); // width = 0
    }

    #[test]
    #[should_panic(expected = "Rectangle dimensions must be positive")]
    fn test_zero_height_panic() {
        let img = RgbImage::new(10, 10);
        average_color(&img, (0, 0, 5, 0)); // height = 0
    }

    #[test]
    #[should_panic(expected = "Rectangle extends beyond image width")]
    fn test_out_of_bounds_width_panic() {
        let img = RgbImage::new(5, 5);
        average_color(&img, (3, 0, 5, 2)); // left=3 + width=5 = 8 > img.width=5
    }

    #[test]
    #[should_panic(expected = "Rectangle extends beyond image height")]
    fn test_out_of_bounds_height_panic() {
        let img = RgbImage::new(5, 5);
        average_color(&img, (0, 3, 2, 5)); // top=3 + height=5 = 8 > img.height=5
    }
}
