#![feature(entry_insert)]
#![feature(generic_const_exprs)]
#![feature(type_changing_struct_update)]
mod mosaic;

use image::imageops::FilterType;
use mosaic::error::ImageError;
use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs::create_dir_all;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, RwLock,
};
use std::time::{Duration, Instant};
use std::{fs, io, thread};

use clap::{self, Args, Parser, Subcommand, ValueEnum};
use image::{imageops, DynamicImage, ImageFormat, Rgb, Rgba, RgbaImage};

use indicatif::{ProgressBar, ProgressStyle};
use mosaic::image::find_images;
use mosaic::tiles::{prepare_tile, prepare_tile_with_date, Tile, TileSet};
use mosaic::{analyse, render_nto1, render_nto1_no_repeat, render_random};
use rayon::iter::{IntoParallelIterator, IntoParallelRefIterator, ParallelIterator};

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

    #[clap(long)]
    /// Crop tiles instead of resizing
    crop: bool,

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
    Mosaic(Mosaic),
}

#[derive(Args)]
struct Mosaic {
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
    /// Downsampling factor applied to the original image
    downsample: u16,

    #[clap(long, value_parser = is_percentage)]
    /// Select one of the best tiles randomly (within x% distance from the best one)
    randomize: Option<f64>,

    #[clap(long, default_values_t = [String::from("jpg"), String::from("jpeg")])]
    /// Extensions of image files in the tiles dir
    extensions: Vec<String>,

    #[clap(long)]
    /// When combined with no-repeat, uses a less accurate but faster algorithm
    greedy: bool,

    #[clap(long)]
    /// Generate HTML output with interactive tile tooltips showing distance and path
    html: bool,
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

fn is_percentage(s: &str) -> Result<f64, String> {
    let value: f64 = s.parse().map_err(|e| format!("{}", e))?;
    if (0.0..=100.0).contains(&value) {
        return Ok(value);
    }
    Err(String::from("Value must be between 0 and 100"))
}

/// Memory monitor that tracks peak RSS usage in a background thread
struct MemoryMonitor {
    peak_rss_kb: Arc<AtomicU64>,
    shutdown: Arc<AtomicBool>,
    _handle: thread::JoinHandle<()>,
}

impl MemoryMonitor {
    /// Start monitoring memory usage in a background thread
    fn start() -> Self {
        let peak_rss_kb = Arc::new(AtomicU64::new(0));
        let shutdown = Arc::new(AtomicBool::new(false));

        let peak_rss_kb_clone = Arc::clone(&peak_rss_kb);
        let shutdown_clone = Arc::clone(&shutdown);

        let handle = thread::spawn(move || {
            while !shutdown_clone.load(Ordering::Relaxed) {
                if let Some(current_rss_kb) = get_current_rss_kb() {
                    // Update peak if current is higher
                    let mut current_peak = peak_rss_kb_clone.load(Ordering::Relaxed);
                    while current_rss_kb > current_peak {
                        match peak_rss_kb_clone.compare_exchange_weak(
                            current_peak,
                            current_rss_kb,
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                        ) {
                            Ok(_) => break,
                            Err(updated_peak) => current_peak = updated_peak,
                        }
                    }
                }
                thread::sleep(Duration::from_millis(100)); // Check every 100ms
            }
        });

        Self {
            peak_rss_kb,
            shutdown,
            _handle: handle,
        }
    }

    /// Get the peak memory usage in MB
    fn get_peak_mb(&self) -> String {
        let peak_kb = self.peak_rss_kb.load(Ordering::Relaxed);
        if peak_kb > 0 {
            format!("{:.1}", peak_kb as f64 / 1024.0)
        } else {
            "N/A".to_string()
        }
    }
}

impl Drop for MemoryMonitor {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

/// Get current RSS (Resident Set Size) in KB for the current process
fn get_current_rss_kb() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("ps")
            .args(["-o", "rss=", "-p"])
            .arg(std::process::id().to_string())
            .output()
            .ok()?;

