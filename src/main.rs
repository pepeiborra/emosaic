#![feature(entry_insert)]
#![feature(generic_const_exprs)]
#![feature(type_changing_struct_update)]
mod mosaic;

use derive_more::Display;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs::create_dir_all;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::{fs, io};

use clap::{self, Parser, Subcommand, ValueEnum};
use image::{imageops, DynamicImage, ImageFormat, Rgb, Rgba, RgbaImage};

use indicatif::{ProgressBar, ProgressStyle};
use mosaic::image::find_images;
use mosaic::tiles::{prepare_tile, TileSet};
use mosaic::{render_nto1, render_random};
use mosaic::{AnalyseTiles, _Nto1};
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use serde::Serialize;

#[derive(Debug, Display)]
#[display(fmt = "{:?}: {}", path, error)]
struct ImageError {
    path: PathBuf,
    error: image::ImageError,
}

fn generate_tile_set<T>(
    tiles_path: &Path,
    tile_size: u32,
    analysis: impl AnalyseTiles<T>,
    extensions: HashSet<&OsStr>,
) -> io::Result<TileSet<T>>
where
    TileSet<T>: Serialize,
{
    let images_paths = find_images(tiles_path, |path: &OsStr| extensions.contains(path))?;
    let pb = ProgressBar::new(images_paths.len() as u64)
        .with_message("Analysing tiles")
        .with_style(
            ProgressStyle::default_bar()
                .template("{msg} {wide_bar} {pos}/{len} ({per_sec})")
                .unwrap(),
        );

    let errors: RwLock<Vec<ImageError>> = RwLock::new(vec![]);
    let images = images_paths
        .into_par_iter()
        .map(|path| {
            let img = prepare_tile(&path, tile_size);
            (path, img)
        })
        .inspect(move |_| pb.inc(1))
        .filter_map(|x| match x {
            (path, Ok(x)) => Some((path, x)),
            (path, Err(error)) => {
                let path = path.strip_prefix(tiles_path).unwrap();
                errors.write().unwrap().push(ImageError {
                    path: path.to_owned(),
                    error,
                });
                None
            }
        });
    let tile_set = analysis.analyse(images);
    let all_errors = errors.into_inner().unwrap();
    if !all_errors.is_empty() {
        eprintln!("Failed to read the following images({}):", all_errors.len());
        for error in all_errors {
            eprintln!("- {}", error);
        }
    }

    Ok(tile_set)
}

#[derive(Parser)]
#[clap(author, version, about, long_about = None)]
struct Cli {
    /// The size of each tile in the output image
    #[clap(default_value_t = 16_u32, short = 's', long, value_parser)]
    tile_size: u32,

    /// Output image path
    #[clap(default_value = "./output.jpg", short, long, value_parser)]
    output_path: PathBuf,

    /// Path to input image
    #[clap(value_parser)]
    img: PathBuf,

    #[clap(subcommand)]
    subcmd: Option<SubCommand>,
}

#[derive(Subcommand)]
enum SubCommand {
    /// This command converts an image into a tile, applying trimming
    /// and resizing to the selected tile size as needed. This is done
    /// automatically at mosaic creation time, but sometimes it is useful to test
    /// the outcome on a specific image
    Prepare,
    Mosaic {
        /// Path to directory containing tile images
        #[clap(value_parser)]
        tiles_dir: PathBuf,

        /// Mosaic mode to use
        #[clap(default_value_t = Mode::_1, arg_enum, short, long, value_parser)]
        mode: Mode,

        /// Deletes analysis cache from tiles directory forcing re-analysis of tiles
        #[clap(short, long, value_parser)]
        force: bool,

        /// Value between 0 and 1 indicating the opacity of the source image overlayed on the output image
        #[clap(default_value_t = 0.0, short, long, value_parser = is_between_zero_and_one)]
        tint_opacity: f64,

        /// Avoid repeating tiles
        #[clap(long)]
        no_repeat: bool,

        #[clap(long, default_value_t = 1)]
        // Downsampling factor applied to the original image
        downsample: u16,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum)]
enum Mode {
    #[clap(id = "1")]
    _1,
    #[clap(id = "2")]
    _2,
    #[clap(id = "3")]
    _3,
    #[clap(id = "4")]
    _4,
    #[clap(id = "5")]
    _5,
    #[clap(id = "6")]
    _6,
    #[clap(id = "8")]
    _8,
    #[clap(id = "16")]
    _16,
    #[clap(id = "32")]
    _32,
    #[clap(id = "64")]
    _64,
    #[clap(id = "128")]
    _128,
    #[clap(id = "random")]
    Random,
}

/// Parses str as f64 and returns the resulting value if between 0 and 1 (inclusive)
fn is_between_zero_and_one(s: &str) -> Result<f64, String> {
    let value: f64 = s.parse().map_err(|e| format!("{}", e))?;
    if (0.0..=1.0).contains(&value) {
        return Ok(value);
    }
    Err(String::from("Value must be between 0 and 1"))
}

fn main() {
    let cli = Cli::parse();

    let Cli {
        img,
        output_path,
        tile_size,
        subcmd,
    } = cli;

    let cache_path: PathBuf = dirs::cache_dir().unwrap().join("mosaic");
    create_dir_all(cache_path).unwrap();

    match subcmd {
        None => (),
        Some(SubCommand::Prepare) => {
            let tile = prepare_tile(&img, tile_size).unwrap();
            tile.save(&output_path).unwrap();
        }
        Some(SubCommand::Mosaic {
            tiles_dir,
            mode,
            force,
            tint_opacity,
            no_repeat,
            downsample
        }) => run_mosaic(
            img,
            output_path,
            tiles_dir,
            mode,
            tile_size,
            tint_opacity,
            no_repeat,
            force,
            downsample
        ),
    }
}

