// Build a minimal mosaic-widget fixture HTML that mirrors the structure
// emitted by src/mosaic/web/widget.rs. The asset references (CSS/JS) point
// at the actual files under src/assets, so the tests exercise the real
// production code, not a copy.
//
// Run before tests (Playwright's globalSetup invokes this).
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const out = here;

mkdirSync(out, { recursive: true });

// Copy the real assets so any change to widget JS/CSS is what tests see
copyFileSync(join(repoRoot, 'src/assets/mosaic-widget.js'), join(out, 'mosaic-widget.js'));
copyFileSync(join(repoRoot, 'src/assets/mosaic-widget.css'), join(out, 'mosaic-widget.css'));

// A 4x3 grid of tile regions across 3 years, on a 400x300 background image.
// The background is a base64-encoded 400x300 solid-color JPEG (tiny).
const W = 400, H = 300, COLS = 4, ROWS = 3;
const tileW = (100 / COLS).toFixed(4);
const tileH = (100 / ROWS).toFixed(4);

const years = ['2020', '2021', '2022'];
let tileRegions = '';
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const left = (col * (100 / COLS)).toFixed(4);
    const top = (row * (100 / ROWS)).toFixed(4);
    const idx = row * COLS + col;
    const year = years[idx % years.length];
    const hash = `tilehash${idx.toString().padStart(4, '0')}`;
    // tooltip-image is a tiny 32x32 colored data URL
    // encodeURIComponent does not escape ', so quote SVG attributes with " and
    // then percent-encode them — otherwise the onclick attribute (wrapped in ')
    // breaks on the first inner ' from the data URL.
    const tilePreview = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${idx*30},70%,55%)"/><text x="32" y="38" text-anchor="middle" font-family="sans-serif" font-size="14" fill="white">${idx}</text></svg>`
    );
    tileRegions += `
        <div class="tile-region" style="left: ${left}%; top: ${top}%; width: ${tileW}%; height: ${tileH}%;"
             onclick="handleTileClick('tile-${idx}.jpg', true, this, '${tilePreview}', 'Distance: 0.${idx}', '${year}:01:01 12:00:00')"
             onmouseenter="loadTooltipImage(this)"
             data-tile-image="${tilePreview}"
             data-distance-info="Distance: 0.${idx}"
             data-date-info="${year}:01:01 12:00:00"
             data-year="${year}"
             data-tile-hash="${hash}"
             data-tile-path="tile-${idx}.jpg">
            <div class="tooltip">
                <img data-src="${tilePreview}" alt="Tile Preview" class="tooltip-image" onerror="this.style.display='none'" style="display:none"/><br/>
                <span class="distance-good">Distance: 0.${idx}</span><br/>
                ${year}:01:01 12:00:00
                <div class="flag-status" id="flag-status-${hash}"></div>
                <button class="flag-button" id="flag-btn-${hash}"
                        onclick="event.stopPropagation(); toggleFlag('${hash}', 'tile-${idx}.jpg')">
                    Flag for Review
                </button>
            </div>
        </div>`;
  }
}

// A 400x300 solid-color JPEG as a data URL keeps the fixture self-contained.
const bgImg = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#999"/><text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="sans-serif" font-size="40" fill="white">MOSAIC</text></svg>`
);

const minYear = 2020, maxYear = 2022;
const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Widget Fixture</title>
    <link rel="stylesheet" href="mosaic-widget.css">
    <script>
        var yearFilterMinYear = ${minYear};
        var yearFilterMaxYear = ${maxYear};
    </script>
    <script src="mosaic-widget.js"></script>
</head>
<body>
    <div class="mosaic-container">
        <div class="zoom-container">
            <img src="${bgImg}" alt="Mosaic Image" class="mosaic-image" />
            <div id="distance-overlay" class="distance-overlay"></div>
${tileRegions}

            <svg id="year-mask-svg" width="0" height="0" aria-hidden="true">
                <defs>
                    <mask id="year-mask" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
                        <rect x="0" y="0" width="1" height="1" fill="white"/>
                    </mask>
                </defs>
            </svg>
            <div id="year-dim-overlay" class="year-dim-overlay" aria-hidden="true"></div>
        </div>

        <div id="year-filter-container" class="year-filter-container image-positioned">
            <label for="year-slider" class="year-filter-label">Year:</label>
            <div class="year-slider-wrapper">
                <input type="range" id="year-slider" class="year-slider" min="${minYear}" max="${maxYear + 1}" value="0" step="1" />
                <div id="year-display" class="year-display">All Years</div>
            </div>
        </div>
    </div>

    <div id="mobile-modal" class="mobile-modal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeMobileModal()">&times;</button>
            <div id="modal-zoom-wrapper" class="modal-zoom-wrapper">
                <img id="modal-image" class="modal-image" alt="Tile Image" />
            </div>
            <div id="modal-info" class="modal-info"></div>
        </div>
    </div>

    <div id="admin-pane" class="admin-pane">
        <h3>Admin</h3>
        <button id="toggle-highlights-btn" class="admin-button" onclick="window.toggleHighlights && window.toggleHighlights()">Show Flagged</button>
        <div id="admin-status" class="admin-status">Admin mode</div>
    </div>
</body>
</html>
`;

writeFileSync(join(out, 'widget.html'), html);
console.log('Built fixture at', join(out, 'widget.html'));
console.log('Tile count:', ROWS * COLS, 'across', years.length, 'years');
