# Year Slider Performance — Report

## Problem
On large mosaics, dragging the year-filter slider felt sluggish. The original
implementation flipped a `year-match` class on every matching tile and let CSS
paint a dim background on every other tile. With 2 k+ tiles, each slider step
triggered ~800 class flips and a repaint of ~2 k tile-region backgrounds — plus
the global `transition: background-color 0.2 s` re-interpolated all of them.

## Benchmark setup
- **Fixture**: `/Users/pepeiborra/.claude/jobs/fbddf239/fixture/bench_widget.html`
  generated from `image166.jpeg` against `Fotos campo` with
  `--tile-size 16 --mode 16 --crop`. 2,220 `.tile-region` placements, 20 unique
  years (2003–2023).
- **Driver**: Chrome via the chrome-devtools MCP. Script in
  `/Users/pepeiborra/.claude/jobs/fbddf239/bench.js`.
- **Stepwise scenario**: set slider 1→21, dispatch `input`, wait two rAFs (one
  full paint) between steps. Total = sum of per-step times.
- **Fast-scrub scenario**: fire all 21 `input` events back-to-back, wait two rAFs
  for the final paint to settle.
- 5 measured runs after 1 warmup. Reset to "All Years" between runs.
- Display: 60 Hz → rAF interval ~16.7 ms → stepwise floor = 21 × 33 = **~693 ms**.

## Findings during exploration
1. The original input handler re-queried `getElementById('year-display')` and
   `querySelector('.zoom-container')` on every event.
2. `transition: background-color 0.2s` on `.tile-region` caused ongoing
   animations on every dim/undim. Across ~800 affected tiles per step this
   produced overlapping paint work.
3. The activation hitch (All → first year) repainted all ~2 200 tiles at once;
   that single step took 326 ms in the baseline.
4. rAF coalescing eliminated almost all redundant JS in the fast-scrub case
   (verified: 1 flush ran for 21 dispatched events) but only shaved a small
   amount of wall time — paint of ~2 200 tiles was the real bottleneck.
5. CSS `contain: layout style paint` on `.tile-region` shaved ~25 ms more by
   bounding style-invalidation scope, but couldn't push past the per-tile paint
   ceiling.
6. **The structural fix** that unlocked the floor: stop painting per tile.
   Instead, a single full-cover dim overlay sits above the mosaic image, and
   an SVG mask cuts holes at year-match tile positions. Per slider step we
   replace the mask's `<rect>`s (cached per year as a string) in one DOM
   mutation; the browser paints one element. The per-tile `year-match` class
   is retained only as a `pointer-events` gate (no paint impact).

## Iteration table

| Metric | Baseline | + rAF coalesce + cache + `transition:none` | + `contain` | **Final: overlay + SVG mask** |
|---|---:|---:|---:|---:|
| Stepwise avg total | 841.6 ms | 888.3 ms | 814.2 ms | **699.8 ms** |
| Step median | 33.4 ms | 33.3 ms | 33.4 ms | 33.3 ms |
| Step P95 | 58.4 ms | 115.4 ms | 74.6 ms | **33.5 ms** |
| Step max | 325.7 ms | 150.8 ms | 120.9 ms | **34.4 ms** |
| Fast scrub avg | 167.6 ms | 144.9 ms | 123.1 ms | **32.9 ms** |

## Targets
| Metric | Target | Final | Result |
|---|---:|---:|:---:|
| Stepwise avg | ≤720 ms | 699.8 ms (1 % above 60 Hz floor) | ✓ |
| Fast scrub avg | ≤50 ms | 32.9 ms (one paint) | ✓ |
| Step max | ≤50 ms | 34.4 ms | ✓ |

## Headline improvements (baseline → final)
- **Fast scrub**: 167.6 → 32.9 ms (**-80 %**) — the user-perceived drag metric
- **Step max**: 325.7 → 34.4 ms (**-89 %**) — eliminated the activation hitch
- **Stepwise total**: 841.6 → 699.8 ms (**-17 %**, at the 60 Hz physical floor)

## Files touched (committed as `3174ada`)
- `src/mosaic/web/widget.rs` — emit `<svg id="year-mask-svg">` + `<div id="year-dim-overlay">` inside the zoom-container
- `src/assets/mosaic-widget.css` — overlay rules, drop per-tile dim, `contain` hint, position SVG out of flow
- `src/assets/mosaic-widget.js` — overlay-driven `updateYearFilter`, per-year mask cache, rAF coalescing, cached DOM refs

## Validation
- `cargo test --release` → 34 passed / 0 failed, including `test_generate_mosaic_widget`.
- Visual sanity check at year 2006: matches show through as bright "windows"; overlay
  is flush with image bottom (no extra dark strip after positioning the SVG
  `<defs>` carrier out of inline flow).

## Stress test — tougher fixture
Re-ran the benchmark on a much harder fixture to confirm the change scales:
`marco2.jpeg` cropped at `--tile-size 32 --downsample 2 --no-repeat`,
producing **6,305 placements across 22 years** (vs 2,220 / 20 in the primary
fixture). Same harness, 5 runs, 60 Hz display → 22-step floor = ~733 ms.

| Metric | Baseline | Final (overlay) | Δ |
|---|---:|---:|---:|
| Stepwise avg total | 1,285.5 ms | **751.4 ms** | **-41.5 %** |
| Stepwise per-run | 950 / 982 / **2,555** / 943 / 997 | 752 / 750 / 751 / 753 / 751 | variance ~10× → flat |
| Step median | 33.5 ms | 33.4 ms | — |
| Step P95 | 112.6 ms | 44.5 ms | -60 % |
| Step max | **1,375 ms** | **63.8 ms** | **-95.4 %** |
| Fast scrub avg | 157.1 ms | **50.8 ms** | **-67.7 %** |

What this shows: per-tile dim paint scales linearly with tile count (the 2006
activation hitch grew from 326 ms at 2.2 k tiles to 1,375 ms at 6.3 k tiles —
nearly a full 1.4-second visible stall). The overlay-and-mask approach stays
within 2-3× of the rAF floor regardless of placement count, because the paint
cost is constant: one element per step. The optimization's win grows with the
size of the mosaic.