fn run_mosaic(
    img_path: PathBuf,
    output_path: PathBuf,
    tiles_dir: PathBuf,
    mode: Mode,
    tile_size: u32,
    tint_opacity: f64,
    no_repeat: bool,
    force: bool,
    downsample: u16,
) {
    // Open the source image
    eprintln!("Opening source image: {}", img_path.display());
    let img = match image::open(img_path) {
        Ok(img) => img.to_rgb(),
        Err(e) => {
            eprintln!("Failed to open source image: {}", e);
            std::process::exit(1);
        }
    };

    // Read all images in tiles directory
    let extensions: HashSet<&OsStr> = [OsStr::new("jpg"), OsStr::new("jpeg")].into();

    let output = match mode {
        Mode::_1 => n_to_1::<1>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_2 => n_to_1::<4>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_3 => n_to_1::<9>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_4 => n_to_1::<16>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_5 => n_to_1::<25>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_6 => n_to_1::<36>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_8 => n_to_1::<64>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_16 => n_to_1::<256>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_32 => n_to_1::<1024>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_64 => n_to_1::<4096>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::_128=> n_to_1::<16384>(force, &tiles_dir, extensions, &img, tile_size, no_repeat, downsample),
        Mode::Random => {
            let images = find_images(&tiles_dir, |path| extensions.contains(path));
            let mut tile_set = TileSet::<()>::new();
            for path_buf in images.unwrap() {
                tile_set.push_tile(path_buf, ());
            }
            eprintln!("Tile set with {} tiles", tile_set.len());
            render_random(&img, tile_set, tile_size)
        }
    };

    if tint_opacity > 0.0 {
        let mut overlay = RgbaImage::new(img.width(), img.height());
        for x in 0..img.width() {
            for y in 0..img.height() {
                let p = img.get_pixel(x, y);
                let p2: Rgba<u8> = Rgba([p[0], p[1], p[2], (255_f64 * tint_opacity) as u8]);
                overlay.put_pixel(x, y, p2);
            }
        }
        // Scale up to match the output size
        let overlay = imageops::resize(
            &overlay,
            output.width(),
            output.height(),
            image::FilterType::Nearest,
        );
        // Apply overlay
        let mut output2 = DynamicImage::ImageRgb8(output).to_rgba();
        imageops::overlay(&mut output2, &overlay, 0, 0);
        output2
            .save_with_format(output_path, ImageFormat::PNG)
            .unwrap();
        return;
    }

    eprintln!("Writing output file to {}", output_path.display());
    output
        .save_with_format(output_path, ImageFormat::JPEG)
        .unwrap();
}

fn n_to_1<const N: usize>(
    force: bool,
    tiles_dir: &PathBuf,
    extensions: HashSet<&OsStr>,
    original_img: &image::ImageBuffer<image::Rgb<u8>, Vec<u8>>,
    tile_size: u32,
    no_repeat: bool,
    downsample: u16,
) -> image::ImageBuffer<image::Rgb<u8>, Vec<u8>>
where
    [(); N * 3]:,
    {
    let dim = (N as f64).sqrt() as u32;

    // resize the original img by the downsampling factor
    let mut nwidth = original_img.width() / downsample as u32;
    let mut nheight = original_img.height() / downsample as u32;

    // adjust the sizes to be multiples of the dim
    let nwidth_mod = nwidth % dim;
    if nwidth_mod > dim.div_euclid(2) {
        nwidth += dim - nwidth_mod
    } else {
        nwidth -= nwidth_mod
    }
    let nheight_mod = nheight % dim;
    if nheight_mod > dim.div_euclid(2) {
        nheight += dim - nheight_mod
    } else {
        nheight -= nheight_mod
    }

    let img = imageops::resize(
        original_img,
        nwidth,
        nheight,
        image::FilterType::Lanczos3,
    );


    let analysis_cache_path = tiles_dir.join(format!(".emosaic_{}to1", N));
    // Validate the source image dimensions
    if img.width() % dim != 0 || img.height() % dim != 0 {
        eprintln!(
            "Invalid source dimensions ({}x{}): Dimensions must be divisible by {}",
            img.width(),
            img.height(),
            dim
        );
        std::process::exit(1);
    }
    if tile_size % dim != 0 {
        eprintln!("Invalid tile size: Tile size must be divisible by {}", dim);
        std::process::exit(1);
    }
    if force {
        fs::remove_file(&analysis_cache_path).ok();
    }
    let tile_set: TileSet<[Rgb<u8>; N]> = match fs::read(&analysis_cache_path) {
        Ok(bytes) => {
            eprintln!("Reusing analysis cache");
            bincode::deserialize(&bytes).unwrap()
        }
        _ => {
            let tile_set =
                generate_tile_set(tiles_dir, tile_size, _Nto1::<N>(), extensions).unwrap();
            let encoded_tile_set = bincode::serialize(&tile_set).unwrap();
            fs::write(analysis_cache_path, encoded_tile_set).unwrap();
            tile_set
        }
    };
    eprintln!("Tile set with {} tiles", tile_set.len());
    render_nto1(&img, tile_set, tile_size, no_repeat)
}
