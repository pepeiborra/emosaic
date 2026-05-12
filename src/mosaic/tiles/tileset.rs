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

use super::source::{TileLocator, TileSource};
use super::tile::Tile;
use super::utils::{flipped_coords, prepare_tile};
use super::SIZE;
use crate::mosaic::error::ImageError;

/// A collection of tiles used for mosaic generation.
///
/// `source` and `etags` are populated by the caller after construction (via
/// `set_source` / `set_etags`); both default to "Local with no etag info" so
/// that the many existing call sites (tests, `TileSet::new`, the legacy
/// Deserialize impl) don't have to change.
#[derive(Clone, Debug)]
pub struct TileSet<T> {
    pub tiles: Vec<Tile<T>>,
    paths: Vec<PathBuf>,
    etags: Vec<Option<String>>,
    images: HashMap<u16, ::image::ImageBuffer<Rgb<u8>, Vec<u8>>>,
    source: TileSource,
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

    /// Create a tile set from existing tiles and paths. The source defaults
    /// to `TileSource::Local` with no etag info; call `set_source` /
    /// `set_etags` afterwards to override (S3-source code path needs both
    /// so `get_image` can reconstruct a `TileLocator::S3`).
    pub fn from_tiles(tiles: Vec<Tile<T>>, paths: Vec<PathBuf>) -> TileSet<T> {
        TileSet::<T> {
            tiles,
            paths,
            etags: Vec::new(),
            images: HashMap::new(),
            source: TileSource::Local(PathBuf::new()),
        }
    }

    /// Set the tile source the set was built from. Used by `get_image` to
    /// build the right `TileLocator` for render-time prepare_tile calls.
    pub fn set_source(&mut self, source: TileSource) {
        self.source = source;
    }

    /// Set the per-tile ETag list (one entry per `paths[i]`, in the same
    /// order). Only meaningful when the source is `TileSource::S3`; ignored
    /// otherwise. An empty vec or a `None` entry means "no etag known", and
    /// `get_image` will pass an empty etag string to `prepare_tile` — which
    /// will fall through to MD5 hashing of fetched bytes.
    pub fn set_etags(&mut self, etags: Vec<Option<String>>) {
        self.etags = etags;
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
    ///
    /// Dispatches on `self.source` so the right `TileLocator` is built —
    /// crucial for S3-source mode where the stored "path" is really the S3
    /// object key and a `TileLocator::Local` fallback would `ENOENT`. The
    /// per-tile ETag (when known) is plumbed through so prepare_tile's
    /// fast-path doesn't have to hash bytes.
    pub fn get_image(
        &self,
        tile: &Tile<T>,
        tile_size: u32,
    ) -> Result<image::ImageBuffer<Rgb<u8>, Vec<u8>>, ImageError> {
        let path = self.get_path(tile);
        let image = self.images.get(&tile.idx).map_or_else(
            || {
                let locator = match &self.source {
                    TileSource::Local(_) => TileLocator::Local(path),
                    TileSource::S3 { bucket, .. } => {
                        // Tile.idx is 1-based; etags is parallel to paths.
                        let etag = self
                            .etags
                            .get((tile.idx as usize).saturating_sub(1))
                            .and_then(|e| e.as_deref())
                            .unwrap_or("");
                        TileLocator::S3 {
                            bucket: bucket.as_str(),
                            key: path.to_str().unwrap_or(""),
                            etag,
                        }
                    }
                };
                prepare_tile(locator, tile_size, true, false)
            },
            |x| Ok(x.clone()),
        )?;
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
            paths,
            etags: Vec::new(),
            images,
            source: TileSource::Local(PathBuf::new()),
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