        let rss_str = String::from_utf8(output.stdout).ok()?;
        rss_str.trim().parse::<u64>().ok()
    }

    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        for line in status.lines() {
            if line.starts_with("VmRSS:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    return parts[1].parse::<u64>().ok();
                }
            }
        }
        None
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

fn print_runtime_stats(start_time: Instant, memory_monitor: &MemoryMonitor) {
    let duration = start_time.elapsed();
    let total_secs = duration.as_secs_f64();

    eprintln!("📊 Runtime Statistics:");
    eprintln!("   Total execution time: {:.2}s", total_secs);

    if total_secs >= 60.0 {
        let mins = total_secs as u64 / 60;
        let secs = total_secs % 60.0;
        eprintln!("   ({} min {:.1}s)", mins, secs);
    }

    if total_secs >= 1.0 {
        eprintln!("   Peak memory usage: {} MB", memory_monitor.get_peak_mb());
    }
}

/// Validates that the tile size is reasonable and divisible by required dimensions
fn validate_tile_size(tile_size: u32) -> Result<(), String> {
    if tile_size == 0 {
        return Err(
            "❌ Tile size must be greater than 0\n💡 Try using a value like 16, 32, or 64"
                .to_string(),
        );
    }
    if tile_size > 1024 {
        return Err("❌ Tile size is too large (maximum: 1024)\n💡 Large tile sizes require significant memory and processing time".to_string());
    }
    Ok(())
}

/// Validates that the input image path exists and is a valid image format
fn validate_input_image(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!(
            "❌ Input image does not exist: {}\n💡 Check the file path and ensure the file exists",
            path.display()
        ));
    }
    if !path.is_file() {
        return Err(format!("❌ Input path is not a file: {}\n💡 Please provide a path to an image file, not a directory", path.display()));
    }

    let valid_extensions = ["jpg", "jpeg", "png", "bmp", "gif", "tiff", "webp"];
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_lowercase();
        if !valid_extensions.contains(&ext_lower.as_str()) {
            return Err(format!(
                "❌ Unsupported image format: {}\n💡 Supported formats: {}",
                ext,
                valid_extensions.join(", ")
            ));
        }
    } else {
        return Err(format!("❌ Input file has no extension\n💡 Please use an image file with a proper extension like .jpg or .png"));
    }

    Ok(())
}

/// Validates that the tiles directory exists and contains images
fn validate_tiles_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!(
            "❌ Tiles directory does not exist: {}\n💡 Create the directory and add image files to use as tiles",
            path.display()
        ));
    }
    if !path.is_dir() {
        return Err(format!("❌ Tiles path is not a directory: {}\n💡 Please provide a path to a directory containing tile images", path.display()));
    }
    Ok(())
}

