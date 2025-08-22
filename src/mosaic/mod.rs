pub mod color;
pub mod error;
pub mod image;
pub mod stats;
pub mod tiles;

use std::collections::HashSet;
use std::sync::{Mutex, RwLock};

use ::image::RgbImage;
use ::image::{imageops, Rgb};
use color::average_color;
use error::ImageError;
use fixed::traits::FromFixed;
use indicatif::{ProgressBar, ProgressStyle};
use kiddo::fixed::distance::Manhattan;
use kiddo::NearestNeighbour;
use rand::prelude::IteratorRandom;
use rand::prelude::SliceRandom;
use rayon::iter::{IndexedParallelIterator, IntoParallelIterator, ParallelIterator};
use stats::RenderStats;
use tiles::{flipped_coords, Tile, TileSet};

pub fn render<'a>(
    source_img: &'a RgbImage,
    tile_size: u32,
    step: u32,
    get_tile: impl Fn(u32, u32) -> ::image::ImageBuffer<Rgb<u8>, Vec<u8>> + Sync,
) -> RgbImage {
    let tile_size_stepped = tile_size / step as u32;

    let pb = ProgressBar::new((source_img.height() * source_img.width() / step / step) as u64)
        .with_message("Rendering")
        .with_style(
            ProgressStyle::default_bar()
                .template("{msg} {wide_bar} {pos}/{len} ({per_sec})")
                .unwrap(),
        );

    let segments: Vec<_> = (0..source_img.height())
        .into_par_iter()
        .step_by(step as usize)
        .map(|y| {
            let mut image = RgbImage::new(source_img.width() * tile_size_stepped, tile_size);
            let mut indices: Vec<_> = (0..source_img.width()).step_by(step as usize).collect();
            indices.shuffle(&mut rand::thread_rng());

            for x in indices.into_iter() {
                pb.inc(1);

                let tile_img = get_tile(x, y);

                // Calculate tile coordinates in output image
                let tile_x = x * tile_size_stepped;
                let tile_y = 0;

                imageops::replace(&mut image, &tile_img, tile_x.into(), tile_y.into());
            }
            image
        })
        .collect();

    let mut output = RgbImage::new(
        source_img.width() * tile_size_stepped,
        source_img.height() * tile_size_stepped,
    );
    let pb = ProgressBar::new((source_img.height() / step as u32) as u64).with_message("Merging");
    for (i, segment) in segments.into_iter().enumerate() {
        pb.inc(1);
        imageops::replace(&mut output, &segment, 0, i as i64 * tile_size as i64);
    }
    output
}

pub fn render_nto1<const N: usize>(
    source_img: &RgbImage,
    tile_set: TileSet<[Rgb<u8>; N]>,
    tile_size: u32,
    no_repeat: bool,
    randomize: Option<f64>,
) -> RenderResult<N>
where
    [(); N * 3]:,
{
    let stats = Mutex::new(RenderStats::new());

    let kdtree = RwLock::new(tile_set.build_kiddo());

    let step = (N as f64).sqrt() as u32;

    let htiles = source_img.width() / step;
    let vtiles = source_img.height() / step;
    eprintln!(
        "Doing {}x{} tiles resulting in a {}x{} image (step: {step})",
        htiles,
        vtiles,
        htiles * tile_size,
        vtiles * tile_size,
    );

    if no_repeat && (htiles * vtiles) as usize > tile_set.len() * 2 {
        panic!("Error: not enough tiles to fill the image without repeating");
    }

    let image = render(source_img, tile_size, step, |x, y| {
        let colors = get_img_colors(x, y, step, source_img);
        let mut tile = Tile::from_colors(colors);
        let closest: NearestNeighbour<_, _>;
        {
            let writer = if no_repeat {
                Some(kdtree.write().unwrap())
            } else {
                None
            };
            match randomize {
                Some(factor) => {
                    let mut closest_ones = kdtree
                        .read()
                        .unwrap()
                        .nearest_n::<Manhattan>(&tile.coords(), 20);
                    closest_ones.sort_by_key(|x| x.distance);
                    let min_distance = f64::from_fixed(closest_ones[0].distance);
                    closest = closest_ones
                        .into_iter()
                        .take_while(|x| {
                            f64::from_fixed(x.distance) - min_distance
                                < factor * min_distance / 100.0
                        })
                        .choose(&mut rand::thread_rng())
                        .unwrap();
                }
                _ => {
                    closest = writer.as_ref().map_or_else(
                        || {
                            kdtree
                                .read()
                                .unwrap()
                                .nearest_one::<Manhattan>(&tile.coords())
                        },
                        |kdtree| kdtree.nearest_one::<Manhattan>(&tile.coords()),
                    );
                }
            }
            assert!(
                closest.item != 0,
                "Closest item should not be zero. Did you use FixedU8? closest: {:?}, len(kdtree): {}",
                closest,
                kdtree.read().unwrap().size()
            );
            tile = tile_set
                .get_tile(closest.item)
                .expect(format!("Tile not found: {:?}", closest.item).as_str());
            if no_repeat {
                writer.unwrap().remove(&tile.coords(), closest.item);
            }
        }
        stats.lock().unwrap().push_tile(&tile, closest.distance);
        tile_set.get_image(&tile, tile_size).expect(&format!(
            "Image not found: {}",
            tile_set.get_path(&tile).to_str().unwrap()
        ))
    });

    let stats = stats.into_inner().unwrap();

    RenderResult {
        image,
        stats,
        tile_set,
    }
}

