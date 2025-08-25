use ::image::{Rgb, RgbImage};
use super::color::average_color;

/// Abstract an image into an sqrt(N)*sqrt(N) grid of average colors
pub fn analyse<const N: usize>(img: RgbImage) -> [Rgb<u8>; N] {
    let dim = (N as f64).sqrt();
    let dim_width = (f64::from(img.width()) / dim).floor() as u32;
    let dim_height = (f64::from(img.height()) / dim).floor() as u32;

    let mut colors = [Rgb([0u8, 0, 0]); N];
    for i in 0..N {
        let top = (i / dim as usize) as u32;
        let left = (i % dim as usize) as u32;
        let rect = (left * dim_width, top * dim_height, dim_width, dim_height);
        let color = average_color(&img, rect);
        colors[i] = color;
    }

    colors
}

/// Extract colors from a specific region of an image for tile matching
pub fn get_img_colors<const N: usize>(
    x: u32,
    y: u32,
    step: u32,
    source_img: &::image::ImageBuffer<Rgb<u8>, Vec<u8>>,
) -> [Rgb<u8>; N] {
    let mut colors = [Rgb([0, 0, 0]); N];
    for i in 0..N {
        let x = x + (i as u32 % step);
        let y = y + (i as u32 / step);
        colors[i] = *source_img.get_pixel(x, y)
    }
    colors
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::image::RgbImage;

    #[test]
    fn test_analyse_single_color() {
        let mut img = RgbImage::new(2, 2);
        // Fill with red
        for pixel in img.pixels_mut() {
            *pixel = Rgb([255, 0, 0]);
        }
        
        let colors = analyse::<4>(img);
        for color in colors.iter() {
            assert_eq!(*color, Rgb([255, 0, 0]));
        }
    }

    #[test]
    fn test_get_img_colors() {
        let mut img = RgbImage::new(4, 4);
        // Fill with different colors in a pattern
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, Rgb([x as u8 * 64, y as u8 * 64, 128]));
            }
        }
        
        let colors = get_img_colors::<4>(0, 0, 2, &img);
        assert_eq!(colors[0], Rgb([0, 0, 128]));    // (0,0)
        assert_eq!(colors[1], Rgb([64, 0, 128]));   // (1,0)
        assert_eq!(colors[2], Rgb([0, 64, 128]));   // (0,1)
        assert_eq!(colors[3], Rgb([64, 64, 128]));  // (1,1)
    }
}