/// Validates that the output directory exists and is writable
fn validate_output_path(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err(format!(
                "Output directory does not exist: {}",
                parent.display()
            ));
        }
        if !parent.is_dir() {
            return Err(format!(
                "Output parent path is not a directory: {}",
                parent.display()
            ));
        }
    }
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    unsafe { backtrace_on_stack_overflow::enable() };

    let start_time = Instant::now();
    let memory_monitor = MemoryMonitor::start();

    let cli = Cli::parse();

    let Cli {
        img,
        output_path,
        tile_size,
        subcmd,
        crop,
    } = cli;

    // Validate CLI arguments
    validate_tile_size(tile_size)?;
    validate_input_image(&img)?;
    validate_output_path(&output_path)?;

    let cache_path: PathBuf = dirs::cache_dir()
        .ok_or_else(|| "Failed to get cache directory")?
        .join("mosaic");
    create_dir_all(&cache_path).map_err(|e| {
        format!(
            "Failed to create cache directory {}: {}",
            cache_path.display(),
            e
        )
    })?;

    match subcmd {
        None => (),
        Some(SubCommand::Prepare) => {
            let tile = prepare_tile(&img, tile_size, crop)
                .map_err(|e| format!("Failed to prepare tile from {}: {}", img.display(), e))?;
            tile.save(&output_path)
                .map_err(|e| format!("Failed to save tile to {}: {}", output_path.display(), e))?;
            print_runtime_stats(start_time, &memory_monitor);
        }
        Some(SubCommand::Mosaic(args)) => {
            // Validate tiles directory
            validate_tiles_directory(&args.tiles_dir)?;

            let mode = args.mode;
            let tint_opacity = args.tint_opacity;
            let img_path = &img;
            // Open the source image
            eprintln!("Opening source image: {}", img_path.display());
            let img = image::open(img_path)
                .map_err(|e| format!("Failed to open source image {}: {}", img_path.display(), e))?
                .to_rgb8();

            let img_and_stats = match mode {
                Mode::_1 => n_to_1::<1>(args, &img, tile_size, crop),
                Mode::_2 => n_to_1::<4>(args, &img, tile_size, crop),
                Mode::_3 => n_to_1::<9>(args, &img, tile_size, crop),
                Mode::_4 => n_to_1::<16>(args, &img, tile_size, crop),
                Mode::_5 => n_to_1::<25>(args, &img, tile_size, crop),
                Mode::_6 => n_to_1::<36>(args, &img, tile_size, crop),
                Mode::_8 => n_to_1::<64>(args, &img, tile_size, crop),
                Mode::_16 => n_to_1::<256>(args, &img, tile_size, crop),
                Mode::_32 => n_to_1::<1024>(args, &img, tile_size, crop),
                Mode::_64 => n_to_1::<4096>(args, &img, tile_size, crop),
                Mode::_128 => n_to_1::<16384>(args, &img, tile_size, crop),
                Mode::Random => {
                    let images = find_images(&args.tiles_dir, |ext| {
                        args.extensions.contains(&ext.to_string_lossy().to_string())
                    });
                    let mut tile_set = TileSet::<()>::new();
                    let extensions: HashSet<String> =
                        args.extensions.iter().map(|x| x.to_owned()).collect();
                    for path_buf in images.map_err(|e| {
                        format!(
                            "Failed to find images in {}: {}",
                            args.tiles_dir.display(),
                            e
                        )
                    })? {
                        if let Some(ext) = path_buf.extension() {
                            if let Some(ext_str) = ext.to_str() {
                                if extensions.contains(ext_str) && path_buf.exists() {
                                    tile_set.push_tile(path_buf, ());
                                }
                            }
                        }
                    }
                    eprintln!("Tile set with {} tiles", tile_set.len());
                    Ok(ImgAndStats {
                        img: render_random(&img, tile_set, tile_size),
                        stats_img: None,
                        html_generator: None,
                    })
                }
            }
            .map_err(|e| format!("Mosaic generation failed: {}", e))?;

            let output = img_and_stats.img;
            if tint_opacity > 0.0 {
                // Create overlay more efficiently using from_fn
                let alpha_value = (255.0 * tint_opacity) as u8;
                let overlay = RgbaImage::from_fn(img.width(), img.height(), |x, y| {
                    let p = img.get_pixel(x, y);
                    Rgba([p[0], p[1], p[2], alpha_value])
                });

                // Scale up to match the output size
                let overlay = imageops::resize(
                    &overlay,
                    output.width(),
                    output.height(),
                    FilterType::Nearest,
                );

                // Apply overlay
                let mut output2 = DynamicImage::ImageRgb8(output).to_rgba8();
                imageops::overlay(&mut output2, &overlay, 0, 0);

                output2
                    .save_with_format(&output_path, ImageFormat::Png)
                    .map_err(|e| {
                        format!(
                            "Failed to save output image to {}: {}",
                            output_path.display(),
                            e
                        )
                    })?;
                print_runtime_stats(start_time, &memory_monitor);
                return Ok(());
            }

            eprintln!("✓ Mosaic generation completed successfully");
            eprintln!("📝 Writing output file to {}", output_path.display());
            output
                .save_with_format(&output_path, ImageFormat::Png)
                .map_err(|e| {
                    format!(
                        "❌ Failed to save output image to {}: {}\n💡 Ensure the directory is writable and has sufficient disk space",
                        output_path.display(),
                        e
                    )
                })?;

            if let Some(stats_img) = img_and_stats.stats_img {
                let stats_path = output_path.with_extension("stats.png");
                eprintln!(
                    "📊 Writing statistics visualization to {}",
                    stats_path.display()
                );
                stats_img
                    .save_with_format(&stats_path, ImageFormat::Png)
                    .map_err(|e| {
                        format!(
                            "⚠️  Failed to save statistics image to {}: {}\n💡 This is non-critical - the main mosaic was saved successfully",
                            stats_path.display(),
                            e
                        )
                    })?;
                eprintln!("📊 Statistics file saved (shows tile matching quality)");
            }

            // Generate HTML file if requested
            if let Some(html_generator) = img_and_stats.html_generator {
                let html_path = output_path.with_extension("html");
                eprintln!("📄 Generating interactive HTML at {}", html_path.display());

                html_generator(&output_path, &html_path)
                    .map_err(|e| format!("⚠️  Failed to generate HTML file: {}", e))?;

                eprintln!("📄 Interactive HTML file saved (hover over tiles for details)");
            }

            eprintln!(
                "🎉 All done! Your mosaic is ready at {}",
                output_path.display()
            );
            print_runtime_stats(start_time, &memory_monitor);
        }
    }

    print_runtime_stats(start_time, &memory_monitor);
    Ok(())
}

