use std::collections::HashMap;
use std::path::Path;

use super::super::stats::{MosaicConfig, RenderStats};
use super::super::tiles::TileSet;

impl<D> RenderStats<D>
where
    f64: From<D>,
    D: std::cmp::Ord,
    D: std::convert::From<u8>,
    D: std::ops::AddAssign,
    D: Copy,
    D: std::fmt::Display,
{
    /// Helper function to append statistics section to HTML
    pub(crate) fn append_stats_html<T>(
        &self,
        html: &mut String,
        tile_set: &TileSet<T>,
        config: &MosaicConfig,
    ) {
        // Calculate basic statistics
        let mut total_distance: D = 0_u8.into();
        let mut tile_usage_count: HashMap<&Path, u16> = HashMap::new();

        for tile in self.tiles().values() {
            total_distance += tile.colors;
            let path = tile_set.get_path(tile);
            *tile_usage_count.entry(path).or_insert(0) += 1;
        }

        let unique_tiles = tile_usage_count.len();
        let total_distance_f64: f64 = total_distance.into();
        let tile_count = self.tiles().len() as f64;
        let avg_distance = total_distance_f64 / tile_count;

        html.push_str(&format!(
            r#"
        <div class="stats">
            <h2>Mosaic Statistics</h2>
            <div class="stats-grid">
                <div class="stats-section">
                    <h3>Overview</h3>
                    <div class="tile-info">
                        <span>Total tiles placed:</span>
                        <span>{}</span>
                    </div>
                    <div class="tile-info">
                        <span>Unique images used:</span>
                        <span>{}</span>
                    </div>
                    <div class="tile-info">
                        <span>Average distance:</span>
                        <span>{:.3}</span>
                    </div>
                </div>
                <div class="stats-section">
                    <h3>Configuration</h3>
                    <div class="tile-info">
                        <span>Mode:</span>
                        <span>{}</span>
                    </div>
                    <div class="tile-info">
                        <span>Tile size:</span>
                        <span>{} px</span>
                    </div>
                    <div class="tile-info">
                        <span>No repeat:</span>
                        <span>{}</span>
                    </div>
                    <div class="tile-info">
                        <span>Greedy algorithm:</span>
                        <span>{}</span>
                    </div>
                    <div class="tile-info">
                        <span>Crop tiles:</span>
                        <span>{}</span>
                    </div>
                    <div class="tile-info">
                        <span>Tint opacity:</span>
                        <span>{:.1}%</span>
                    </div>
                    <div class="tile-info">
                        <span>Downsample factor:</span>
                        <span>{}x</span>
                    </div>
                    <div class="tile-info">
                        <span>Randomization:</span>
                        <span>{}</span>
                    </div>
                    <div class="tile-info">
                        <span>Tiles directory:</span>
                        <span>{}</span>
                    </div>
                </div>
"#,
            self.tiles().len(),
            unique_tiles,
            avg_distance,
            config.mode,
            config.tile_size,
            if config.no_repeat { "Yes" } else { "No" },
            if config.greedy { "Yes" } else { "No" },
            if config.crop { "Yes" } else { "No" },
            config.tint_opacity * 100.0,
            config.downsample,
            config
                .randomize
                .map_or("None".to_string(), |r| format!("{:.1}%", r)),
            config.tiles_dir
        ));

        // Most used tiles
        let mut usage_by_count: Vec<_> = tile_usage_count.into_iter().collect();
        usage_by_count.sort_by(|(_, a), (_, b)| b.cmp(a));

        html.push_str(
            r#"
                <div class="stats-section">
                    <h3>Most Used Tiles</h3>
"#,
        );

        for (i, (path, count)) in usage_by_count.iter().take(10).enumerate() {
            html.push_str(&format!(
                r#"
                    <div class="tile-info">
                        <span>{}. {}</span>
                        <span>{} times</span>
                    </div>
"#,
                i + 1,
                path.file_name().unwrap_or_default().to_string_lossy(),
                count
            ));
        }

        html.push_str("                </div>\n");

        // Worst matches
        let mut worst_matches: Vec<_> = self.tiles().values().collect();
        worst_matches.sort_by(|a, b| b.colors.cmp(&a.colors));

        html.push_str(
            r#"
                <div class="stats-section">
                    <h3>Worst Matches</h3>
"#,
        );

        for (i, tile) in worst_matches.iter().take(10).enumerate() {
            let path = tile_set.get_path(tile);
            let distance: f64 = tile.colors.into();
            html.push_str(&format!(
                r#"
                    <div class="tile-info">
                        <span>{}. {}</span>
                        <span class="distance-bad">{:.3}</span>
                    </div>
"#,
                i + 1,
                path.file_name().unwrap_or_default().to_string_lossy(),
                distance
            ));
        }

        html.push_str(
            r#"
                </div>
            </div>
        </div>
"#,
        );
    }
}