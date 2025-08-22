pub mod color;
pub mod image;
pub mod tiles;
pub mod stats;

use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

use color::average_color;
use ::image::{imageops, Rgb};
use ::image::RgbImage;
use indicatif::{ProgressBar, ProgressStyle};
use kiddo::fixed::distance::Manhattan;
use rayon::iter::{IndexedParallelIterator, IntoParallelIterator, ParallelIterator};
use stats::Stats;
use tiles::{Tile, TileSet};

pub fn render<'a>(
    source_img: &'a RgbImage,
    tile_size: u32,
    step: usize,
    get_tile: impl Fn(u32, u32) -> ::image::ImageBuffer<Rgb<u8>, Vec<u8>> + Sync,
) -> RgbImage
{
    let tile_size_stepped = tile_size / step as u32;
    let pb = ProgressBar::new(
        (source_img.height() * source_img.width() / (step as u32) / (step as u32)) as u64,
    )
    .with_message("Rendering")
    .with_style(
        ProgressStyle::default_bar()
            .template("{msg} {wide_bar} {pos}/{len} ({per_sec})")
            .unwrap(),
    );

    let segments: Vec<_> = (0..source_img.height())
        .into_par_iter()
        .step_by(step)
        .map(|y| {
            let mut image = RgbImage::new(source_img.width() * tile_size_stepped, tile_size);
            for x in (0..source_img.width()).step_by(step) {
                pb.inc(1);

                let tile_img = get_tile(x, y);

                // Calculate tile coordinates in output image
                let tile_x = x * tile_size_stepped;
                let tile_y = 0;

                imageops::replace(&mut image, &tile_img, tile_x, tile_y);
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
        imageops::replace(&mut output, &segment, 0, i as u32 * tile_size);
    }
    output
}

pub fn render_nto1<const N: usize>(
    source_img: &RgbImage,
    tile_set: TileSet<[Rgb<u8>; N]>,
    tile_size: u32,
    no_repeat: bool,
) -> RgbImage where [(); N*3]:
{
    let stats = Mutex::new(Stats::new());

    let kdtree = Mutex::new(tile_set.build_kiddo());

    let step = (N as f64).sqrt() as usize;

    let res = render(source_img, tile_size, step, |x, y| {
        let mut colors = [Rgb([0, 0, 0]); N];
        for i in 0..N {
            colors[i] = *source_img.get_pixel(x + (i / step) as u32, y + (i % step) as u32)
        }
        let mut tile = Tile::from_colors(colors);
        {
            let mut kdtree = kdtree.lock().unwrap();
            let closest = kdtree.nearest_one::<Manhattan>(&tile.coords());
            assert!(closest.item !=0, "tile: {:?}, closest: {:?}", colors, closest);
            tile = tile_set.get_tile(closest.item).expect(format!("Tile not found: {:?}", closest.item).as_str());
        if no_repeat
            { kdtree.remove(&tile.coords(), closest.item); }
        }
        stats.lock().unwrap().push_tile(&tile);
        tile_set.get_image(&tile, tile_size)
    });

    stats.into_inner().unwrap().summarise(&tile_set);

    res
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
                &tile_set.get_image(&tile_set.random_tile(),tile_size),
                tile_x * tile_size,
                tile_y * tile_size,
            );
        }
    }
    output
}

pub(crate) trait AnalyseTiles<T> {
    fn analyse(self: Self, images: impl ParallelIterator<Item = (PathBuf, RgbImage)>)
        -> TileSet<T>;
}

pub(crate) struct _Nto1<const N: usize>();
impl<const N: usize> AnalyseTiles<[Rgb<u8>; N]> for _Nto1<N> {
    fn analyse(
        self,
        images: impl ParallelIterator<Item = (PathBuf, RgbImage)>,
    ) -> TileSet<[Rgb<u8>; N]> {
        let dim = (N as f64).sqrt();
        let tiles : Vec<_> = images
            .map(|(path_buf, img)| {
                let dim_width = (f64::from(img.width()) / dim).floor() as u32;
                let dim_height = (f64::from(img.height()) / dim).floor() as u32;

                let mut colors = [Rgb([0u8, 0, 0]); N];
                for i in 0..N {
                    let top = (i / dim as usize) as u32;
                    let left = (i % dim as usize) as u32;
                    let rect = (left * dim_width, top * dim_height, dim_width, dim_height);
                    let color = average_color(&img, rect);
                    colors[top as usize * dim as usize + left as usize] = color;
                }

                (path_buf, colors)
            })
            .collect();
        tiles.into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
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
        tile_set.push_tile_with_image( PathBuf::new(), (), RgbImage::new(tile_size, tile_size));
        let output = render_random(&source_img, tile_set, tile_size);
        assert_eq!(output.width(), source_img.width() * tile_size);
        assert_eq!(output.height(), source_img.height() * tile_size);
    }

