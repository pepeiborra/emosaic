use std::collections::HashMap;
use std::path::Path;

use image::{ImageBuffer, Rgb, RgbImage};

use super::tiles::{Tile, TileSet};

/// Configuration settings used to generate the mosaic
#[derive(Debug, Clone)]
pub struct MosaicConfig {
    pub tile_size: u32,
    pub mode: String,
    pub no_repeat: bool,
    pub greedy: bool,
    pub crop: bool,
    pub tint_opacity: f32,
    pub downsample: u32,
    pub randomize: Option<f64>,
    pub tiles_dir: String,
    pub title: String,
}

/// Statistics collector for mosaic rendering operations.
///
/// Tracks tile placement positions, distances, and usage patterns
/// to provide analytics about the mosaic generation process.
#[derive(Clone)]
pub struct RenderStats<D> {
    /// Maps tile positions (x, y) to tiles with distance information
    tiles: HashMap<(u32, u32), Tile<D>>,
}

impl<D> RenderStats<D>
where
    f64: From<D>,
    D: std::cmp::Ord,
    D: std::convert::From<u8>,
    D: std::ops::AddAssign,
    D: Copy,
    D: std::fmt::Display,
{
    /// Create a new empty statistics collector.
    pub fn new() -> Self {
        Self {
            tiles: HashMap::new(),
        }
    }

    /// Record a tile placement with its position and color distance.
    ///
    /// # Arguments
    /// * `x` - X coordinate where tile was placed
    /// * `y` - Y coordinate where tile was placed
    /// * `tile` - The tile that was placed
    /// * `distance` - Color distance/quality metric for this tile placement
    pub fn push_tile<T>(&mut self, x: u32, y: u32, tile: &Tile<T>, distance: D) {
        let stats_tile = Tile {
            colors: distance, // Note: repurposing colors field to store distance
            idx: tile.idx,
            flipped: tile.flipped,
            date_taken: tile.date_taken.clone(),
        };
        self.tiles.insert((x, y), stats_tile);
    }

    /// Get the number of tiles recorded in these statistics.
    #[allow(dead_code)]
    pub fn tile_count(&self) -> usize {
        self.tiles.len()
    }

    /// Get access to the tiles map for web generation
    pub(crate) fn tiles(&self) -> &HashMap<(u32, u32), Tile<D>> {
        &self.tiles
    }

    /// Print a summary of mosaic generation statistics.
    ///
    /// Displays:
    /// - Number of unique images used
    /// - Average color distance
    /// - Top 10 most frequently used tiles
    /// - 10 worst color matches
    ///
    /// # Arguments
    /// * `tile_set` - The tile set used for generating the mosaic
    pub fn summarise<T>(&self, tile_set: &TileSet<T>) {
        if self.tiles.is_empty() {
            eprintln!("No tiles recorded in statistics");
            return;
        }

        // Calculate total distance and count tile usage
        let mut total_distance: D = 0_u8.into();
        let mut tile_usage_count: HashMap<&Path, u16> = HashMap::with_capacity(self.tiles.len());

        for tile in self.tiles.values() {
            total_distance += tile.colors;
            let path = tile_set.get_path(tile);
            *tile_usage_count.entry(path).or_insert(0) += 1;
        }

        let unique_tiles = tile_usage_count.len();
        let total_distance_f64: f64 = total_distance.into();
        let tile_count = self.tiles.len() as f64;

        // Print basic statistics
        eprintln!("Mosaic Statistics:");
        eprintln!("  Total tiles placed: {}", self.tiles.len());
        eprintln!("  Unique images used: {}", unique_tiles);
        eprintln!(
            "  Average color distance: {:.3}",
            total_distance_f64 / tile_count
        );

        // Show most frequently used tiles
        let mut usage_by_count: Vec<_> = tile_usage_count.into_iter().collect();
        usage_by_count.sort_by(|(_, a), (_, b)| b.cmp(a));

        eprintln!("\nTop 10 most used tiles:");
        for (i, (path, count)) in usage_by_count.iter().take(10).enumerate() {
            eprintln!("  {}. {} ({} times)", i + 1, path.display(), count);
        }

        // Show worst color matches
        let mut worst_matches: Vec<_> = self.tiles.values().collect();
        worst_matches.sort_by(|a, b| b.colors.cmp(&a.colors));

        eprintln!("\nWorst 10 color matches:");
        for (i, tile) in worst_matches.iter().take(10).enumerate() {
            let path = tile_set.get_path(tile);
            eprintln!(
                "  {}. {} (distance: {})",
                i + 1,
                path.display(),
                tile.colors
            );
        }
    }
    /// Render a grayscale visualization of tile color distances.
    ///
    /// Creates an image where each pixel's brightness represents how well
    /// the tile at that position matched the target color. Darker pixels
    /// indicate better matches (lower distance).
    ///
    /// # Arguments
    /// * `tile_size` - Size of each tile in pixels for coordinate conversion
    ///
    /// # Returns
    /// A grayscale image showing the quality of tile matches
    ///
    /// # Panics
    /// Panics if no tiles have been recorded in the statistics
    pub fn render(self, tile_size: u32) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
        if self.tiles.is_empty() {
            panic!("Cannot render visualization: no tiles recorded");
        }

        if tile_size == 0 {
            panic!("Tile size must be greater than 0");
        }

        // Find the bounds of the mosaic
        let max_x = self.tiles.keys().map(|(x, _)| *x).max().unwrap_or(0);
        let max_y = self.tiles.keys().map(|(_, y)| *y).max().unwrap_or(0);

        // Find the maximum distance for normalization
        let distances: Vec<f64> = self.tiles.values().map(|t| t.colors.into()).collect();
        let max_distance = distances
            .iter()
            .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .copied()
            .unwrap_or(1.0); // Avoid division by zero

        // Create the visualization image
        let image_width = (max_x / tile_size) + 1;
        let image_height = (max_y / tile_size) + 1;
        let mut image = RgbImage::new(image_width, image_height);

        // Fill the image with distance visualizations
        for ((x, y), tile) in &self.tiles {
            let distance: f64 = tile.colors.into();
            let normalized_distance = if max_distance > 0.0 {
                distance / max_distance
            } else {
                0.0
            };

            let brightness = (normalized_distance * 255.0) as u8;
            let color = Rgb([brightness, brightness, brightness]);
            image.put_pixel(*x / tile_size, *y / tile_size, color);
        }

        image
    }
}

