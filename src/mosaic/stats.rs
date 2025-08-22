use std::collections::HashMap;

use image::{ImageBuffer, Rgb, RgbImage};
use itertools::Itertools;

use super::tiles::{Tile, TileSet};

pub struct RenderStats<D> {
    tiles: HashMap<(u32, u32), Tile<D>>,
}

impl<D> RenderStats<D>
where
    f64: From<D>,
    // D: From<u32>,
    D: std::cmp::Ord,
    D: std::ops::Sub<Output = D>,
    D: std::convert::From<u8>,
    D: std::ops::AddAssign,
    D: Copy,
    D: std::fmt::Display,
{
    pub fn new() -> Self {
        Self { tiles: [].into() }
    }
    pub fn push_tile<T>(&mut self, x: u32, y: u32, tile: &Tile<T>, distance: D) {
        let t = Tile {
            colors: distance,
            ..*tile
        };
        self.tiles.insert((x, y), t);
    }
    pub fn summarise<T>(&self, tile_set: &TileSet<T>) {
        let mut total_distance: D = 0_u8.into();
        let mut paths_count: HashMap<_, u16> = HashMap::with_capacity(self.tiles.len());
        for t in self.tiles.values() {
            total_distance += t.colors;
            *paths_count.entry(tile_set.get_path(&t)).or_default() += 1;
        }

        let unique = paths_count.len();
        let mut tuples: Vec<_> = paths_count.into_iter().collect();
        tuples.sort_by(|(_, a), (_, b)| b.cmp(a));

        let top10 = tuples.into_iter().take(10);

        let total_distance_f64: f64 = total_distance.into();

        eprintln!("Used {} unique images", unique);
        eprintln!(
            "Average distance: {}",
            total_distance_f64 / self.tiles.len() as f64
        );
        eprintln!("Top 10 duplicates: ");
        for (path, dupes) in top10 {
            eprintln!(" - {} (duplicated {dupes} times)", path.display());
        }

        eprintln!("Worst 10 matches: ");
        let worst10: Vec<_> = self
            .tiles
            .values()
            .sorted_by(|a, b| b.colors.cmp(&a.colors))
            .take(10)
            .collect();
        for tile in worst10 {
            eprintln!(
                " - {} (distance: {})",
                tile_set.get_path(tile).display(),
                tile.colors
            );
        }
    }
    pub fn render(self, tile_size: u32) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
        let dim_x = self.tiles.keys().map(|(x, _)| x).max().unwrap();
        let dim_y = self.tiles.keys().map(|(_, y)| y).max().unwrap();
        let max_dist = self
            .tiles
            .values()
            .map(|t| t.colors.into())
            .max_by(|a: &f64, b| a.partial_cmp(b).unwrap())
            .unwrap_or_else(|| 0.0);
        let mut image = RgbImage::new(dim_x / tile_size + 1, dim_y / tile_size + 1);
        for ((x, y), tile) in &self.tiles {
            let dist: f64 = tile.colors.into();
            let dist = dist / max_dist;
            let dist = (dist * 255.0) as u8;
            let color = image::Rgb([dist, dist, dist]);
            image.put_pixel(*x / tile_size, *y / tile_size, color);
        }
        image
    }
}
