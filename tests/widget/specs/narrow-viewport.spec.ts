import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from './fixture-url';

// Bug #4: narrow desktop viewports (Chrome split-screen, sidebar layouts,
// vertical-monitor setups, etc.) used to skip the image-sizing rule because
// it was gated on `@media (min-width: 769px) and (hover: hover)`. The image
// then rendered at its natural size (6272×8832 in prod) inside a flex-
// centered, overflow:hidden container — the visible portion looked correct
// but tile-regions were positioned far outside the viewport, so hover
// tooltips appeared off-screen or never fired at all.
//
// This spec runs the desktop-chromium engine but FORCES a narrow viewport
// after navigation, which the standard `devices['Desktop Chrome']` profile
// doesn't cover.

test.describe('Bug #4 — narrow desktop viewport (sidebar / split layout)', () => {
  // Skip on mobile projects — they already use a touch device profile,
  // (hover: none), and a different rendering path (initializeMobileZoom).
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop-only failure');
    // Re-create a 494×836 viewport AFTER the project's default applies.
    await page.setViewportSize({ width: 494, height: 836 });
    await page.goto(FIXTURE_URL);
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    await page.waitForLoadState('load');
    await page.waitForTimeout(800);
  });

  test('image fits in narrow viewport (does not render at natural size)', async ({ page }) => {
    const fit = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image')!;
      const r = img.getBoundingClientRect();
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        naturalW: img.naturalWidth, naturalH: img.naturalHeight,
        renderedW: r.width, renderedH: r.height,
      };
    });
    // The actual symptom: rendered dims must not equal natural dims (which
    // would mean the constraint rule didn't apply). On a 494×836 viewport
    // with a 627×883 (fixture) or 6272×8832 (prod) portrait image, the
    // rendered height should be ≤ viewport height.
    expect(fit.renderedW, 'rendered width must fit viewport').toBeLessThanOrEqual(fit.vw + 1);
    expect(fit.renderedH, 'rendered height must fit viewport').toBeLessThanOrEqual(fit.vh + 1);
    // Aspect-ratio preserved (within 1%).
    const naturalRatio = fit.naturalW / fit.naturalH;
    const renderedRatio = fit.renderedW / fit.renderedH;
    expect(Math.abs(renderedRatio - naturalRatio)).toBeLessThan(0.01);
  });

  test('tile-regions land inside the viewport (not pushed off by overflow)', async ({ page }) => {
    const sample = await page.evaluate(() => {
      // Pick a tile whose position-percent puts it visibly within the image
      // (middle of the grid). If the image is at natural size, this tile's
      // absolute viewport coords will be far outside the 494-wide viewport.
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('.tile-region'));
      const i = Math.floor(tiles.length / 2);
      const r = tiles[i].getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
    });
    // The middle tile must have its CENTER inside the viewport. With a
    // natural-size image overflowing the 494×836 container, the centre
    // ends up at e.g. (-2700, -3700) — far outside.
    const cx = sample.x + sample.w / 2;
    const cy = sample.y + sample.h / 2;
    expect(cx).toBeGreaterThanOrEqual(0);
    expect(cx).toBeLessThanOrEqual(sample.vw);
    expect(cy).toBeGreaterThanOrEqual(0);
    expect(cy).toBeLessThanOrEqual(sample.vh);
  });

  test('hovering a visible tile reveals its tooltip (the user-visible symptom)', async ({ page }) => {
    // Identify the index of the first tile whose CENTRE lies inside the
    // viewport, then hover it via a Playwright Locator (which actually
    // triggers CSS :hover). The user's reported symptom is that this
    // tooltip ends up either invisible or off-screen.
    const idx = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('.tile-region'));
      return tiles.findIndex(t => {
        const r = t.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        return cx > 10 && cx < window.innerWidth - 10 && cy > 10 && cy < window.innerHeight - 10;
      });
    });
    expect(idx, 'must find at least one visible tile to hover').toBeGreaterThanOrEqual(0);
    const tile = page.locator('.tile-region').nth(idx);
    await tile.hover();
    const tooltip = tile.locator('.tooltip');
    await expect.poll(
      async () => tooltip.evaluate(t => {
        const cs = window.getComputedStyle(t);
        return { opacity: cs.opacity, visibility: cs.visibility };
      }),
      { timeout: 2000 }
    ).toEqual({ opacity: '1', visibility: 'visible' });
    // Tooltip must not land entirely off-screen.
    const r = await tooltip.evaluate(t => {
      const b = t.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const vp = page.viewportSize()!;
    const onScreen = r.x + r.w > 0 && r.x < vp.width && r.y + r.h > 0 && r.y < vp.height;
    expect(onScreen, `tooltip rect ${JSON.stringify(r)} must intersect viewport ${JSON.stringify(vp)}`).toBe(true);
  });
});
