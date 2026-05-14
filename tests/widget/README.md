# Mosaic widget — Playwright tests

End-to-end regression suite for the generated mosaic widget HTML+CSS+JS.
Covers two reported bug families:

- **Bug #1** — mosaic image fully visible (not cropped by ancestor `overflow:hidden`)
- **Bug #2** — clicking a tile opens the right popup (mobile modal / desktop new tab)

## One-time setup

```bash
cd tests/widget
npm install
npm run install-browsers   # downloads Chromium + WebKit (~170 MB total)
```

Browsers are cached under `~/Library/Caches/ms-playwright`; the install
only re-downloads when the Playwright version changes.

## Running locally

```bash
cd tests/widget
npm test
```

That builds a synthetic fixture (`fixtures/build-fixture.mjs`) and runs
every spec across four browser profiles in parallel:

| Project | Engine | Viewport | What it catches |
|---|---|---|---|
| `desktop-chromium` | Chromium | 1280×720 | Desktop layout / click behaviour |
| `desktop-webkit` | WebKit (Safari) | 1280×720 | Safari-specific CSS / SVG bugs |
| `mobile-chromium` | Chromium | 412×915 (Pixel 7) | Android mobile modal |
| `mobile-webkit` | WebKit | 393×852 (iPhone 14) | iOS mobile modal |

Expected baseline: **18 passed / 0 failed / 10 skipped**. Skipped counts
reflect per-project filters (e.g. desktop-only tests skip on mobile profiles,
and vice versa).

For a watch-mode UI with traces and screenshots:

```bash
npm run test:ui
```

## Running against a deployed widget

Set `EMOSAIC_FIXTURE_URL` to a `mosaic_widget.html` URL. The same specs run
against the live page:

```bash
EMOSAIC_FIXTURE_URL='https://casadelmanco.com/mosaics/<uuid>/mosaic_widget.html' \
  npm test
```

Remote runs get 2 automatic retries (network jitter can drop synthetic clicks
before the page is ready); local file:// runs stay at 0 retries.

## The fixture

`fixtures/build-fixture.mjs` writes `fixtures/widget.html` plus a copy of the
real `src/assets/mosaic-widget.{js,css}`. The HTML mirrors what
`src/mosaic/web/widget.rs` emits — same DOM structure, same data attributes —
so any change to those assets is exercised on the next `npm test`.

Knobs (top of `build-fixture.mjs`):

- `W` / `H` — natural size of the synthetic background image. Defaults to
  627×883 portrait, deliberately chosen to overflow a 1280×720 viewport when
  scaled to viewport width — that's what reproduces Bug #1 locally. Drop to
  e.g. 400×300 if you want a non-cropping fixture for new tests.
- `COLS` / `ROWS` — tile grid dimensions.
- `years` — which years are represented across the grid.

## Specs

- `image-visibility.spec.ts` — asserts the rendered `<img.mosaic-image>` has
  non-zero size, keeps its natural aspect ratio, fits within the viewport,
  and is not clipped by any ancestor with `overflow:hidden`.
- `popup.spec.ts` — mobile: tap a tile, expect `#mobile-modal.active` with
  image + metadata; desktop: click a tile, expect `window.open(tileUrl)`;
  also guards against the year-filter overlay swallowing taps.

Add a new spec under `specs/`, import `FIXTURE_URL` from `./fixture-url`,
and Playwright will pick it up on the next run.

## CI

`tests/widget/.gitignore` excludes `node_modules`, `test-results`,
`playwright-report`, and the generated fixture files. The `package.json`
`test` script runs `build-fixture` before invoking Playwright, so CI just
needs to install and call `npm test` (then `EMOSAIC_FIXTURE_URL=… npm test`
for a deployed-widget smoke check).
