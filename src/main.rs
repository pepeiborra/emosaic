#![feature(iter_advance_by)]
mod mosaic;

use std::collections::HashSet;
use std::ffi::OsStr;
use std::{fs, io};
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use derive_more::Display;

use clap::{self, Parser, ValueEnum};
use image::{imageops, DynamicImage, ImageFormat, RgbImage, Rgba, RgbaImage};

use indicatif::ProgressBar;
use mosaic::image::{find_images, read_image};
use mosaic::{
    analysis::{_1to1, _4to1},
    image::read_images_in_dir,
    render_1to1, render_4to1, render_random, Tile, TileSet,
};
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use serde::Serialize;

trait AnalyseTiles<T> {
    fn analyse(self:Self, images: impl ParallelIterator<Item = (PathBuf, RgbImage)>) -> TileSet<T>;
}

#[derive(Debug, Display)]
#[display(fmt = "{:?}: {}", path, error)]
struct ImageError {
    path: PathBuf,
    error: image::ImageError,
}

fn generate_tile_set<T: Serialize>(
    tiles_path: &Path,
    cache_path: &Path,
    analysis: impl AnalyseTiles<T>,
    extensions: HashSet<&str>,
) -> io::Result<TileSet<T>> {
    let extensions: HashSet<&OsStr> = extensions.into_iter().map(|s| OsStr::new(s)).collect();
    let images_paths = find_images(tiles_path, |path: &OsStr| extensions.contains(path))?;
    let pb = ProgressBar::new(images_paths.len() as u64);

    let errors: RwLock<Vec<ImageError>> = RwLock::new(vec![]);
    let images = images_paths.into_par_iter().map(|path| {
            let img = read_image(&path);
            (path, img)
        }).inspect(move |_| pb.inc(1))
        .filter_map(|x| match x {
            (path, Ok(x)) => Some((path,x)),
            (path, Err(error)) => {
                let path = path.strip_prefix(tiles_path).unwrap();
                errors.write().unwrap().push(ImageError{path:path.to_owned(), error});
                None
            }
        });
    let tile_set = analysis.analyse(images);
    let encoded_tile_set = bincode::serialize(&tile_set).unwrap();
    fs::write(&cache_path, encoded_tile_set).unwrap();
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

    /// Value between 0 and 1 indicating the opacity of the source image overlayed on the output image
    #[clap(default_value_t = 0.0, short, long, value_parser = is_between_zero_and_one)]
    tint_opacity: f64,

    /// Output image path
    #[clap(default_value_t = String::from("./output.jpg"), short, long, value_parser)]
    output_path: String,

    /// Mosaic mode to use
    #[clap(default_value_t = Mode::OneToOne, arg_enum, short, long, value_parser)]
    mode: Mode,

    /// Deletes analysis cache from tiles directory forcing re-analysis of tiles
    #[clap(short, long, value_parser)]
    force: bool,

    /// Path to directory containing tile images
    #[clap(value_parser)]
    tiles_dir: String,

    /// Path to input image
    #[clap(value_parser)]
    img: String,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum)]
enum Mode {
    #[clap(id = "1to1")]
    OneToOne,
    #[clap(id = "4to1")]
    FourToOne,
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
        force,
        img,
        output_path,
        tiles_dir,
        mode,
        tile_size,
        tint_opacity,
    } = cli;

    // Open the source image
    let img_path = Path::new(&img);
    let img = match image::open(img_path) {
        Ok(img) => img.to_rgb(),
        Err(e) => {
            eprintln!("Failed to open source image: {}", e);
            std::process::exit(1);
        }
    };

    // Validate the source image dimensions when mode = 4to1
    if mode == Mode::FourToOne && (img.width() % 2 != 0 || img.height() % 2 != 0) {
        eprintln!("Invalid source dimensions ({}x{}): Dimensions must be divisible by 2 when mode is 4to1", img.width(), img.height());
        std::process::exit(1);
    }

    // Read all images in tiles directory
    let tiles_path = Path::new(&tiles_dir);
    let extensions = ["jpg", "jpeg"].into();

    let output = match mode {
        Mode::OneToOne => {
            let analysis_cache_path = tiles_path.join(".emosaic_1to1");
            if force {
                fs::remove_file(&analysis_cache_path).ok();
            }
            let tile_set = match fs::read(&analysis_cache_path) {
                Ok(bytes) =>{
                    eprintln!("Reusing analysis cache");
                    bincode::deserialize(&bytes).unwrap()
                },
                _ => generate_tile_set(tiles_path, &analysis_cache_path, _1to1(), extensions).unwrap(),
            };
            eprintln!("Tile set with {} tiles", tile_set.len());
            render_1to1(&img, tile_set, tile_size)
        }
        Mode::FourToOne => {
            let analysis_cache_path = tiles_path.join(".emosaic_4to1");
            if force {
                fs::remove_file(&analysis_cache_path).ok();
            }
            let tile_set = match fs::read(&analysis_cache_path) {
                Ok(bytes) => {
                    eprintln!("Reusing analysis cache");
                    bincode::deserialize(&bytes).unwrap()
                },
                _ => generate_tile_set(tiles_path, &analysis_cache_path, _4to1(), extensions).unwrap(),
            };
            eprintln!("Tile set with {} tiles", tile_set.len());
            render_4to1(&img, tile_set, tile_size)
        }
        Mode::Random => {
            let images = read_images_in_dir(tiles_path);
            let mut tile_set = TileSet::<()>::new();
            for (path_buf, _) in images {
                let tile = Tile::<()>::new(path_buf, ());
                tile_set.push(tile);
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

    eprintln!("Writing output file to {}", output_path);
    output
        .save_with_format(output_path, ImageFormat::JPEG)
        .unwrap();
}
