use std::collections::HashMap;
use std::convert::TryInto;
use std::hash::Hash;
use std::hash::Hasher;
use std::iter::FromIterator;
use std::ops::Deref;
use std::ops::Div;
use std::path::{Path, PathBuf};

use ::image::imageops;
use ::image::Rgb;
use exif::In;
use exif::Tag;
use image::error::LimitError;
use image::imageops::FilterType;
use image::DynamicImage;
use itertools::MultiUnzip;
use num_integer::Roots;
use rand::prelude::*;
use rayon::iter::FromParallelIterator;
use rayon::iter::IntoParallelIterator;
use rayon::iter::ParallelIterator;
use serde::ser::SerializeTuple;
use serde::{Deserialize, Serialize};
use typenum::U0;

use super::error::ImageError;

pub(crate) type SIZE = fixed::FixedU32<U0>;

#[derive(Clone, Debug, Eq)]
pub struct Tile<T> {
    pub colors: T,
    pub idx: u16,
    pub flipped: bool,
}

impl<T> PartialEq for Tile<T> {
    fn eq(&self, other: &Self) -> bool {
        self.idx == other.idx && self.flipped == other.flipped
    }
}

impl<T> Hash for Tile<T> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.idx.hash(state);
        self.flipped.hash(state);
    }
}

impl<T: Copy> Copy for Tile<T> {}
impl<T: Default> Default for Tile<T> {
    fn default() -> Self {
        Self::new(Default::default(), Default::default())
    }
}

impl<T> Serialize for Tile<T>
where
    T: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut st = serializer.serialize_tuple(2)?;
        st.serialize_element(&self.colors)?;
        st.serialize_element(&self.idx)?;
        st.end()
    }
}

impl<'de, T> Deserialize<'de> for Tile<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let (colors, idx) = Deserialize::deserialize(deserializer)?;
        Ok(Tile::new(idx, colors))
    }
}

impl<T> Tile<T> {
    pub fn from_colors(colors: T) -> Tile<T> {
        Tile::new(0, colors)
    }
    fn new(idx: u16, colors: T) -> Tile<T> {
        Tile {
            idx,
            colors,
            flipped: false,
        }
    }

    pub fn map<T1>(self, f: impl FnOnce(T) -> T1) -> Tile<T1> {
        Tile {
            colors: f(self.colors),
            ..self
        }
    }
}

impl<const N: usize> Tile<[Rgb<u8>; N]> {
    /// Convert the tile into a vectorial space
    pub fn coords(&self) -> [SIZE; N * 3] {
        let mut result = [0u8.into(); N * 3];
        for i in 0..N {
            let color = self.colors[i];
            let i3 = i * 3;
            result[i3] = color[0].into();
            result[i3 + 1] = color[1].into();
            result[i3 + 2] = color[2].into();
        }
        if self.flipped {
            flipped_coords(&mut result);
        }
        result
    }
}
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
    pub fn new() -> TileSet<T> {
        TileSet::from_tiles(vec![], vec![])
    }

    pub fn from_tiles(tiles: Vec<Tile<T>>, paths: Vec<PathBuf>) -> TileSet<T> {
        TileSet::<T> {
            tiles,
            paths,
            images: HashMap::new().into(),
        }
    }
    pub fn random_tile(&self) -> &Tile<T> {
        let mut rng = thread_rng();
        let i = rng.gen_range(0, self.tiles.len());
        &self.tiles[i]
    }

    pub fn len(&self) -> usize {
        self.tiles.len()
    }
    #[allow(dead_code)]
    pub fn map<T1>(self, f: fn(T) -> T1) -> TileSet<T1> {
        let tiles = self.tiles.into_iter().map(|t| t.map(f)).collect();
        TileSet { tiles, ..self }
    }
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
    pub fn get_tile(&self, idx: i16) -> Option<Tile<T>>
    where
        T: Copy,
    {
        let tile = self.tiles.get(idx.abs() as usize - 1).map(|tile| Tile {
            flipped: idx < 0,
            ..*tile
        });
        assert!(tile.map_or(true, |t| t.idx == idx.abs() as u16));
        tile
    }
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
        // assert!(kd.size() as usize == self.tiles.len() * 2);
        // eprintln!("Building kd-tree {:?}", kd);
        kd
    }
}

