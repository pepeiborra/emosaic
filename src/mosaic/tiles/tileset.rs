use std::collections::HashMap;
use std::convert::TryInto;
use std::iter::FromIterator;
use std::path::{Path, PathBuf};

use ::image::Rgb;
use itertools::MultiUnzip;
use rand::prelude::*;
use rayon::iter::FromParallelIterator;
use rayon::iter::IntoParallelIterator;
use rayon::iter::ParallelIterator;
use serde::ser::SerializeTuple;
use serde::{Deserialize, Serialize};

use super::tile::Tile;
use super::utils::{flipped_coords, prepare_tile};
use super::SIZE;
use crate::mosaic::error::ImageError;

/// A collection of tiles used for mosaic generation.
#[derive(Clone, Debug)]
pub struct TileSet<T> {
    pub tiles: Vec<Tile<T>>,
    paths: Vec<PathBuf>,
    images: HashMap<u16, ::image::ImageBuffer<Rgb<u8>, Vec<u8>>>,
}

impl<const N: usize> Serialize for TileSet<[Rgb<u8>; N]> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let colors: Vec<Tile<Vec<u8>>> = self
            .tiles
            .iter()
            .map(|tile| {
                tile.clone().map(|rgbs| {
                    rgbs.iter()
                        .flat_map(|rgb| [rgb[0], rgb[1], rgb[2]])
                        .collect()
                })
            })
            .collect::<Vec<_>>();
        let mut st = serializer.serialize_tuple(2)?;
        st.serialize_element(&colors)?;
        st.serialize_element(&self.paths)?;
        st.end()
    }
}

impl<'de, const N: usize> Deserialize<'de> for TileSet<[Rgb<u8>; N]> {
    fn deserialize<D>(deserializer: D) -> Result<TileSet<[Rgb<u8>; N]>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let (colors, paths): (Vec<Tile<Vec<u8>>>, Vec<PathBuf>) =
            Deserialize::deserialize(deserializer)?;
        let tiles: Vec<Tile<[Rgb<u8>; N]>> = colors
            .into_iter()
            .map(|tile| {
                let colors: Vec<Rgb<u8>> = tile
                    .colors
                    .chunks(3)
                    .map(|chunk| Rgb([chunk[0], chunk[1], chunk[2]]))
                    .collect();
                let colors_array: [Rgb<u8>; N] = colors.try_into().unwrap();
                Tile {
                    colors: colors_array,
                    ..tile
                }
            })
            .collect();
        Ok(TileSet::from_tiles(tiles, paths))
    }
}

impl<T> TileSet<T> {
    /// Create a new empty tile set.
    pub fn new() -> TileSet<T> {
        TileSet::from_tiles(vec![], vec![])
    }

    /// Create a tile set from existing tiles and paths.
    pub fn from_tiles(tiles: Vec<Tile<T>>, paths: Vec<PathBuf>) -> TileSet<T> {
        TileSet::<T> {
            tiles,
            paths,
            images: HashMap::new().into(),
        }
    }

    /// Get a random tile from the set.
    pub fn random_tile(&self) -> &Tile<T> {
        let mut rng = thread_rng();
        let i = rng.gen_range(0, self.tiles.len());
        &self.tiles[i]
    }

    /// Get the number of tiles in the set.
    pub fn len(&self) -> usize {
        self.tiles.len()
    }

    #[allow(dead_code)]
    pub fn map<T1>(self, f: fn(T) -> T1) -> TileSet<T1> {
        let tiles = self.tiles.into_iter().map(|t| t.map(f)).collect();
        TileSet { tiles, ..self }
    }

    /// Add a new tile to the set.
    pub fn push_tile(&mut self, path: PathBuf, colors: T) {
        let idx = self.tiles.len() as u16 + 1;
        self.tiles.push(Tile::new(idx, colors));
        self.paths.push(path);
    }

    #[allow(dead_code)]
    pub fn push_tile_with_image(
        &mut self,
        path_buf: PathBuf,
        colors: T,
        image: ::image::ImageBuffer<Rgb<u8>, Vec<u8>>,
    ) {
        let idx = self.tiles.len() as u16 + 1;
        self.tiles.push(Tile::new(idx, colors));
        self.paths.push(path_buf);
        self.images.insert(idx, image.into());
    }

