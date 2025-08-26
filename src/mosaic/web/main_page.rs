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
    /// Generate an HTML file with web-compatible URLs for static hosting.
    ///
    /// # Arguments
    /// * `mosaic_image_path` - Path to the generated mosaic JPEG image
    /// * `output_path` - Path where the HTML file should be written
    /// * `tile_set` - The tile set used for generating the mosaic
    /// * `config` - Configuration settings used to generate the mosaic
    /// * `web_compatible` - If true, generates relative URLs suitable for web hosting
    ///
    /// # Returns
    /// * `Ok(())` - If HTML file was successfully generated
    /// * `Err(std::io::Error)` - If file writing failed
    pub fn generate_html_with_options<T>(
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

        // First, generate the standalone mosaic widget
        let widget_path = output_path.with_file_name(format!(
            "{}_widget.html",
            output_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
        ));

        self.generate_mosaic_widget_with_options(
            mosaic_image_path,
            &widget_path,
            tile_set,
            config,
            web_compatible,
        )?;

        let mut html = String::new();

        // Generate HTML header and structure
        self.append_main_page_header(&mut html, mosaic_image_path, &widget_path);

        // Generate statistics section
        self.append_stats_html(&mut html, tile_set, config);

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

    /// Generate the main page HTML header with CSS and JavaScript
    fn append_main_page_header(&self, html: &mut String, mosaic_image_path: &Path, widget_path: &Path) {
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
    }
}