impl<D> Default for RenderStats<D>
where
    f64: From<D>,
    D: std::cmp::Ord,
    D: std::convert::From<u8>,
    D: std::ops::AddAssign,
    D: Copy,
    D: std::fmt::Display,
{
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mosaic::tiles::TileSet;
    use image::Rgb;
    use std::path::PathBuf;

    #[test]
    fn test_render_stats_new() {
        let stats: RenderStats<u32> = RenderStats::new();
        assert_eq!(stats.tile_count(), 0);
    }

    #[test]
    fn test_render_stats_default() {
        let stats: RenderStats<u32> = RenderStats::default();
        assert_eq!(stats.tile_count(), 0);
    }

    #[test]
    fn test_push_tile() {
        let mut stats: RenderStats<u32> = RenderStats::new();
        let tile = Tile::from_colors([Rgb([255, 0, 0])]);

        stats.push_tile(10, 20, &tile, 100);
        assert_eq!(stats.tile_count(), 1);

        stats.push_tile(30, 40, &tile, 200);
        assert_eq!(stats.tile_count(), 2);
    }

    #[test]
    fn test_summarise_empty() {
        let stats: RenderStats<u32> = RenderStats::new();
        let tile_set: TileSet<[Rgb<u8>; 1]> = TileSet::new();

        // Should not panic, just print empty message
        stats.summarise(&tile_set);
    }

    #[test]
    fn test_summarise_with_tiles() {
        let mut stats: RenderStats<u32> = RenderStats::new();
        let mut tile_set: TileSet<[Rgb<u8>; 1]> = TileSet::new();

        let colors = [Rgb([255, 0, 0])];
        tile_set.push_tile(PathBuf::from("test1.jpg"), colors);
        tile_set.push_tile(PathBuf::from("test2.jpg"), colors);

        // Add some tiles to stats
        let tile1 = tile_set.tiles[0].clone();
        let tile2 = tile_set.tiles[1].clone();

        stats.push_tile(0, 0, &tile1, 10);
        stats.push_tile(10, 10, &tile2, 20);
        stats.push_tile(20, 20, &tile1, 15); // Use tile1 again

        assert_eq!(stats.tile_count(), 3);

        // Should not panic and should display statistics
        stats.summarise(&tile_set);
    }

    #[test]
    #[should_panic(expected = "Cannot render visualization: no tiles recorded")]
    fn test_render_empty_panic() {
        let stats: RenderStats<u32> = RenderStats::new();
        stats.render(16);
    }

    #[test]
    #[should_panic(expected = "Tile size must be greater than 0")]
    fn test_render_zero_tile_size_panic() {
        let mut stats: RenderStats<u32> = RenderStats::new();
        let tile = Tile::from_colors([Rgb([255, 0, 0])]);
        stats.push_tile(0, 0, &tile, 100);

        stats.render(0);
    }

    #[test]
    fn test_render_basic() {
        let mut stats: RenderStats<u32> = RenderStats::new();
        let tile = Tile::from_colors([Rgb([255, 0, 0])]);

        stats.push_tile(0, 0, &tile, 50);
        stats.push_tile(16, 16, &tile, 150);

        let rendered = stats.render(16);
        assert_eq!(rendered.width(), 2);
        assert_eq!(rendered.height(), 2);

        // Check that pixels have been set (should be grayscale values)
        let pixel1 = rendered.get_pixel(0, 0);
        let pixel2 = rendered.get_pixel(1, 1);

        // Pixel 1 should be darker (lower distance = 50)
        // Pixel 2 should be lighter (higher distance = 150)
        assert!(pixel1[0] < pixel2[0]);
    }

    #[test]
    fn test_generate_mosaic_widget() {
        let mut stats: RenderStats<u32> = RenderStats::new();
        let mut tile_set: TileSet<[Rgb<u8>; 1]> = TileSet::new();

        let colors = [Rgb([255, 0, 0])];
        tile_set.push_tile(PathBuf::from("test.jpg"), colors);

        let tile = tile_set.tiles[0].clone();
        stats.push_tile(0, 0, &tile, 100);

        let config = MosaicConfig {
            tile_size: 16,
            mode: "test".to_string(),
            no_repeat: false,
            greedy: false,
            crop: false,
            tint_opacity: 0.0,
            downsample: 1,
            randomize: None,
            tiles_dir: "test_tiles".to_string(),
        };

        let mosaic_path = PathBuf::from("test_mosaic.jpg");
        let output_path = PathBuf::from("/tmp/test_widget.html");

        // Should not panic and should create valid HTML
        let result = {
            let this = &stats;
            let mosaic_image_path: &Path = &mosaic_path;
            let output_path: &Path = &output_path;
            let tile_set = &tile_set;
            let config: &MosaicConfig = &config;
            this.generate_mosaic_widget_with_options(
                mosaic_image_path,
                output_path,
                tile_set,
                config,
                false,
            )
        };
        assert!(result.is_ok(), "Widget generation should succeed");
    }
}