struct ImgAndStats {
    img: image::ImageBuffer<image::Rgb<u8>, Vec<u8>>,
    stats_img: Option<image::ImageBuffer<image::Rgb<u8>, Vec<u8>>>,
    // Store HTML generation data as a closure that can be called later
    html_generator: Option<
        Box<dyn FnOnce(&std::path::Path, &std::path::Path) -> Result<(), std::io::Error> + Send>,
    >,
}

fn n_to_1<const N: usize>(
    Mosaic {
        extensions,
        force,
        no_repeat,
        downsample,
        randomize,
        tiles_dir,
        greedy,
        html,
        ..
    }: Mosaic,
    original_img: &image::ImageBuffer<image::Rgb<u8>, Vec<u8>>,
    tile_size: u32,
    crop: bool,
) -> Result<ImgAndStats, ImageError>
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

    eprintln!(
        "Resizing source image from {}x{} to {}x{}",
        original_img.width(),
        original_img.height(),
        nwidth,
        nheight
    );

    let img = imageops::resize(original_img, nwidth, nheight, FilterType::Lanczos3);

    let analysis_cache_path = tiles_dir.join(format!(
        ".emosaic_{}to1{}",
        N,
        if crop { "_cropped" } else { "" }
    ));
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
    let extensions: HashSet<_> = extensions.iter().map(|x| x.to_owned()).collect();
    let tile_set = if force {
        None
    } else {
        fs::read(&analysis_cache_path).ok()
    };
    let tile_set: TileSet<[Rgb<u8>; N]> = tile_set
        .and_then(|bytes| bincode::deserialize::<TileSet<[Rgb<u8>; N]>>(&bytes).ok())
        .map(|analysis| {
            eprintln!("Reusing analysis cache");
            // Filter out tiles for files that no longer exist or don't match extensions
            let valid_data: Vec<_> = analysis
                .tiles
                .par_iter()
                .filter_map(|tile| {
                    let path = analysis.get_path(tile);
                    let extension = path.extension()?.to_str()?;
                    if path.exists() && extensions.contains(extension) {
                        Some((path.to_owned(), tile.clone()))
                    } else {
                        None
                    }
                })
                .collect();
            
            // Create new TileSet from valid tiles, preserving date_taken
            let (paths, tiles): (Vec<PathBuf>, Vec<Tile<[Rgb<u8>; N]>>) = valid_data.into_iter().unzip();
            TileSet::from_tiles(tiles, paths)
        })
        .unwrap_or_else(|| {
            let extensions = extensions.iter().map(OsString::from).collect();
            let tile_set = generate_tile_set::<N>(&tiles_dir, tile_size, extensions, crop).unwrap();
            let encoded_tile_set = bincode::serialize(&tile_set).unwrap();
            fs::write(&analysis_cache_path, encoded_tile_set).unwrap();
            tile_set
        });
    eprintln!("Tile set with {} tiles", tile_set.len());
    let result = if no_repeat && !greedy {
        render_nto1_no_repeat(&img, tile_set, tile_size)?
    } else {
        render_nto1(&img, tile_set, tile_size, no_repeat, randomize)
    };

    result.stats.summarise(&result.tile_set);

    // Extract data and create HTML generator if requested
    let image = result.image;
    let stats = result.stats;
    let tile_set = result.tile_set;

    // Clone for different uses
    let stats_for_render = stats.clone();
    let stats_img = Some(stats_for_render.render(tile_size));

    let html_generator = if html {
        eprintln!("📄 HTML output requested - will generate after image save");
        
        // Clone the necessary data for the closure
        let stats_clone = stats.clone();
        let tile_set_clone = tile_set.clone();
        let ts = tile_size;
        Some(Box::new(move |mosaic_path: &std::path::Path, html_path: &std::path::Path| -> Result<(), std::io::Error> {
            stats_clone.generate_html(mosaic_path, html_path, &tile_set_clone, ts)
        }) as Box<dyn FnOnce(&std::path::Path, &std::path::Path) -> Result<(), std::io::Error> + Send>)
    } else {
        None
    };

    Ok(ImgAndStats {
        img: image,
        stats_img,
        html_generator,
    })
}