    /// Get a tile by its index (positive for normal, negative for flipped).
    pub fn get_tile(&self, idx: i16) -> Option<Tile<T>>
    where
        T: Copy,
    {
        let tile = self.tiles.get(idx.abs() as usize - 1).map(|tile| Tile {
            colors: tile.colors,
            idx: tile.idx,
            flipped: idx < 0,
            date_taken: tile.date_taken.clone(),
        });
        assert!(tile.as_ref().map_or(true, |t| t.idx == idx.abs() as u16));
        tile
    }

    /// Get the image for a tile, loading it if necessary.
    pub fn get_image(
        &self,
        tile: &Tile<T>,
        tile_size: u32,
    ) -> Result<image::ImageBuffer<Rgb<u8>, Vec<u8>>, ImageError> {
        let path = self.get_path(tile);
        let image = self
            .images
            .get(&tile.idx)
            .map_or_else(|| prepare_tile(path, tile_size, true), |x| Ok(x.clone()))?;
        Ok(if tile.flipped {
            image::imageops::flip_horizontal(&image)
        } else {
            image
        })
    }

    /// Get the file path for a tile.
    pub fn get_path<A>(&self, tile: &Tile<A>) -> &Path {
        self.paths[tile.idx as usize - 1].as_path()
    }

    #[allow(dead_code)]
    pub fn set_image(&mut self, tile: &Tile<T>, image: ::image::ImageBuffer<Rgb<u8>, Vec<u8>>) {
        self.images.insert(tile.idx, image);
    }
}

impl<const N: usize> TileSet<[Rgb<u8>; N]>
//   where T: Copy, T: Default
{
    /// Build a kd-tree for fast nearest neighbor searches.
    pub fn build_kiddo(&self) -> kiddo::fixed::kdtree::KdTree<SIZE, i16, { N * 3 }, 640, u16> {
        let mut kd = kiddo::fixed::kdtree::KdTree::new();
        for tile in self.tiles.iter() {
            let mut coords = tile.coords();
            let idx: i16 = tile.idx.try_into().unwrap();
            assert!(idx != 0);
            kd.add(&coords, idx);
            flipped_coords(&mut coords);
            assert!(-idx != 0);
            kd.add(&coords, -idx);
        }
        kd
    }
}

impl<T> Default for TileSet<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> FromIterator<(PathBuf, T)> for TileSet<T> {
    fn from_iter<I: IntoIterator<Item = (PathBuf, T)>>(iter: I) -> Self {
        let (tiles, paths) = iter
            .into_iter()
            .enumerate()
            .map(|(idx, (path_buf, color))| {
                (Tile::new((idx + 1).try_into().unwrap(), color), path_buf)
            })
            .unzip();
        TileSet::from_tiles(tiles, paths)
    }
}

impl<T> FromIterator<(PathBuf, ::image::ImageBuffer<Rgb<u8>, Vec<u8>>, T)> for TileSet<T> {
    fn from_iter<I: IntoIterator<Item = (PathBuf, ::image::ImageBuffer<Rgb<u8>, Vec<u8>>, T)>>(
        iter: I,
    ) -> Self {
        let (paths, tiles, images) = iter
            .into_iter()
            .enumerate()
            .map(|(idx, (path, img, color))| {
                (
                    path,
                    Tile::new((idx + 1).try_into().unwrap(), color),
                    ((idx + 1) as u16, img),
                )
            })
            .multiunzip();
        TileSet {
            tiles,
            images,
            paths,
        }
    }
}

impl<A: Send, T> FromParallelIterator<A> for TileSet<T>
where
    TileSet<T>: FromIterator<A>,
{
    fn from_par_iter<I>(par_iter: I) -> Self
    where
        I: IntoParallelIterator<Item = A>,
        A: Send,
    {
        let items: Vec<_> = par_iter.into_par_iter().collect();
        items.into_iter().collect()
    }
}