pub(crate) fn flipped_coords<A, const N: usize>(coords: &mut [A; N]) {
    // coords is a flattened array of pixel rows for a square image.
    // The first 3 items correspond to the first pixel of the first row, the next 3 to the second pixel, etc.
    // In total there are N/3 pixels and sqrt(N/3) rows
    // We want to flip the pixels in each row to get an horizontally flipped image

    // For 3 rows, there are 9 pixels and 27 coordinates
    // For 4 rows there are 16 pixels and 48 coordinates

    let rows = N.div_euclid(3).sqrt();
    let cols = rows;
    let coords_in_row = cols * 3;

    // We iterate over the rows
    for i in 0..rows {
        // We iterate over the pixels in the row
        for j in 0..cols.div_euclid(2) {
            // swap with the mirror column
            let start = i * coords_in_row + j * 3;
            let start_flipped = (i + 1) * coords_in_row - (j + 1) * 3;
            for h in 0..3 {
                coords.swap(start + h, start_flipped + h);
            }
        }
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

pub fn prepare_tile(
    path: &Path,
    tile_size: u32,
    crop: bool,
) -> Result<::image::ImageBuffer<::image::Rgb<u8>, Vec<u8>>, ImageError> {
    // We cache resized images in the home cache path using their content hash
    let content_hash = md5::compute(std::fs::read(path).map_err(|e| ImageError {
        path: path.to_owned(),
        error: e.into(),
    })?);
    let cache_path = dirs::cache_dir().unwrap().join("mosaic").join(format!(
        "{:x}{}.{}.jpg",
        content_hash,
        if crop { "_cropped" } else { "" },
        tile_size
    ));
    // check if the cache path exists and load it, otherwise resize and save it
    let cached_img: Result<::image::ImageBuffer<_, _>, _> = ::image::open(&cache_path)
        .map_err(|e| ImageError {
            path: path.to_owned(),
            error: e,
        })
        .map(|img| img.to_rgb8());
    cached_img.or_else(|_| {
        let mut tile_img = ::image::open(path)
            .map_err(|e| ImageError {
                path: path.to_owned(),
                error: e,
            })?
            .to_rgb8();
        // Crop all the white pixels from the edges
        let is_white_pixel = |pixel: &Rgb<u8>| pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240;

        let w = tile_img.width();
        let h = tile_img.height();

        if w < tile_size || h < tile_size {
            return Err(ImageError {
                path: path.to_owned(),
                error: ::image::ImageError::Limits(LimitError::from_kind(
                    image::error::LimitErrorKind::DimensionError,
                )),
            });
        }

        let from_left: Vec<u32> = (0..h)
            .map(|y| {
                (0..w)
                    .find(|x| {
                        let pixel = tile_img.get_pixel(*x, y);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(w)
            })
            .collect();

        let from_right: Vec<u32> = from_left
            .iter()
            .enumerate()
            .map(|(y, x)| {
                (*x..w)
                    .rev()
                    .find(|x| {
                        let pixel = tile_img.get_pixel(*x, y as u32);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(0)
            })
            .collect();

        let from_top: Vec<u32> = (0..w)
            .map(|x| {
                (0..h)
                    .find(|y| {
                        let pixel = tile_img.get_pixel(x, *y);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(h)
            })
            .collect();

        let from_bottom: Vec<u32> = from_top
            .iter()
            .enumerate()
            .map(|(x, y)| {
                (*y..h)
                    .rev()
                    .find(|y| {
                        let pixel = tile_img.get_pixel(x as u32, *y);
                        !is_white_pixel(pixel)
                    })
                    .unwrap_or(0)
            })
            .collect();

        let first_non_white_col = most_common_value(from_left.into_iter().filter(|x| *x != w));
        let last_non_white_col = most_common_value(from_right.into_iter().filter(|x| *x != 0));
        let first_non_white_row = most_common_value(from_top.into_iter().filter(|x| *x != h));
        let last_non_white_row = most_common_value(from_bottom.into_iter().filter(|x| *x != 0));

        assert!(first_non_white_col < last_non_white_col);
        assert!(first_non_white_row < last_non_white_row);

        let w = last_non_white_col - first_non_white_col;
        let h = last_non_white_row - first_non_white_row;

        let mut tile_img = imageops::crop(
            &mut tile_img,
            first_non_white_col,
            first_non_white_row,
            w,
            h,
        );
        if crop {
            // tiles must be square, so get the largest square that fits inside the image
            let size = w.min(h);
            let x0 = (w - size).div(2);
            let y0 = (h - size).div(2);
            tile_img.change_bounds(x0, y0, size, size);
        }

        let tile_img =
            imageops::resize(tile_img.deref(), tile_size, tile_size, FilterType::Lanczos3);
        let orientation = get_jpeg_orientation(path).unwrap_or(1);
        let tile_img = rotate(tile_img.into(), orientation);
        tile_img.save(cache_path).unwrap();
        Ok(tile_img.into())
    })
}

fn get_jpeg_orientation(file_path: &Path) -> Result<u32, exif::Error> {
    let file = std::fs::File::open(file_path).expect("problem opening the file");
    let mut bufreader = std::io::BufReader::new(&file);
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut bufreader)?;
    let orientation: u32 = match exif.get_field(Tag::Orientation, In::PRIMARY) {
        Some(orientation) => match orientation.value.get_uint(0) {
            Some(v @ 1..=8) => v,
            _ => 1,
        },
        None => 1,
    };

    Ok(orientation)
}

fn rotate(mut img: DynamicImage, orientation: u32) -> DynamicImage {
    let rgba = img.color().has_alpha();
    img = match orientation {
        2 => DynamicImage::ImageRgba8(imageops::flip_horizontal(&img)),
        3 => DynamicImage::ImageRgba8(imageops::rotate180(&img)),
        4 => DynamicImage::ImageRgba8(imageops::flip_vertical(&img)),
        5 => DynamicImage::ImageRgba8(imageops::flip_horizontal(&imageops::rotate90(&img))),
        6 => DynamicImage::ImageRgba8(imageops::rotate90(&img)),
        7 => DynamicImage::ImageRgba8(imageops::flip_horizontal(&imageops::rotate270(&img))),
        8 => DynamicImage::ImageRgba8(imageops::rotate270(&img)),
        _ => img,
    };
    if !rgba {
        img = DynamicImage::ImageRgb8(img.into_rgb8());
    }
    img
}

fn most_common_value(values: impl Iterator<Item = u32>) -> u32 {
    let most_common = values
        .fold(HashMap::new(), |mut acc, x| {
            *acc.entry(x).or_insert(0) += 1;
            acc
        })
        .into_iter()
        .max_by_key(|&(_, count)| count)
        .unwrap_or((0, 0))
        .0;
    most_common
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_most_common_value() {
        let values = vec![1, 2, 2, 3, 3, 3, 4];
        let most_common = most_common_value(values.into_iter());
        assert_eq!(most_common, 3);
    }

    #[test]
    fn test_prepare_tile() {
        let path = Path::new("example/warhol.png");
        let tile_size = 32;
        let result = prepare_tile(path, tile_size, true);
        assert!(result.is_ok());
        let tile_img = result.unwrap();
        assert_eq!(tile_img.width(), tile_size);
        assert_eq!(tile_img.height(), tile_size);
    }

    #[test]
    fn test_flipped_coords() {
        let mut coords = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        flipped_coords(&mut coords);
        assert_eq!(coords, [4, 5, 6, 1, 2, 3, 10, 11, 12, 7, 8, 9]);
        flipped_coords(&mut coords);
        assert_eq!(coords, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        // Add more test cases here
    }

    #[test]
    fn test_tile_coords() {
        let tile: Tile<[Rgb<u8>; 1]> = Tile::from_colors([Rgb([1, 2, 3])]);
        let coords = tile.coords();
        assert_eq!(coords, [1, 2, 3]);

        let tile: Tile<[Rgb<u8>; 4]> = Tile::from_colors([
            Rgb([1, 2, 3]),
            Rgb([4, 5, 6]),
            Rgb([7, 8, 9]),
            Rgb([10, 11, 12]),
        ]);
        let coords = tile.coords();
        assert_eq!(coords, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }

    // Add more tests here
}