pub(crate) struct RenderResult<const N: usize> {
    pub(crate) image: RgbImage,
    pub(crate) tile_set: TileSet<[Rgb<u8>; N]>,
    pub(crate) stats: RenderStats<tiles::SIZE>,
}

pub fn render_nto1_no_repeat<const N: usize>(
    source_img: &RgbImage,
    tile_set: TileSet<[Rgb<u8>; N]>,
    tile_size: u32,
) -> Result<RenderResult<N>, ImageError>
where
    [(); N * 3]:,
{
    let stats = Mutex::new(RenderStats::new());

    eprintln!("Building kdtree");
    let kdtree = RwLock::new(tile_set.build_kiddo());
    eprintln!("Built kdtree");

    let step = (N as f64).sqrt() as u32;

    let htiles = source_img.width() / step as u32;
    let vtiles = source_img.height() / step as u32;
    eprintln!(
        "Doing {}x{} tiles resulting in a {}x{} image (step: {step})",
        htiles,
        vtiles,
        htiles * tile_size,
        vtiles * tile_size,
    );

    if (htiles * vtiles) as usize > tile_set.len() * 2 {
        panic!("Error: not enough tiles to fill the image without repeating");
    }

    let tile_size_stepped = tile_size / step as u32;

    let pb = ProgressBar::new((vtiles * htiles) as u64)
        .with_message("Scoring")
        .with_style(
            ProgressStyle::default_bar()
                .template("{msg} {wide_bar} {pos}/{len} ({per_sec})")
                .unwrap(),
        );

    let compute_nearest = |n: u32| {
        let x = n / vtiles * step;
        let y = n % vtiles * step;
        let tile = Tile::from_colors(get_img_colors(x, y, step, source_img));
        let coords = tile.coords();
        let mut nearest = kdtree.read().unwrap().nearest_n::<Manhattan>(&coords, 10);
        nearest.reverse();
        nearest
    };

    let mut matches: Vec<_> = (0..htiles * vtiles)
        .into_par_iter()
        .inspect(|_| pb.inc(1))
        .map(|n| (n, compute_nearest(n)))
        .collect();

    // sort matches by nearest score, reversed as we pop from the end
    matches.sort_unstable_by(|(_, a), (_, b)| compare_matches(a, b));

    let mut image = RgbImage::new(
        source_img.width() * tile_size_stepped,
        source_img.height() * tile_size_stepped,
    );

    let mut used = HashSet::new();

    pb.finish_and_clear();

    let pb = ProgressBar::new((vtiles * htiles) as u64)
        .with_message("Rendering")
        .with_style(
            ProgressStyle::default_bar()
                .template("{msg} {wide_bar} {pos}/{len} ({per_sec})")
                .unwrap(),
        );

    // select tiles by nearest order, removing as we go
    while let Some((n, mut nearest)) = matches.pop() {
        let nearest_item = nearest.pop().unwrap();
        let item = nearest_item.item;
        if used.insert(item) {
            used.insert(-item);
            let tile = tile_set.get_tile(item).unwrap();
            let tile_img = tile_set.get_image(&tile, tile_size)?;
            let tile_x = (n as u32 / vtiles) * tile_size;
            let tile_y = (n as u32 % vtiles) * tile_size;
            // eprintln!("n={n}, tile_x={tile_x}, tile_y={tile_y}");
            imageops::overlay(&mut image, &tile_img, tile_x.into(), tile_y.into());
            stats
                .lock()
                .unwrap()
                .push_tile(&tile, nearest_item.distance);
            let mut tree = kdtree.write().unwrap();
            let mut coords = tile.coords();
            // eprintln!("Removing tile {}", item);
            assert!(
                tree.remove(&coords, item) > 0,
                "item: {:?}, tile: {:?}",
                item,
                tile.flipped
            );
            flipped_coords(&mut coords);
            assert!(
                tree.remove(&coords, -item) > 0,
                "item: {:?}, tile: {:?}",
                item,
                tile.flipped
            );
            pb.inc(1);
        } else {
            if nearest.is_empty() {
                nearest = compute_nearest(n);
            }
            // ordered reinsert of nearest in matches
            match matches.binary_search_by(|(_, x)| compare_matches(&nearest, &x)) {
                Ok(ix) => matches.insert(ix + 1, (n, nearest)),
                Err(e) => matches.insert(e, (n, nearest)),
            }
        }
    }

    let stats = stats.into_inner().unwrap();

    Ok(RenderResult {
        image,
        stats,
        tile_set,
    })
}

