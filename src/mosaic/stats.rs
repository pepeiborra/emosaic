use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

use image::{ImageBuffer, Rgb, RgbImage};

use super::tiles::{Tile, TileSet};

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
    pub fn tile_count(&self) -> usize {
        self.tiles.len()
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

    /// Generate a standalone HTML widget containing only the mosaic container.
    ///
    /// Creates a self-contained HTML document with just the interactive mosaic
    /// that can be embedded in other pages or used independently.
    ///
    /// # Arguments
    /// * `mosaic_image_path` - Path to the generated mosaic JPEG image
    /// * `output_path` - Path where the widget HTML file should be written
    /// * `tile_set` - The tile set used for generating the mosaic
    /// * `tile_size` - Size of each tile in pixels for coordinate conversion
    ///
    /// # Returns
    /// * `Ok(())` - If widget HTML file was successfully generated
    /// * `Err(std::io::Error)` - If file writing failed
    pub fn generate_mosaic_widget<T>(
        &self,
        mosaic_image_path: &Path,
        output_path: &Path,
        tile_set: &TileSet<T>,
        tile_size: u32,
    ) -> Result<(), std::io::Error> {
        if self.tiles.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "No tiles recorded in statistics",
            ));
        }

        let mut html = String::new();

        // Minimal HTML document structure for widget
        html.push_str(&format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mosaic Widget</title>
    <style>
        body {{
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            width: 100%;
            height: 100vh;
            overflow: hidden;
        }}
        .mosaic-container {{
            position: relative;
            display: flex;
            justify-content: center;
            align-items: center;
            width: 100%;
            height: 100%;
        }}
        .mosaic-image {{
            display: block;
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
            object-fit: contain;
        }}
        .tile-region {{
            position: absolute;
            cursor: pointer;
            transition: all 0.2s ease;
        }}
        .tile-region:active {{
            transform: scale(0.95);
        }}
        .tile-region:hover {{
            background-color: rgba(255, 255, 0, 0.3);
            border: 2px solid #ffcc00;
            z-index: 10;
        }}
        .tooltip {{
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
            z-index: 1000;
            max-width: 1500px;
            word-wrap: break-word;
            white-space: normal;
        }}
        .tooltip-image {{
            display: block;
            max-width: 25vw;
            max-height: 25vh;
            width: auto;
            height: auto;
            margin: 8px 0;
            border-radius: 4px;
            object-fit: contain;
        }}
        .tile-region:hover .tooltip {{
            opacity: 1;
        }}
        .distance-good {{ color: #28a745; }}
        .distance-medium {{ color: #ffc107; }}
        .distance-bad {{ color: #dc3545; }}

        /* Distance overlay styles */
        .distance-overlay {{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
            z-index: 5;
        }}
        .distance-overlay.visible {{
            opacity: 0.7;
        }}
        .distance-overlay-tile {{
            position: absolute;
            border: 1px solid rgba(255,255,255,0.2);
            min-width: 1px;
            min-height: 1px;
        }}
        /* Distance color coding for overlay */
        .overlay-distance-excellent {{ background: rgba(0, 255, 0, 0.8); }}
        .overlay-distance-good {{ background: rgba(40, 167, 69, 0.8); }}
        .overlay-distance-medium {{ background: rgba(255, 193, 7, 0.8); }}
        .overlay-distance-poor {{ background: rgba(255, 152, 0, 0.8); }}
        .overlay-distance-bad {{ background: rgba(220, 53, 69, 0.8); }}
    </style>
    <script>
        function toggleDistanceOverlay() {{
            const overlay = document.getElementById('distance-overlay');
            if (overlay) {{
                overlay.classList.toggle('visible');
            }}
            // Notify parent window of state change
            if (window.parent !== window) {{
                const isVisible = overlay && overlay.classList.contains('visible');
                window.parent.postMessage({{
                    type: 'distanceOverlayToggled',
                    visible: isVisible
                }}, '*');
            }}
        }}

        function openTileImage(imagePath, cwd) {{
            // Convert file path to file:// URL for local files
            let absolutePath;
            if (imagePath.startsWith('/') || imagePath.match(/^[A-Za-z]:/)) {{
                absolutePath = imagePath;
            }} else {{
                absolutePath = cwd + '/' + imagePath;
            }}
            const fileUrl = 'file://' + absolutePath;
            console.log('Opening tile image:', absolutePath);
            window.open(fileUrl, '_blank');
        }}

        // Listen for messages from parent window
        window.addEventListener('message', function(event) {{
            if (event.data.type === 'toggleDistanceOverlay') {{
                toggleDistanceOverlay();
            }}
        }});

        // Adjust positioning when image loads or window resizes
        function adjustMosaicLayout() {{
            const image = document.querySelector('.mosaic-image');
            const container = document.querySelector('.mosaic-container');
            const overlay = document.querySelector('.distance-overlay');
            const tileRegions = document.querySelectorAll('.tile-region');
            const overlayTiles = document.querySelectorAll('.distance-overlay-tile');

            if (!image || !container) return;

            // Get actual image dimensions and position
            const imageRect = image.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            // Calculate offset from container to image
            const offsetX = imageRect.left - containerRect.left;
            const offsetY = imageRect.top - containerRect.top;

            // Update overlay dimensions and position
            if (overlay) {{
                overlay.style.left = offsetX + 'px';
                overlay.style.top = offsetY + 'px';
                overlay.style.width = imageRect.width + 'px';
                overlay.style.height = imageRect.height + 'px';
            }}

            // Update tile regions and overlay tiles positioning
            [...tileRegions, ...overlayTiles].forEach(element => {{
                const currentLeft = parseFloat(element.style.left) || 0;
                const currentTop = parseFloat(element.style.top) || 0;
                const currentWidth = parseFloat(element.style.width) || 0;
                const currentHeight = parseFloat(element.style.height) || 0;

                // Convert percentages to actual pixels relative to image
                element.style.left = offsetX + (currentLeft / 100) * imageRect.width + 'px';
                element.style.top = offsetY + (currentTop / 100) * imageRect.height + 'px';
                element.style.width = (currentWidth / 100) * imageRect.width + 'px';
                element.style.height = (currentHeight / 100) * imageRect.height + 'px';
            }});
        }}

        // Adjust layout when image loads and on window resize
        window.addEventListener('load', adjustMosaicLayout);
        window.addEventListener('resize', adjustMosaicLayout);

        // Make functions globally accessible
        window.toggleDistanceOverlay = toggleDistanceOverlay;
        window.openTileImage = openTileImage;
        window.adjustMosaicLayout = adjustMosaicLayout;
    </script>
</head>
<body>
    <div class="mosaic-container">
        <img src="{}" alt="Mosaic Image" class="mosaic-image" />
        <div id="distance-overlay" class="distance-overlay">
"#,
            mosaic_image_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));

        // Calculate image dimensions and tile positions
        let max_x = self.tiles.keys().map(|(x, _)| *x).max().unwrap_or(0);
        let max_y = self.tiles.keys().map(|(_, y)| *y).max().unwrap_or(0);
        let image_width = max_x + tile_size;
        let image_height = max_y + tile_size;

        // Find distance range for color coding
        let distances: Vec<f64> = self.tiles.values().map(|t| t.colors.into()).collect();
        let min_distance = distances.iter().fold(f64::INFINITY, |a, &b| a.min(b));
        let max_distance = distances.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
        let distance_range = max_distance - min_distance;

        // Generate distance overlay tiles
        for ((x, y), tile) in &self.tiles {
            let distance: f64 = tile.colors.into();

            // Calculate relative position as percentage of image size
            let left_percent = (*x as f64 / image_width as f64) * 100.0;
            let top_percent = (*y as f64 / image_height as f64) * 100.0;
            let width_percent = (tile_size as f64 / image_width as f64) * 100.0;
            let height_percent = (tile_size as f64 / image_height as f64) * 100.0;

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

        // Generate interactive tile regions with tooltips
        for ((x, y), tile) in &self.tiles {
            let distance: f64 = tile.colors.into();
            let tile_path = tile_set.get_path(tile);

            // Calculate relative position as percentage of image size
            let left_percent = (*x as f64 / image_width as f64) * 100.0;
            let top_percent = (*y as f64 / image_height as f64) * 100.0;
            let width_percent = (tile_size as f64 / image_width as f64) * 100.0;
            let height_percent = (tile_size as f64 / image_height as f64) * 100.0;

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

            // Escape the path for JavaScript by replacing backslashes and quotes
            let escaped_path = tile_path
                .display()
                .to_string()
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\"", "\\\"");

            let cwd = std::env::current_dir().unwrap();
            let escaped_cwd = cwd
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

            // Convert to file URL for browser (need to URL encode for safety)
            let file_url = format!("file://{}", absolute_tile_path.display());

            // Format date information
            let date_info = if let Some(ref date_taken) = tile.date_taken {
                format!("Date: {}<br/>", date_taken)
            } else {
                String::new()
            };

            html.push_str(&format!(r#"
        <div class="tile-region" style="left: {:.2}%; top: {:.2}%; width: {:.2}%; height: {:.2}%;" onclick="openTileImage('{}', '{}')">
            <div class="tooltip">
                <img src="{}" alt="Tile Preview" class="tooltip-image" onerror="this.style.display='none'"/><br/>
                <strong>Tile Information</strong><br/>
                Position: ({}, {})<br/>
                <span class="{}">Distance: {:.3}</span><br/>
                Flipped: {}<br/>
                {}
            </div>
        </div>"#,
                left_percent, top_percent, width_percent, height_percent, escaped_path, escaped_cwd,
                file_url,
                x, y, distance_class, distance, tile.flipped,
                date_info
            ));
        }

        html.push_str("    </div>\n");

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

    /// Generate an HTML file with the mosaic image and interactive tooltips.
    ///
    /// Creates an HTML document embedding the mosaic image with CSS-based tooltips
    /// that appear on hover, showing tile distance scores and original file paths.
    ///
    /// # Arguments
    /// * `mosaic_image_path` - Path to the generated mosaic JPEG image
    /// * `output_path` - Path where the HTML file should be written
    /// * `tile_set` - The tile set used for generating the mosaic
    /// * `config` - Configuration settings used to generate the mosaic
    ///
    /// # Returns
    /// * `Ok(())` - If HTML file was successfully generated
    /// * `Err(std::io::Error)` - If file writing failed
    pub fn generate_html<T>(
        &self,
        mosaic_image_path: &Path,
        output_path: &Path,
        tile_set: &TileSet<T>,
        config: &MosaicConfig,
    ) -> Result<(), std::io::Error> {
        if self.tiles.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "No tiles recorded in statistics",
            ));
        }

        // First, generate the standalone mosaic widget
        let widget_path = output_path.with_file_name(format!(
            "{}_widget.html",
            output_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
        ));

        self.generate_mosaic_widget(mosaic_image_path, &widget_path, tile_set, config)?;

        let mut html = String::new();

        // HTML document structure for the main page
        html.push_str(&format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mosaic Visualization - {}</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            max-width: 100%;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        .mosaic-frame {{
            margin: 20px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            overflow: hidden;
            background: white;
        }}
        .mosaic-iframe {{
            width: 100%;
            height: 80vh;
            border: none;
            display: block;
        }}
        .stats {{
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 4px;
        }}
        .stats h2 {{
            margin-top: 0;
            color: #333;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }}
        .stats-section {{
            background: white;
            padding: 15px;
            border-radius: 4px;
            border: 1px solid #ddd;
        }}
        .stats-section h3 {{
            margin-top: 0;
            color: #555;
        }}
        .tile-info {{
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
            border-bottom: 1px solid #eee;
        }}
        .tile-info:last-child {{
            border-bottom: none;
        }}
        .distance-good {{ color: #28a745; }}
        .distance-medium {{ color: #ffc107; }}
        .distance-bad {{ color: #dc3545; }}

        /* Distance overlay controls */
        .distance-toggle {{
            margin: 10px 0;
            padding: 8px 16px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }}
        .distance-toggle:hover {{
            background: #0056b3;
        }}
        .distance-legend {{
            margin: 10px 0;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
            font-size: 12px;
            display: none;
        }}
        .distance-legend.visible {{
            display: block;
        }}
        .legend-item {{
            display: inline-block;
            margin: 5px 10px 5px 0;
        }}
        .legend-color {{
            display: inline-block;
            width: 20px;
            height: 15px;
            margin-right: 5px;
            vertical-align: middle;
            border: 1px solid #ccc;
        }}
        /* Distance color coding for overlay */
        .overlay-distance-excellent {{ background: rgba(0, 255, 0, 0.8); }}
        .overlay-distance-good {{ background: rgba(40, 167, 69, 0.8); }}
        .overlay-distance-medium {{ background: rgba(255, 193, 7, 0.8); }}
        .overlay-distance-poor {{ background: rgba(255, 152, 0, 0.8); }}
        .overlay-distance-bad {{ background: rgba(220, 53, 69, 0.8); }}
    </style>
    <script>
        function toggleDistanceOverlay() {{
            const iframe = document.getElementById('mosaic-iframe');
            const legend = document.getElementById('distance-legend');
            const button = document.getElementById('distance-toggle-btn');

            if (!iframe || !legend || !button) {{
                console.error('Missing elements:', {{iframe, legend, button}});
                return;
            }}

            // Send message to iframe to toggle overlay
            iframe.contentWindow.postMessage({{
                type: 'toggleDistanceOverlay'
            }}, '*');
        }}

        // Listen for messages from the iframe
        window.addEventListener('message', function(event) {{
            if (event.data.type === 'distanceOverlayToggled') {{
                const legend = document.getElementById('distance-legend');
                const button = document.getElementById('distance-toggle-btn');

                if (legend && button) {{
                    if (event.data.visible) {{
                        legend.classList.add('visible');
                        button.textContent = 'Hide Distance Overlay';
                    }} else {{
                        legend.classList.remove('visible');
                        button.textContent = 'Show Distance Overlay';
                    }}
                }}
            }}
        }});

        // Make function globally accessible
        window.toggleDistanceOverlay = toggleDistanceOverlay;
    </script>
</head>
<body>
    <div class="container">
        <h1>Mosaic Visualization</h1>
        <p>Hover over any tile to see detailed information including distance score and source file. <strong>Click on any tile to open the original image in a new tab.</strong></p>

        <button id="distance-toggle-btn" class="distance-toggle" onclick="toggleDistanceOverlay()">Show Distance Overlay</button>

        <div id="distance-legend" class="distance-legend">
            <strong>Distance Legend:</strong>
            <div class="legend-item">
                <span class="legend-color overlay-distance-excellent"></span>Excellent (0-20%)
            </div>
            <div class="legend-item">
                <span class="legend-color overlay-distance-good"></span>Good (20-40%)
            </div>
            <div class="legend-item">
                <span class="legend-color overlay-distance-medium"></span>Medium (40-60%)
            </div>
            <div class="legend-item">
                <span class="legend-color overlay-distance-poor"></span>Poor (60-80%)
            </div>
            <div class="legend-item">
                <span class="legend-color overlay-distance-bad"></span>Bad (80-100%)
            </div>
        </div>

        <div class="mosaic-frame">
            <iframe id="mosaic-iframe" class="mosaic-iframe" src="{}" title="Interactive Mosaic Visualization"></iframe>
        </div>
"#,
            mosaic_image_path.file_name().unwrap_or_default().to_string_lossy(),
            widget_path.file_name().unwrap_or_default().to_string_lossy()
        ));

        // Generate statistics section
        self.append_stats_html(&mut html, tile_set);

        // Close HTML document
        html.push_str(
            r#"
    </div>
</body>
</html>"#,
        );

        // Write HTML file
        let mut file = std::fs::File::create(output_path)?;
        file.write_all(html.as_bytes())?;

        Ok(())
    }

    /// Helper function to append statistics section to HTML
    fn append_stats_html<T>(&self, html: &mut String, tile_set: &TileSet<T>) {
        // Calculate basic statistics
        let mut total_distance: D = 0_u8.into();
        let mut tile_usage_count: HashMap<&Path, u16> = HashMap::new();

        for tile in self.tiles.values() {
            total_distance += tile.colors;
            let path = tile_set.get_path(tile);
            *tile_usage_count.entry(path).or_insert(0) += 1;
        }

        let unique_tiles = tile_usage_count.len();
        let total_distance_f64: f64 = total_distance.into();
        let tile_count = self.tiles.len() as f64;
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
"#,
            self.tiles.len(),
            unique_tiles,
            avg_distance
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
        let mut worst_matches: Vec<_> = self.tiles.values().collect();
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
        let result = stats.generate_mosaic_widget(&mosaic_path, &output_path, &tile_set, &config);
        assert!(result.is_ok(), "Widget generation should succeed");
    }
}
