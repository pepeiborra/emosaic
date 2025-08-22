use std::path::PathBuf;
use rayon::prelude::*;

use image::RgbImage;

use super::color::{average_color, IntoSerializableRgb, SerializableRgb};
use crate::AnalyseTiles;
use crate::{Tile, TileSet};

pub(crate) struct _1to1();
impl AnalyseTiles<SerializableRgb> for _1to1 {
    fn analyse(self, images: impl ParallelIterator<Item = (PathBuf, RgbImage)>) -> TileSet<SerializableRgb> {
        let tiles : Vec<_> = images.map(|(path_buf, img)| {
                let colors = average_color(&img, &(0, 0, img.width(), img.height()));
                Tile::new(path_buf.clone(), colors.into_serializable_rgb())
            }).collect();
        TileSet{tiles}
    }
}

pub(crate) struct _4to1();

impl AnalyseTiles<[SerializableRgb; 4]> for _4to1 {
    fn analyse(self, images: impl ParallelIterator<Item = (PathBuf, RgbImage)>) -> TileSet<[SerializableRgb; 4]> {
        let tiles = images.map(|(path_buf, img)| {
            let half_width = (f64::from(img.width()) * 0.5).floor() as u32;
            let half_height = (f64::from(img.height()) * 0.5).floor() as u32;

            let rect_top_left = (0u32, 0u32, half_width, half_height);
            let rect_top_right = (half_width, 0u32, half_width, half_height);
            let rect_bottom_right = (half_width, half_height, half_width, half_height);
            let rect_bottom_left = (0u32, half_height, half_width, half_height);

            let top_left = average_color(&img, &rect_top_left);
            let top_right = average_color(&img, &rect_top_right);
            let bottom_right = average_color(&img, &rect_bottom_right);
            let bottom_left = average_color(&img, &rect_bottom_left);

            let colors: [SerializableRgb; 4] = [
                top_left.into_serializable_rgb(),
                top_right.into_serializable_rgb(),
                bottom_right.into_serializable_rgb(),
                bottom_left.into_serializable_rgb(),
            ];

            Tile::new(path_buf, colors)
        }).collect();
        TileSet{tiles}
    }
}
