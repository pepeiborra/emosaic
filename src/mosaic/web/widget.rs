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

        // Generate HTML header with CSS and JavaScript
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

    /// Generate the HTML header with CSS and JavaScript for the widget
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

        /* Mobile modal styles */
        .mobile-modal {{
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 2000;
            animation: fadeIn 0.3s ease;
        }}

        .mobile-modal.active {{
            display: flex;
            align-items: center;
            justify-content: center;
        }}

        .modal-content {{
            background: white;
            border-radius: 8px;
            padding: 20px;
            max-width: 90vw;
            max-height: 90vh;
            overflow-y: auto;
            position: relative;
            animation: slideUp 0.3s ease;
        }}

        .modal-close {{
            position: absolute;
            top: 10px;
            right: 15px;
            font-size: 24px;
            cursor: pointer;
            color: #666;
            background: none;
            border: none;
            padding: 0;
            line-height: 1;
        }}

        .modal-image {{
            display: block;
            max-width: 100%;
            max-height: 50vh;
            width: auto;
            height: auto;
            margin: 0 auto 15px;
            border-radius: 4px;
            object-fit: contain;
        }}

        .modal-info {{
            text-align: left;
            font-size: 14px;
            line-height: 1.5;
        }}

        .modal-info strong {{
            color: #333;
        }}

        @keyframes fadeIn {{
            from {{ opacity: 0; }}
            to {{ opacity: 1; }}
        }}

        @keyframes slideUp {{
            from {{
                opacity: 0;
                transform: translateY(20px);
            }}
            to {{
                opacity: 1;
                transform: translateY(0);
            }}
        }}

        /* Hide tooltips on mobile devices only */
        @media (max-width: 768px) and (hover: none) {{
            .tooltip {{
                display: none !important;
            }}
        }}

        /* Ensure tooltips work on desktop */
        @media (min-width: 769px) and (hover: hover) {{
            .tile-region:hover .tooltip {{
                opacity: 1 !important;
            }}
        }}

        /* Year Filter Styles */
        .year-filter-container {{
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(255, 255, 255, 0.95);
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            border: 1px solid #ddd;
            z-index: 100;
            font-family: Arial, sans-serif;
            min-width: 200px;
        }}

        .year-filter-label {{
            display: block;
            font-size: 14px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
        }}

        .year-slider-wrapper {{
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }}

        .year-slider {{
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: #ddd;
            outline: none;
            -webkit-appearance: none;
            cursor: pointer;
        }}

        .year-slider::-webkit-slider-thumb {{
            -webkit-appearance: none;
            appearance: none;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #007bff;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }}

        .year-slider::-moz-range-thumb {{
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #007bff;
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }}

        .year-display {{
            font-size: 16px;
            font-weight: bold;
            color: #007bff;
            text-align: center;
            min-height: 20px;
        }}

        /* Disabled tile styles - overlay effect */
        .tile-region.disabled {{
            pointer-events: none;
            background-color: rgba(0, 0, 0, 0.7);
            transition: background-color 0.2s ease;
        }}

        .tile-region.disabled::before {{
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: repeating-linear-gradient(
                45deg,
                rgba(0, 0, 0, 0.1),
                rgba(0, 0, 0, 0.1) 2px,
                transparent 2px,
                transparent 8px
            );
            z-index: 1;
        }}

        .tile-region.disabled:hover {{
            background-color: rgba(0, 0, 0, 0.7) !important;
            border: none !important;
            transform: none !important;
        }}

        /* Ensure non-disabled tiles still show tooltips */
        .tile-region:not(.disabled):hover .tooltip {{
            opacity: 1;
        }}

        /* Enabled tiles should have a subtle highlight effect */
        .tile-region:not(.disabled) {{
            transition: background-color 0.2s ease, border 0.2s ease;
            background-color: transparent;
        }}

        .tile-region:not(.disabled):hover {{
            background-color: rgba(255, 255, 0, 0.3);
            border: 2px solid #ffcc00;
            z-index: 5;
        }}

        /* Mobile responsive adjustments for year filter */
        @media (max-width: 768px) {{
            .year-filter-container {{
                top: 10px;
                right: 10px;
                left: 10px;
                min-width: auto;
                padding: 12px 15px;
            }}

            .year-filter-label {{
                font-size: 12px;
                margin-bottom: 8px;
            }}

            .year-display {{
                font-size: 14px;
            }}
        }}
    </style>
    <script>
        // Mobile detection
        function isMobile() {{
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   ('ontouchstart' in window) ||
                   (navigator.maxTouchPoints > 0);
        }}

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

        function openTileImage(imagePath, isWebCompatible) {{
            if (isWebCompatible) {{
                // For web hosting, open the relative URL directly
                console.log('Opening tile image:', imagePath);
                window.open(imagePath, '_blank');
            }} else {{
                // Convert file path to file:// URL for local files
                let absolutePath;
                if (imagePath.startsWith('/') || imagePath.match(/^[A-Za-z]:/)) {{
                    absolutePath = imagePath;
                }} else {{
                    // Use current directory as fallback for local files
                    const cwd = window.location.protocol === 'file:' ?
                        window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) :
                        '';
                    absolutePath = cwd + '/' + imagePath;
                }}
                const fileUrl = 'file://' + absolutePath;
                console.log('Opening tile image:', absolutePath);
                window.open(fileUrl, '_blank');
            }}
        }}

        // Listen for messages from parent window
        window.addEventListener('message', function(event) {{
            if (event.data.type === 'toggleDistanceOverlay') {{
                toggleDistanceOverlay();
            }}
        }});

        // Store original percentage values to avoid conversion errors
        let originalPositions = new Map();

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

            // Update overlay dimensions and position to match the image exactly
            if (overlay) {{
                overlay.style.left = offsetX + 'px';
                overlay.style.top = offsetY + 'px';
                overlay.style.width = imageRect.width + 'px';
                overlay.style.height = imageRect.height + 'px';
            }}

            // Store original percentage values on first run (only for tile regions, not overlay tiles)
            if (originalPositions.size === 0) {{
                [...tileRegions].forEach(element => {{
                    const leftPercent = parseFloat(element.style.left) || 0;
                    const topPercent = parseFloat(element.style.top) || 0;
                    const widthPercent = parseFloat(element.style.width) || 0;
                    const heightPercent = parseFloat(element.style.height) || 0;

                    originalPositions.set(element, {{
                        left: leftPercent,
                        top: topPercent,
                        width: widthPercent,
                        height: heightPercent
                    }});
                }});
            }}

            // Update tile regions positioning using stored percentages (convert to pixels relative to image)
            [...tileRegions].forEach(element => {{
                const original = originalPositions.get(element);
                if (!original) return;

                // Convert percentages to actual pixels relative to image
                element.style.left = offsetX + (original.left / 100) * imageRect.width + 'px';
                element.style.top = offsetY + (original.top / 100) * imageRect.height + 'px';
                element.style.width = (original.width / 100) * imageRect.width + 'px';
                element.style.height = (original.height / 100) * imageRect.height + 'px';
            }});

            // Distance overlay tiles should keep their percentage positioning relative to the overlay container
            // Since the overlay container is already positioned and sized to match the image,
            // the tiles inside should maintain their original percentage positions
        }}

        // Adjust layout when image loads and on window resize
        window.addEventListener('load', function() {{
            console.log('Window loaded, initializing features...');
            adjustMosaicLayout();
            setupModalEvents();
            setupYearFilter();
            console.log('All features initialized');
        }});
        window.addEventListener('resize', adjustMosaicLayout);

        function loadTooltipImage(tileRegion) {{
            const img = tileRegion.querySelector('.tooltip-image');
            if (img && img.dataset.src && !img.src) {{
                console.log('Loading tooltip image for tile');
                img.src = img.dataset.src;
                img.style.display = 'block';
            }}
        }}

        function handleTileClick(imagePath, isWebCompatible, tileElement, tileImageUrl, distanceInfo, dateInfo) {{
            if (isMobile()) {{
                showMobileModal(tileImageUrl, distanceInfo, dateInfo);
            }} else {{
                openTileImage(imagePath, isWebCompatible);
            }}
        }}

        function showMobileModal(imageUrl, distanceInfo, dateInfo) {{
            const modal = document.getElementById('mobile-modal');
            const modalImage = document.getElementById('modal-image');
            const modalInfo = document.getElementById('modal-info');

            if (!modal || !modalImage || !modalInfo) return;

            modalImage.src = imageUrl;
            modalInfo.innerHTML = distanceInfo + dateInfo;
            modal.classList.add('active');

            // Prevent body scrolling when modal is open
            document.body.style.overflow = 'hidden';
        }}

        function closeMobileModal() {{
            const modal = document.getElementById('mobile-modal');
            if (modal) {{
                modal.classList.remove('active');
                document.body.style.overflow = '';
            }}
        }}

        // Close modal when clicking outside content
        function setupModalEvents() {{
            const modal = document.getElementById('mobile-modal');
            if (modal) {{
                modal.addEventListener('click', function(e) {{
                    if (e.target === modal) {{
                        closeMobileModal();
                    }}
                }});
            }}
        }}

        // Year filter functionality
        var yearFilterMinYear = {min_year}
        var yearFilterMaxYear = {max_year}

        function setupYearFilter() {{
            const slider = document.getElementById('year-slider');
            const display = document.getElementById('year-display');

            if (!slider || !display) {{
                console.log('Year filter elements not found');
                return;
            }}

            console.log('Setting up year filter with range:', yearFilterMinYear, 'to', yearFilterMaxYear);

            // Set slider range: 0 = "All", 1 to N = specific years
            slider.min = '0';
            slider.max = String(yearFilterMaxYear - yearFilterMinYear + 1);
            slider.value = '0'; // Default to "All"

            console.log('Slider range set to 0 -', slider.max);

            slider.addEventListener('input', function() {{
                const value = parseInt(this.value);
                console.log('Slider value changed to:', value);
                updateYearFilter(value);
            }});
        }}

        function updateYearFilter(sliderValue) {{
            const display = document.getElementById('year-display');
            const tiles = document.querySelectorAll('.tile-region');

            if (!display || !tiles.length) {{
                console.log('Display or tiles not found for year filter');
                return;
            }}

            console.log('Updating year filter with value:', sliderValue, 'Total tiles:', tiles.length);

            if (sliderValue === 0) {{
                // Show all tiles
                display.textContent = 'All Years';
                tiles.forEach(tile => {{
                    if (tile.classList.contains('disabled')) {{
                        tile.classList.remove('disabled');
                    }}
                }});
                console.log('Showing all tiles');
            }} else {{
                // Filter by specific year
                const selectedYear = yearFilterMinYear + sliderValue - 1;
                display.textContent = String(selectedYear);
                console.log('Filtering by year:', selectedYear);

                let enabledCount = 0;
                let disabledCount = 0;

                tiles.forEach(tile => {{
                    const tileYear = tile.dataset.year;
                    if (tileYear === 'unknown' || parseInt(tileYear) !== selectedYear) {{
                            tile.classList.add('disabled');
                        disabledCount++;
                    }} else {{
                            tile.classList.remove('disabled');
                        enabledCount++;
                    }}
                }});

                console.log('Year filter results - Enabled:', enabledCount, 'Disabled:', disabledCount);
            }}
        }}

        // Make functions globally accessible
        window.toggleDistanceOverlay = toggleDistanceOverlay;
        window.openTileImage = openTileImage;
        window.adjustMosaicLayout = adjustMosaicLayout;
        window.loadTooltipImage = loadTooltipImage;
        window.handleTileClick = handleTileClick;
        window.showMobileModal = showMobileModal;
        window.closeMobileModal = closeMobileModal;
        window.setupYearFilter = setupYearFilter;
        window.updateYearFilter = updateYearFilter;
    </script>
</head>
<body>
    <div class="mosaic-container">
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
    fn append_tile_regions<T>(&self, html: &mut String, tile_set: &TileSet<T>, config: &MosaicConfig, 
                             image_width: u32, image_height: u32, web_compatible: bool) {
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

        html.push_str("    </div>\n");
    }

    /// Generate year filter and mobile modal controls
    fn append_widget_controls(&self, html: &mut String, min_year: i32, max_year: i32) {
        // Add year filter slider HTML
        html.push_str(&format!(
            r#"
    <!-- Year Filter -->
    <div id="year-filter-container" class="year-filter-container">
        <label for="year-slider" class="year-filter-label">Filter by Year:</label>
        <div class="year-slider-wrapper">
            <input type="range" id="year-slider" class="year-slider"
                   min="{}" max="{}" value="0" step="1" />
            <div id="year-display" class="year-display">All Years</div>
        </div>
    </div>
"#,
            min_year,
            max_year + 1
        )); // +1 for "All" position
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
