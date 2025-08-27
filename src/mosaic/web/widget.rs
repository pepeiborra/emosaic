use std::fs;
use std::io::Write;
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
    /// Generate a standalone HTML widget with web-compatible URLs for static hosting.
    ///
    /// # Arguments
    /// * `mosaic_image_path` - Path to the generated mosaic JPEG image
    /// * `output_path` - Path where the widget HTML file should be written
    /// * `tile_set` - The tile set used for generating the mosaic
    /// * `config` - Configuration settings used to generate the mosaic
    /// * `web_compatible` - If true, generates relative URLs suitable for web hosting
    ///
    /// # Returns
    /// * `Ok(())` - If widget HTML file was successfully generated
    /// * `Err(std::io::Error)` - If file writing failed
    pub fn generate_mosaic_widget_with_options<T>(
        &self,
        mosaic_image_path: &Path,
        output_path: &Path,
        tile_set: &TileSet<T>,
        config: &MosaicConfig,
        web_compatible: bool,
    ) -> Result<(), std::io::Error> {
        if self.tiles().is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "No tiles recorded in statistics",
            ));
        }

        // Extract years from tiles for year filter
        let mut years: Vec<i32> = Vec::new();
        for tile in self.tiles().values() {
            if let Some(ref date_taken) = tile.date_taken {
                if let Some(year_str) = date_taken.split(':').next() {
                    if let Ok(year) = year_str.parse::<i32>() {
                        if !years.contains(&year) {
                            years.push(year);
                        }
                    }
                }
            }
        }
        years.sort();
        let min_year = years.first().copied().unwrap_or(2000);
        let max_year = years.last().copied().unwrap_or(2030);

        let mut html = String::new();

        // Copy JavaScript file to output directory and generate HTML header
        self.copy_assets_to_output_dir(output_path)?;
        self.append_widget_header(&mut html, mosaic_image_path, min_year, max_year);

        // Calculate image dimensions and tile positions
        let max_x = self.tiles().keys().map(|(x, _)| *x).max().unwrap_or(0);
        let max_y = self.tiles().keys().map(|(_, y)| *y).max().unwrap_or(0);
        let image_width = max_x + config.tile_size;
        let image_height = max_y + config.tile_size;

        // Generate distance overlay
        self.append_distance_overlay(&mut html, config, image_width, image_height);

        // Generate interactive tile regions
        self.append_tile_regions(
            &mut html,
            tile_set,
            config,
            image_width,
            image_height,
            web_compatible,
            min_year,
            max_year,
        );

        // Generate year filter and mobile modal
        self.append_widget_controls(&mut html, min_year, max_year);

        // Close HTML document
        html.push_str(
            r#"
</body>
</html>"#,
        );

        // Write HTML file
        let mut file = std::fs::File::create(output_path)?;
        file.write_all(html.as_bytes())?;

        Ok(())
    }

    /// Copy CSS and JavaScript assets to output directory
    fn copy_assets_to_output_dir(&self, output_path: &Path) -> Result<(), std::io::Error> {
        let output_dir = output_path.parent().unwrap_or_else(|| Path::new("."));
        let assets_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/assets");

        // Copy CSS file
        let css_template_path = assets_dir.join("mosaic-widget.css");
        let css_content = fs::read_to_string(&css_template_path)?;
        let css_output_path = output_dir.join("mosaic-widget.css");
        fs::write(&css_output_path, css_content)?;

        // Copy JavaScript file
        let js_template_path = assets_dir.join("mosaic-widget.js");
        let js_content = fs::read_to_string(&js_template_path)?;
        let js_output_path = output_dir.join("mosaic-widget.js");
        fs::write(&js_output_path, js_content)?;

        Ok(())
    }

    /// Generate the HTML header with CSS for the widget
    fn append_widget_header(
        &self,
        html: &mut String,
        mosaic_image_path: &Path,
        min_year: i32,
        max_year: i32,
    ) {
        // Generate cache-busting timestamp
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        html.push_str(&format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Mosaic Widget</title>
    <link rel="stylesheet" href="mosaic-widget.css?v={timestamp}">
    <script>
        // Initialize template variables for the JavaScript
        var yearFilterMinYear = {min_year};
        var yearFilterMaxYear = {max_year};
    </script>
    <script src="mosaic-widget.js?v={timestamp}"></script>
</head>
<body>
    <div class="mosaic-container">
        <div class="zoom-container">
            <img src="{img_path}" alt="Mosaic Image" class="mosaic-image" />
            <div id="distance-overlay" class="distance-overlay">
"#,
            img_path = mosaic_image_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy(),
            min_year = min_year,
            max_year = max_year,
            timestamp = timestamp
        ));
    }

    /// Generate distance overlay tiles
    fn append_distance_overlay(
        &self,
        html: &mut String,
        config: &MosaicConfig,
        image_width: u32,
        image_height: u32,
    ) {
        // Find distance range for color coding
        let distances: Vec<f64> = self.tiles().values().map(|t| t.colors.into()).collect();
        let min_distance = distances.iter().fold(f64::INFINITY, |a, &b| a.min(b));
        let max_distance = distances.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
        let distance_range = max_distance - min_distance;

        // Generate distance overlay tiles
        for ((x, y), tile) in self.tiles() {
            let distance: f64 = tile.colors.into();

            // Calculate relative position as percentage of image size
            let left_percent = (*x as f64 / image_width as f64) * 100.0;
            let top_percent = (*y as f64 / image_height as f64) * 100.0;
            let width_percent = (config.tile_size as f64 / image_width as f64) * 100.0;
            let height_percent = (config.tile_size as f64 / image_height as f64) * 100.0;

            // Determine overlay color class
            let overlay_class = if distance_range > 0.0 {
                let normalized = (distance - min_distance) / distance_range;
                if normalized < 0.20 {
                    "overlay-distance-excellent"
                } else if normalized < 0.40 {
                    "overlay-distance-good"
                } else if normalized < 0.60 {
                    "overlay-distance-medium"
                } else if normalized < 0.80 {
                    "overlay-distance-poor"
                } else {
                    "overlay-distance-bad"
                }
            } else {
                "overlay-distance-excellent"
            };

            // Add distance overlay tile
            html.push_str(&format!(r#"
            <div class="distance-overlay-tile {}" style="left: {:.2}%; top: {:.2}%; width: {:.2}%; height: {:.2}%;"></div>"#,
                overlay_class, left_percent, top_percent, width_percent, height_percent
            ));
        }

        // Close distance overlay container
        html.push_str("        </div>\n");
    }

    /// Generate interactive tile regions with tooltips
    fn append_tile_regions<T>(
        &self,
        html: &mut String,
        tile_set: &TileSet<T>,
        config: &MosaicConfig,
        image_width: u32,
        image_height: u32,
        web_compatible: bool,
        min_year: i32,
        max_year: i32,
    ) {
        // Find distance range for color coding
        let distances: Vec<f64> = self.tiles().values().map(|t| t.colors.into()).collect();
        let min_distance = distances.iter().fold(f64::INFINITY, |a, &b| a.min(b));
        let max_distance = distances.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
        let distance_range = max_distance - min_distance;

        for ((x, y), tile) in self.tiles() {
            let distance: f64 = tile.colors.into();
            let tile_path = tile_set.get_path(tile);

            // Calculate relative position as percentage of image size
            let left_percent = (*x as f64 / image_width as f64) * 100.0;
            let top_percent = (*y as f64 / image_height as f64) * 100.0;
            let width_percent = (config.tile_size as f64 / image_width as f64) * 100.0;
            let height_percent = (config.tile_size as f64 / image_height as f64) * 100.0;

            // Determine distance color class for tooltip text
            let distance_class = if distance_range > 0.0 {
                let normalized = (distance - min_distance) / distance_range;
                if normalized < 0.20 {
                    "distance-good"
                } else if normalized < 0.40 {
                    "distance-good"
                } else if normalized < 0.60 {
                    "distance-medium"
                } else {
                    "distance-bad"
                }
            } else {
                "distance-good"
            };

            // Generate URLs based on web compatibility mode
            let (click_url, tooltip_image_url, web_compat_flag) = if web_compatible {
                // For web hosting, preserve directory structure relative to tiles_dir
                let tiles_dir_path = std::path::Path::new(&config.tiles_dir);
                let relative_to_tiles_dir =
                    if let Ok(rel_path) = tile_path.strip_prefix(tiles_dir_path) {
                        // Successfully stripped the tiles_dir prefix
                        rel_path.display().to_string()
                    } else {
                        // Fallback: if we can't strip prefix, just use filename
                        tile_path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string()
                    };

                let web_path = format!("tiles/{}", relative_to_tiles_dir);
                (web_path.clone(), web_path, "true")
            } else {
                // For local files, use file:// URLs
                let escaped_path = tile_path
                    .display()
                    .to_string()
                    .replace("\\", "\\\\")
                    .replace("'", "\\'")
                    .replace("\"", "\\\"");

                let cwd = std::env::current_dir().unwrap();
                let _escaped_cwd = cwd
                    .display()
                    .to_string()
                    .replace("\\", "\\\\")
                    .replace("'", "\\'")
                    .replace("\"", "\\\"");

                // Create absolute path for the image source
                let absolute_tile_path = if tile_path.is_absolute() {
                    tile_path.to_path_buf()
                } else {
                    cwd.join(tile_path)
                };

                // Convert to file URL for browser
                let file_url = format!("file://{}", absolute_tile_path.display());
                (escaped_path, file_url, "false")
            };

            // Format date information and extract year
            let (date_info, tile_year) = if let Some(ref date_taken) = tile.date_taken {
                let year = date_taken
                    .split(':')
                    .next()
                    .and_then(|y| y.parse::<i32>().ok())
                    .unwrap_or(0);
                (date_taken.clone(), year.to_string())
            } else {
                (String::new(), "unknown".to_string())
            };

            let distance_info = if web_compatible {
                String::new()
            } else {
                format!(
                    r#"<span class = "{}">Distance: {:.3}</span><br/>"#,
                    distance_class, distance
                )
            };

            html.push_str(&format!(r#"
        <div class="tile-region" style="left: {:.2}%; top: {:.2}%; width: {:.2}%; height: {:.2}%;"
             onclick="handleTileClick('{}', {}, this, '{}', '{}', '{}')"
             onmouseenter="loadTooltipImage(this)"
             data-tile-image="{}"
             data-distance-info="{}"
             data-date-info="{}"
             data-year="{}">
            <div class="tooltip">
                <img data-src="{}" alt="Tile Preview" class="tooltip-image" onerror="this.style.display='none'" style="display:none"/><br/>
                {}
                {}
            </div>
        </div>"#,
                left_percent, top_percent, width_percent, height_percent,
                click_url, web_compat_flag, tooltip_image_url,
                distance_info.replace("\"", "&quot;").replace("'", "&#39;"),
                date_info.replace("\"", "&quot;").replace("'", "&#39;"),
                tooltip_image_url,
                distance_info.replace("\"", "&quot;").replace("'", "&#39;"),
                date_info.replace("\"", "&quot;").replace("'", "&#39;"),
                tile_year,
                tooltip_image_url,
                distance_info,
                date_info
            ));
        }

        html.push_str(&format!(
            r#"            </div>
        </div>

        <!-- Year Filter (positioned dynamically) -->
        <div id="year-filter-container" class="year-filter-container image-positioned">
            <label for="year-slider" class="year-filter-label">Year:</label>
            <div class="year-slider-wrapper">
                <input type="range" id="year-slider" class="year-slider"
                       min="{}" max="{}" value="0" step="1" />
                <div id="year-display" class="year-display">All Years</div>
            </div>
        </div>
    </div>
"#,
            min_year,
            max_year + 1
        ));
    }

    /// Generate mobile modal controls
    fn append_widget_controls(&self, html: &mut String, _min_year: i32, _max_year: i32) {
        // Add mobile modal HTML
        html.push_str(
            r#"
    <!-- Mobile Modal -->
    <div id="mobile-modal" class="mobile-modal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeMobileModal()">&times;</button>
            <img id="modal-image" class="modal-image" alt="Tile Image" />
            <div id="modal-info" class="modal-info"></div>
        </div>
    </div>
"#,
        );
    }
}
