use std::collections::HashSet;
use std::sync::{Mutex, RwLock};

use ::image::RgbImage;
use ::image::{imageops, Rgb};
use indicatif::{ProgressBar, ProgressStyle};
use kiddo::fixed::distance::Manhattan;
use kiddo::NearestNeighbour;
use rand::prelude::IteratorRandom;
use rand::prelude::SliceRandom;
use rayon::iter::{IndexedParallelIterator, IntoParallelIterator, ParallelIterator};

use super::algorithms::compare_matches;
use super::analysis::get_img_colors;
use super::error::ImageError;
use super::stats::RenderStats;
use super::tiles::{flipped_coords, Tile, TileSet};
use fixed::traits::FromFixed;

/// Configuration for rendering operations
#[derive(Debug, Clone)]
pub struct RenderConfig {
    /// Number of nearest neighbors to consider for randomized selection
    pub random_neighbor_count: usize,
    /// Progress bar template
    pub progress_template: String,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            random_neighbor_count: 20,
            progress_template: "{msg} {wide_bar} {pos}/{len} ({per_sec})".to_string(),
        }
    }
}

/// Core rendering function that creates a mosaic by applying tiles to segments of the source image.
///
/// This function processes the image in parallel, dividing it into segments and applying
/// tiles based on the provided tile generation function.
///
/// # Arguments
/// * `source_img` - The source image to create a mosaic from
/// * `tile_size` - Size of each tile in pixels
/// * `step` - Step size for tile placement (affects tile density)
/// * `get_tile` - Function that generates a tile image for given coordinates
///
/// # Returns
/// A new `RgbImage` containing the rendered mosaic
pub fn render(
    source_img: &RgbImage,
    tile_size: u32,
    step: u32,
    get_tile: impl Fn(u32, u32) -> ::image::ImageBuffer<Rgb<u8>, Vec<u8>> + Sync,
) -> RgbImage {
    let tile_size_stepped = tile_size / step;

    let config = RenderConfig::default();
    let pb = ProgressBar::new((source_img.height() * source_img.width() / step / step) as u64)
        .with_message("Rendering")
        .with_style(
            ProgressStyle::default_bar()
                .template(&config.progress_template)
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
    let pb = ProgressBar::new((source_img.height() / step) as u64).with_message("Merging");
    for (i, segment) in segments.into_iter().enumerate() {
        pb.inc(1);
        imageops::replace(&mut output, &segment, 0, i as i64 * tile_size as i64);
    }
    output
}

/// Renders a mosaic using N-to-1 tile matching with KD-tree optimization.
///
/// This function analyzes the source image in N-pixel blocks and finds the best matching
/// tiles from the tile set using nearest neighbor search in color space.
///
/// # Arguments
/// * `source_img` - The source image to create a mosaic from
/// * `tile_set` - Set of available tiles with pre-computed color analysis
/// * `tile_size` - Size of each output tile in pixels
/// * `no_repeat` - If true, prevents tiles from being used multiple times
/// * `randomize` - Optional randomization factor (0-100%) for tile selection
///
/// # Returns
/// * `Ok(RenderResult)` - Contains the rendered image, statistics, and tile set
/// * `Err(RenderError)` - If rendering fails due to insufficient tiles or other errors
///
/// # Examples
/// ```
/// use emosaic::mosaic::rendering::render_nto1;
/// // let result = render_nto1(&image, tile_set, 32, false, None)?;
/// ```
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
        panic!(
            "❌ Insufficient tiles for no-repeat mode: need {} tiles but only have {} available",
            (htiles * vtiles) as usize,
            tile_set.len() * 2
        );
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
                    let config = RenderConfig::default();
                    let mut closest_ones = kdtree
                        .read()
                        .unwrap()
                        .nearest_n::<Manhattan>(&tile.coords(), config.random_neighbor_count);
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
                .unwrap_or_else(|| panic!("Tile not found: {:?}", closest.item));
            if no_repeat {
                writer.unwrap().remove(&tile.coords(), closest.item);
            }
        }
        stats
            .lock()
            .unwrap()
            .push_tile(x, y, &tile, closest.distance);
        tile_set.get_image(&tile, tile_size).unwrap_or_else(|_| {
            panic!(
                "Image not found: {}",
                tile_set.get_path(&tile).to_str().unwrap()
            )
        })
    });

    let stats = stats.into_inner().unwrap();

    RenderResult {
        image,
        stats,
        tile_set,
    }
}

