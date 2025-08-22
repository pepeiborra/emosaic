use std::
    collections::HashMap
;

use super::tiles::{Tile, TileSet};

pub struct Stats {
    paths: Vec<Tile<()>>,
}

impl Stats {
    pub fn new() -> Stats {
        Stats { paths: vec![] }
    }
    pub fn push_tile<T>(&mut self, tile: &Tile<T>) {
        let t = Tile {
            colors: (),
            ..*tile
        };
        self.paths.push(t);
    }
    pub fn summarise<T>(self, tile_set: &TileSet<T>) {
        let mut tiles_map: HashMap<Tile<()>, u16> = HashMap::with_capacity(self.paths.len());
        for mut t in self.paths {
            t.flipped = false;
            *tiles_map.entry(t).or_default() += 1;
        }

        let unique = tiles_map.len();
        let mut tuples: Vec<_> = tiles_map.into_iter().collect();
        tuples.sort_by(|(_, a), (_, b)| b.cmp(a));

        let top10 = tuples
            .into_iter()
            .take(10)
            .map(|(t, dupes)| (tile_set.get_path(&t), dupes));

        eprintln!("Used {} unique images", unique);
        eprintln!("Top 10 duplicates: ");
        for (path, dupes) in top10 {
            eprintln!(" - {} (duplicated {dupes} times)", path.display());
        }
    }
}
