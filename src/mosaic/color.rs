use image::{Rgb, RgbImage};

pub fn average_color(img: &RgbImage, rect: (u32, u32, u32, u32)) -> Rgb<u8> {
    let (left, top, width, height) = rect;
    let mut r = 0.0;
    let mut g = 0.0;
    let mut b = 0.0;
    let mut count = 0.0;
    for y in top..top + height {
        for x in left..left + width {
            let pixel = img.get_pixel(x, y);
            r += f64::from(pixel[0]);
            g += f64::from(pixel[1]);
            b += f64::from(pixel[2]);
            count += 1.0;
        }
    }
    let r = (r / count).round() as u8;
    let g = (g / count).round() as u8;
    let b = (b / count).round() as u8;
    Rgb([r, g, b])
}
