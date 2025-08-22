use std::collections::HashMap;

use itertools::Itertools;

use super::tiles::{Tile, TileSet};

pub struct RenderStats<D> {
    tiles: Vec<Tile<D>>,
}

impl<D> RenderStats<D>
where
    f64: From<D>,
    D: From<u32>,
    D: std::cmp::Ord,
    D: std::ops::AddAssign,
    D: Copy,
    D: std::fmt::Display {
    pub fn new() -> Self {
        Self { tiles: vec![] }
    }
    pub fn push_tile<T>(&mut self, tile: &Tile<T>, distance: D) {
        let t = Tile {
            colors: distance,
            ..*tile
        };
        self.tiles.push(t);
    }
    pub fn summarise<T>(&self, tile_set: &TileSet<T>) {
        let mut total_distance : D = 0.into();
        let mut paths_count: HashMap<_, u16> = HashMap::with_capacity(self.tiles.len());
        for t in self.tiles.iter() {
            total_distance += t.colors;
            *paths_count.entry(tile_set.get_path(&t)).or_default() += 1;
        }

        let unique = paths_count.len();
        let mut tuples: Vec<_> = paths_count.into_iter().collect();
        tuples.sort_by(|(_, a), (_, b)| b.cmp(a));

        let top10 = tuples
            .into_iter()
            .take(10);

        let total_distance_f64 : f64 = total_distance.into();

        eprintln!("Used {} unique images", unique);
        eprintln!("Average distance: {}", total_distance_f64 / self.tiles.len() as f64);
        eprintln!("Top 10 duplicates: ");
        for (path, dupes) in top10 {
            eprintln!(" - {} (duplicated {dupes} times)", path.display());
        }

        eprintln!("Worst 10 matches: ");
        let worst10 : Vec<_> = self.tiles.iter().sorted_by(|a,b| b.colors.cmp(&a.colors)).take(10).collect();
        for tile in worst10 {
            eprintln!(" - {} (distance: {})", tile_set.get_path(tile).display(), tile.colors);
        }
    }
}
