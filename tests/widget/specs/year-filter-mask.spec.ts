import { test, expect, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { FIXTURE_URL } from './fixture-url';

// Bug #6 — year-filter dim overlay must cut visible holes, not paint as a solid rectangle.
//
// Commit 163a740 ("year filter: single overlay + SVG mask") used CSS
// `mask-image: url(#year-mask)` referencing an inline <mask> element. WebKit/
// Safari does not resolve this — the overlay paints as a uniformly dim
// rectangle and the year filter is visually inert in Safari (both desktop
// and iOS). The fix replaces the <div> + CSS mask with an inline <svg>
// overlay using SVG-attribute masking (`<rect mask="url(#year-mask)">`)
// which WebKit honors.
//
// This bug was invisible to the existing element/computed-style tests
// because JS state and computed style were identical between engines; only
// painted pixels diverged. So this regression test reads actual pixel
// luminance at a year-match tile vs. a non-match tile.
//
// Critical engines: desktop-webkit, mobile-webkit. The chromium projects
// run too so the test asserts cross-engine parity.

test.describe('Bug #6 — year-filter mask cuts visible holes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    await page.waitForLoadState('load');
    // Widget's load handler delays layout/init by 500ms; give it room.
    await page.waitForTimeout(800);
  });

  test('match-tile pixel is brighter than non-match-tile pixel when filter is engaged', async ({ page }, testInfo) => {
    // Fixture spans years 2020–2022 across 12 tiles. Pick one match and one
    // non-match in the visible viewport so the screenshot clip lands on real
    // pixels (not off-screen) in every device profile.
    const tilePoints = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('.tile-region'));
      const inView = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        return cx > 8 && cy > 8 && cx < vw - 8 && cy < vh - 8;
      };
      const matchTile = tiles.find(t => t.dataset.year === '2020' && inView(t));
      const nonMatchTile = tiles.find(t => t.dataset.year !== '2020' && inView(t));
      if (!matchTile || !nonMatchTile) {
        return null;
      }
      const ctr = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      };
      return { match: ctr(matchTile), nonMatch: ctr(nonMatchTile) };
    });
    expect(tilePoints, 'fixture must place at least one match + one non-match tile in viewport').not.toBeNull();

    // Sample pre-filter luminance so we know the bug's signature: a tile
    // that's fully visible reads near the fixture grey (#999 → luminance ~153).
    const baselineMatch = await samplePatchLuminance(page, tilePoints!.match, 8);
    const baselineNonMatch = await samplePatchLuminance(page, tilePoints!.nonMatch, 8);

    // Engage the year filter on the first concrete year (slider value 1 →
    // yearFilterMinYear). The handler queues via requestAnimationFrame, so
    // wait two rAFs for the paint to land before sampling.
    await page.evaluate(() => {
      const slider = document.getElementById('year-slider') as HTMLInputElement;
      slider.value = '1';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

    const active = await page.evaluate(() => document.querySelector('.zoom-container')!.classList.contains('year-filter-active'));
    expect(active, 'year-filter-active class must be set after slider input').toBe(true);

    const matchLum = await samplePatchLuminance(page, tilePoints!.match, 8);
    const nonMatchLum = await samplePatchLuminance(page, tilePoints!.nonMatch, 8);
    const delta = matchLum - nonMatchLum;

    testInfo.annotations.push({
      type: 'lum',
      description: `baseline match=${baselineMatch.toFixed(1)} non-match=${baselineNonMatch.toFixed(1)}; filtered match=${matchLum.toFixed(1)} non-match=${nonMatchLum.toFixed(1)}; delta=${delta.toFixed(1)}`,
    });

    // With the fix: match tile shows the underlying #999 image (lum ~153),
    // non-match tile is covered by the 0.7-alpha black overlay (lum ~46),
    // so delta lands around 100. With the bug (overlay paints as solid),
    // both tiles read the same dim value and delta collapses to ~0. Set
    // the threshold at 30 — large enough to swallow anti-aliasing and
    // engine-specific blending differences, small enough that the bug
    // (delta ~0) reliably fails the test.
    expect(delta, `expected match-tile to read substantially brighter than non-match-tile with filter on`).toBeGreaterThan(30);
  });
});

async function samplePatchLuminance(page: Page, c: { x: number; y: number }, size: number): Promise<number> {
  const buf = await page.screenshot({
    clip: { x: Math.max(0, c.x - size / 2), y: Math.max(0, c.y - size / 2), width: size, height: size },
  });
  const png = PNG.sync.read(buf);
  // ITU-R BT.601 luma. PNG data is RGBA, 4 bytes per pixel.
  let sum = 0;
  const n = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return sum / n;
}