fn generate_tile_set<const N: usize>(
    tiles_path: &Path,
    tile_size: u32,
    extensions: HashSet<OsString>,
    crop: bool,
) -> io::Result<TileSet<[Rgb<u8>; N]>>
where
    // TileSet<T>: Serialize,
    // T: std::hash::Hash + Eq + Copy,
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
    let tile_data: Vec<_> = images_paths
        .into_par_iter()
        .map(|path| {
            let img_and_date = prepare_tile_with_date(&path, tile_size, crop);
            (path, img_and_date)
        })
        .inspect(move |_| pb.inc(1))
        .filter_map(|x| match x {
            (path, Ok((img, date_taken))) => Some((path, img, date_taken)),
            (path, Err(error)) => {
                let path = path.strip_prefix(tiles_path).unwrap();
                errors.write().unwrap().push(ImageError {
                    path: path.to_owned(),
                    ..error
                });
                None
            }
        })
        .collect();

    let dates = tile_data
        .iter()
        .filter(|(_, _, date)| date.is_some())
        .count();

    // Create tiles with date information
    let tiles: Vec<_> = tile_data
        .into_iter()
        .enumerate()
        .map(|(idx, (path, img, date_taken))| {
            let colors = analyse::<N>(img);
            let tile = Tile::new_with_date((idx + 1) as u16, colors, date_taken);
            (path, tile)
        })
        .collect();

    let tile_set = TileSet::from_tiles(
        tiles.iter().map(|(_, tile)| tile.clone()).collect(),
        tiles.into_iter().map(|(path, _)| path).collect(),
    );
    let all_errors = errors.into_inner().unwrap();
    if !all_errors.is_empty() {
        eprintln!("Failed to read the following images({}):", all_errors.len());
        for error in all_errors {
            eprintln!("- {}", error);
        }
    }

    summarise_tileset(&tile_set);
    eprintln!("Extracted {} dates successfully", dates);
    Ok(tile_set)
}

fn summarise_tileset<T>(tile_set: &TileSet<T>)
where
    T: std::hash::Hash + Eq + Copy,
{
    let mut tiles_by_color: HashMap<T, u16> = HashMap::new();
    for tile in tile_set.tiles.iter() {
        *tiles_by_color.entry(tile.colors).or_default() += 1;
    }

    eprintln!(
        "The analysis produced {} unique tiles",
        tiles_by_color.len()
    );
}