    #[test]
    fn test_render_nto1() {
        let source_img = RgbImage::new(5, 2);
        let mut tile_set: TileSet<[Rgb<u8>; 1]> = TileSet::new();
        tile_set.push_tile_with_image(PathBuf::new(), [Rgb([0, 0, 0]); 1],RgbImage::new(8, 8));
        let tile_size = 8;
        let output = render_nto1(&source_img, tile_set, tile_size, false);
        assert_eq!(output.width(), source_img.width() * tile_size);
        assert_eq!(output.height(), source_img.height() * tile_size);
    }

    #[test]
    fn test_analyse_tiles() {
        let images = vec![
            (PathBuf::from("image1.jpg"), RgbImage::new(10, 10)),
            (PathBuf::from("image2.jpg"), RgbImage::new(10, 10)),
        ];
        let analyser = _Nto1::<9>();
        let tile_set = analyser.analyse(images.into_par_iter());
        assert_eq!(tile_set.len(), 2);
    }

    fn gen_test_analyse_tiles_consistency<const N: usize>(tile_size: u32, no_repeat: bool) where [(); N*3]:
    {
        let images: Vec<(PathBuf, RgbImage)> = vec![
            (PathBuf::new(), RgbImage::from_pixel(tile_size, tile_size, Rgb([255, 0, 0]))),
            (PathBuf::new(), RgbImage::from_pixel(tile_size, tile_size, Rgb([0, 255, 0]))),
            (PathBuf::new(), RgbImage::from_pixel(tile_size, tile_size, Rgb([0, 0, 255]))),
        ];

        let analyser = _Nto1::<N>();
        let mut tile_set = analyser.analyse(images.into_par_iter());

        // initialize the tile images reusing the colors to avoid hitting the file system
        for tile in tile_set.tiles.clone().iter(){
            tile_set.set_image(tile, RgbImage::from_pixel(tile_size, tile_size, tile.colors[0]));
            }

        let source_img = RgbImage::from_pixel(N as u32, N as u32, Rgb([255, 0, 0]));
        let rendered_img = render_nto1(&source_img, tile_set, tile_size, no_repeat);

        // Check if the rendered image is consistent with the tiles
        for y in 0..rendered_img.height() {
            for x in 0..rendered_img.width() {
                let pixel = rendered_img.get_pixel(x, y);
                assert_eq!(pixel, &Rgb([255, 0, 0]));
            }
        }
    }

    // #[test]
    // fn test_analyse_tiles_consistency_1_no_repeat() {
    //     gen_test_analyse_tiles_consistency::<1>(1, true);
    //     ()
    // }

    // #[test]
    // fn test_analyse_tiles_consistency_1_4_no_repeat() {
    //     gen_test_analyse_tiles_consistency::<1>(4, true);
    //     ()
    // }
    // #[test]
    // fn test_analyse_tiles_consistency_4_no_repeat() {
    //     gen_test_analyse_tiles_consistency::<4>(4, true);
    //     ()
    // }
    // #[test]
    // fn test_analyse_tiles_consistency_4_8_no_repeat() {
    //     gen_test_analyse_tiles_consistency::<4>(8, true);
    //     ()
    // }
    // #[test]
    // fn test_analyse_tiles_consistency_9_no_repeat() {
    //     gen_test_analyse_tiles_consistency::<9>(9, true);
    //     ()
    // }
    // #[test]
    // fn test_analyse_tiles_consistency_16_no_repeat() {
    //     gen_test_analyse_tiles_consistency::<16>(16, true);
    //     ()
    // }
    #[test]
    fn test_analyse_tiles_consistency_1() {
        gen_test_analyse_tiles_consistency::<1>(1, false);
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_1_4() {
        gen_test_analyse_tiles_consistency::<1>(4, false);
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_4() {
        gen_test_analyse_tiles_consistency::<4>(4, false);
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_4_8() {
        gen_test_analyse_tiles_consistency::<4>(8, false);
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_9() {
        gen_test_analyse_tiles_consistency::<9>(9, false);
        ()
    }
    #[test]
    fn test_analyse_tiles_consistency_16() {
        gen_test_analyse_tiles_consistency::<16>(16, false);
        ()
    }
}
