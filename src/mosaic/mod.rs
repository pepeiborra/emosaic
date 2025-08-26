pub mod algorithms;
pub mod analysis;
pub mod color;
pub mod error;
pub mod image;
pub mod rendering;
pub mod stats;
pub mod tiles;
pub mod web;

// Re-export key types and functions for backwards compatibility
pub use analysis::analyse;
pub use rendering::{render_nto1, render_nto1_no_repeat, render_random};

#[cfg(test)]
mod tests {
    use itertools::Itertools;
    use num_integer::Roots;
    use rayon::iter::{IntoParallelIterator, IntoParallelRefIterator, ParallelIterator};

    use super::*;
    use std::path::PathBuf;
    use ::image::{Rgb, RgbImage};
    use tiles::TileSet;

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
        let pow = 2u32.pow(N as u32) - 1;
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
        eprintln!("Creating TileSet from {} tiles", universe.len());
        let tile_set: TileSet<[Rgb<u8>; N]> = universe
            .par_iter()
            .map(|img| (PathBuf::new(), img.clone(), analyse::<N>(img.clone())))
            .collect();
        eprintln!("TileSet created successfully with {} tiles", tile_set.len());

        for (i, img) in universe.iter().enumerate() {
            eprintln!("Rendering image {} of {}", i + 1, universe.len());
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
                ::image::imageops::overlay(&mut img, tile, 0, i as i64 * dim as i64);
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
    }
    
    #[test]
    fn test_analyse_tiles_consistency_4() {
        gen_test_analyse_tiles_consistency::<4>();
    }
    
    #[test]
    fn test_analyse_tiles_consistency_9() {
        gen_test_analyse_tiles_consistency::<9>();
    }
}