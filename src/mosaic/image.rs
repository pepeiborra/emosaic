use std::fs::{read_dir, ReadDir};
use std::path::{Path, PathBuf};
use image::{DynamicImage, RgbImage};

pub struct ImageIterator {
    stack: Vec<ReadDir>,
}

impl ImageIterator {
    fn new(path: &Path) -> Self {
        let entries = read_dir(path).unwrap();
        ImageIterator { stack: vec![entries] }
    }
}

impl Iterator for ImageIterator {
    type Item = (PathBuf, RgbImage);

    fn next(&mut self) -> Option<Self::Item> {
        while let Some(entries) = self.stack.last_mut() {
            if let Some(entry) = entries.next() {
                let path_buf = entry.unwrap().path();
                if path_buf.is_dir() {
                    self.stack.push(read_dir(path_buf).unwrap());
                } else {
                    let img = match image::open(&path_buf) {
                        Ok(im) => im,
                        _ => continue,
                    };
                    let img: RgbImage = match img {
                        DynamicImage::ImageRgba8(_) => match img.as_rgb8() {
                            Some(x) => x.to_owned(),
                            _ => continue,
                        },
                        DynamicImage::ImageRgb8(im) => im,
                        _ => continue,
                    };
                    return Some((path_buf, img));
                }
            } else {
                self.stack.pop();
            }
        }
        None
    }
}

pub fn read_images_in_dir(path: &Path) -> ImageIterator {
    ImageIterator::new(path)
}