fn compare_matches<B: Ord, C>(
    a: &Vec<NearestNeighbour<B, C>>,
    b: &Vec<NearestNeighbour<B, C>>,
) -> std::cmp::Ordering {
    b.last().unwrap().distance.cmp(&a.last().unwrap().distance)
}

fn get_img_colors<const N: usize>(
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

pub fn render_random(source_img: &RgbImage, tile_set: TileSet<()>, tile_size: u32) -> RgbImage {
    let mut output = RgbImage::new(
        source_img.width() * tile_size,
        source_img.height() * tile_size,
    );

    let pb = ProgressBar::new(source_img.height() as u64 * source_img.width() as u64)
        .with_message("Rendering");
    for tile_y in 0..source_img.height() {
        for tile_x in 0..source_img.width() {
            pb.inc(1);
            imageops::overlay(
                &mut output,
                &tile_set
                    .get_image(&tile_set.random_tile(), tile_size)
                    .expect("Image not found"),
                (tile_x * tile_size).into(),
                (tile_y * tile_size).into(),
            );
        }
    }
    output
}

pub(crate) fn analyse<const N: usize>(img: RgbImage) -> [Rgb<u8>; N] {
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

#[cfg(test)]
mod tests {
    use itertools::Itertools;
    use num_integer::Roots;
    use rayon::iter::IntoParallelRefIterator;

    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_tile_set_new() {
        let tile_set: TileSet<()> = TileSet::new();
        assert_eq!(tile_set.len(), 0);
    }

    #[test]
    fn test_tile_set_push() {
        let mut tile_set: TileSet<()> = TileSet::new();
        tile_set.push_tile(PathBuf::new(), ());
        assert_eq!(tile_set.len(), 1);
    }

    #[test]
    fn test_tile_set_map() {
        let mut tile_set: TileSet<u32> = TileSet::new();
        tile_set.push_tile(PathBuf::new(), 42);
        let new_tile_set: TileSet<String> = tile_set.map(|x| x.to_string());
        assert_eq!(new_tile_set.len(), 1);
        assert_eq!(new_tile_set.tiles[0].colors, "42");
    }

    #[test]
    fn test_render_random() {
        let source_img = RgbImage::new(10, 10);
        let mut tile_set: TileSet<()> = TileSet::new();
        let tile_size = 32;
        tile_set.push_tile_with_image(PathBuf::new(), (), RgbImage::new(tile_size, tile_size));
        let output = render_random(&source_img, tile_set, tile_size);
        assert_eq!(output.width(), source_img.width() * tile_size);
        assert_eq!(output.height(), source_img.height() * tile_size);
    }

    #[test]
    fn test_render_nto1() {
        let source_img = RgbImage::new(5, 2);
        let mut tile_set: TileSet<[Rgb<u8>; 1]> = TileSet::new();
        tile_set.push_tile_with_image(PathBuf::new(), [Rgb([0, 0, 0]); 1], RgbImage::new(8, 8));
        let tile_size = 8;
        let output = render_nto1(&source_img, tile_set, tile_size, false, None);
        assert_eq!(output.image.width(), source_img.width() * tile_size);
        assert_eq!(output.image.height(), source_img.height() * tile_size);
    }

    #[test]
    fn test_analyse_tiles() {
        let images = vec![
            (PathBuf::from("image1.jpg"), RgbImage::new(10, 10)),
            (PathBuf::from("image2.jpg"), RgbImage::new(10, 10)),
        ];
        let tile_set = images
            .into_par_iter()
            .map(|(path, img)| (path, analyse::<9>(img)))
            .collect::<Vec<_>>();
        assert_eq!(tile_set.len(), 2);
    }

    fn gen_test_analyse_tiles_consistency<const N: usize>()
    where
        [(); N * 3]:,
    {
        let black = Rgb([0, 0, 0]);
        let white = Rgb([255, 255, 255]);
        let dim = N.sqrt() as u32;
        // generate all the possible black&white tiles of dim*dim size
        let pow = 2u32.pow(N as u32);
        let universe: Vec<_> = (0..pow)
            .map(|index| {
                // translate the index to binary (base 2)
                let bits: Vec<bool> = (0..N).map(|i| (index & (1 << i)) != 0).rev().collect();
                RgbImage::from_fn(dim, dim, |x, y| {
                    if bits[(y * dim + x) as usize] {
                        white
                    } else {
                        black
                    }
                })
            })
            .collect();
        // universe.shuffle(&mut rand::thread_rng());

        // for any image from this universe, the mosaic image should contain only one tile and be an exact match
        let tile_set: TileSet<[Rgb<u8>; N]> = universe
            .par_iter()
            .map(|img| (PathBuf::new(), img.clone(), analyse::<N>(img.clone())))
            .collect();

        for img in universe.iter() {
            let rendered_img = render_nto1(&img, tile_set.clone(), dim, false, None);
            assert_eq!(
                rendered_img.image.into_iter().collect::<Vec<_>>(),
                img.into_iter().collect::<Vec<_>>()
            );
            let rendered_img = render_nto1_no_repeat(&img, tile_set.clone(), dim).unwrap();
            assert_eq!(
                rendered_img.image.into_iter().collect::<Vec<_>>(),
                img.into_iter().collect::<Vec<_>>()
            );
        }

        // for any image built from tiles from this universe without duplicates, the mosaic image should be an exact match
        for tiles in &universe.iter().chunks(2) {
            let mut img = RgbImage::new(dim, 2 * dim);
            for (i, tile) in tiles.enumerate() {
                imageops::overlay(&mut img, tile, 0, i as i64 * dim as i64);
            }
            let rendered_img = render_nto1(&img, tile_set.clone(), dim, false, None);
            assert_eq!(
                rendered_img.image.into_iter().collect::<Vec<_>>(),
                img.into_iter().collect::<Vec<_>>()
            );
            let rendered_img = render_nto1_no_repeat(&img, tile_set.clone(), dim).unwrap();
            assert_eq!(
                rendered_img.image.into_iter().collect::<Vec<_>>(),
                img.into_iter().collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn test_analyse_tiles_consistency_1() {
        gen_test_analyse_tiles_consistency::<1>();
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_4() {
        gen_test_analyse_tiles_consistency::<4>();
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_9() {
        gen_test_analyse_tiles_consistency::<9>();
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_16() {
        gen_test_analyse_tiles_consistency::<16>();
        ()
    }
}