/// Result of a rendering operation containing the output image and metadata.
///
/// This struct encapsulates the complete result of a mosaic rendering operation,
/// including the final image, rendering statistics, and the tile set used.
pub struct RenderResult<const N: usize> {
    /// The final rendered mosaic image
    pub image: RgbImage,
    /// The tile set used for rendering (may have been modified if no_repeat was used)
    pub tile_set: TileSet<[Rgb<u8>; N]>,
    /// Statistics about the rendering process (tile usage, distances, etc.)
    pub stats: RenderStats<super::tiles::SIZE>,
}

/// Renders a mosaic with no tile repetition using an optimized greedy algorithm.
///
/// This function uses a more sophisticated algorithm that pre-computes all tile matches,
/// sorts them by quality, and selects tiles in order while ensuring no repeats.
///
/// # Arguments
/// * `source_img` - The source image to create a mosaic from
/// * `tile_set` - Set of available tiles with pre-computed color analysis
/// * `tile_size` - Size of each output tile in pixels
///
/// # Returns
/// * `Ok(RenderResult)` - Contains the rendered image, statistics, and tile set
/// * `Err(ImageError)` - If rendering fails due to image processing errors
///
/// # Performance
/// This algorithm is more computationally expensive than `render_nto1` but produces
/// higher quality results when tile uniqueness is required.
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

    let htiles = source_img.width() / step;
    let vtiles = source_img.height() / step;
    eprintln!(
        "Doing {}x{} tiles resulting in a {}x{} image (step: {step})",
        htiles,
        vtiles,
        htiles * tile_size,
        vtiles * tile_size,
    );

    if (htiles * vtiles) as usize > tile_set.len() * 2 {
        panic!(
            "❌ Insufficient tiles for no-repeat mode: need {} tiles but only have {} available",
            (htiles * vtiles) as usize,
            tile_set.len() * 2
        );
    }

    let tile_size_stepped = tile_size / step;

    let config = RenderConfig::default();
    let pb = ProgressBar::new((vtiles * htiles) as u64)
        .with_message("Scoring")
        .with_style(
            ProgressStyle::default_bar()
                .template(&config.progress_template)
                .unwrap(),
        );

    let compute_nearest = |n: u32, k| {
        let x = n / vtiles * step;
        let y = n % vtiles * step;
        let tile = Tile::from_colors(get_img_colors(x, y, step, source_img));
        let coords = tile.coords();
        let mut nearest = kdtree.read().unwrap().nearest_n::<Manhattan>(&coords, k);
        nearest.reverse();
        nearest
    };

    let mut matches: Vec<_> = (0..htiles * vtiles)
        .into_par_iter()
        .inspect(|_| pb.inc(1))
        .map(|n| (n, compute_nearest(n, 100000)))
        .collect();

    // sort matches by nearest score, reversed as we pop from the end
    matches.sort_unstable_by(|(_, a), (_, b)| {
        b.last().unwrap().distance.cmp(&a.last().unwrap().distance)
    });

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
                .template(&config.progress_template)
                .unwrap(),
        );

    // select tiles by nearest order, removing as we go
    while let Some((n, mut nearest)) = matches.pop() {
        let nearest_item = if let Some(item) = nearest.pop() {
            item
        } else {
            continue; // Skip if no tiles available
        };
        let item = nearest_item.item;
        if used.insert(item) {
            used.insert(-item);
            let tile = tile_set.get_tile(item).unwrap();
            let tile_img = tile_set.get_image(&tile, tile_size)?;
            let tile_x = (n / vtiles) * tile_size;
            let tile_y = (n % vtiles) * tile_size;
            // eprintln!("n={n}, tile_x={tile_x}, tile_y={tile_y}");
            imageops::overlay(&mut image, &tile_img, tile_x.into(), tile_y.into());
            stats
                .lock()
                .unwrap()
                .push_tile(tile_x, tile_y, &tile, nearest_item.distance);
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
                nearest = compute_nearest(n, 10);
            }
            // ordered reinsert of nearest in matches
            match matches.binary_search_by(|(_, x)| compare_matches(&nearest, x)) {
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

/// Renders a mosaic with completely random tile selection.
///
/// This function creates a mosaic by placing random tiles at each position,
/// without considering color matching or tile optimization.
///
/// # Arguments
/// * `source_img` - The source image (used only for dimensions)
/// * `tile_set` - Set of available tiles (no color analysis needed)
/// * `tile_size` - Size of each output tile in pixels
///
/// # Returns
/// A new `RgbImage` containing the random tile mosaic
///
/// # Performance
/// This is the fastest rendering method but produces the lowest visual quality.
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
                    .get_image(tile_set.random_tile(), tile_size)
                    .expect("Image not found"),
                (tile_x * tile_size).into(),
                (tile_y * tile_size).into(),
            );
        }
    }
    output
}
