import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from './fixture-url';

// Bug #7 — on mobile the year-filter slider used to be anchored to the
// rendered image (bottom-right of the visible mosaic) by JavaScript that
// re-ran on every pan/zoom. As soon as the user panned or zoomed in, the
// filter scrolled off-screen with the image.
//
// The fix: on mobile, position the filter at a fixed viewport location
// (CSS `position: fixed; right; bottom`) so it stays put through pan/zoom.

test.describe('Bug #7 — mobile year-filter floats over the viewport', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile-only behavior');
    await page.goto(FIXTURE_URL);
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    await page.waitForLoadState('load');
    // Widget defers mobile init by ~100ms; give it room.
    await page.waitForTimeout(800);
  });

  test('uses position: fixed so it does not move with the zoom-container transform', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const el = document.querySelector('.year-filter-container.image-positioned') as HTMLElement;
      if (!el) return null;
      return getComputedStyle(el).position;
    });
    expect(pos).toBe('fixed');
  });

  test('stays anchored to the viewport after panning the mosaic', async ({ page }) => {
    const before = await page.evaluate(() => {
      const el = document.querySelector('.year-filter-container.image-positioned') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    expect(before.w, 'year filter must be rendered').toBeGreaterThan(0);

    // Simulate a pan by translating the zoom-container directly. We avoid
    // synthetic touch events because they vary across browser engines —
    // applying the transform exercises the same final state pan would
    // produce (zoom-container shifted, year-filter must not follow).
    await page.evaluate(() => {
      const zc = document.querySelector('.zoom-container') as HTMLElement;
      zc.style.transform = 'translate(-200px, -150px) scale(1.5)';
      // Trigger the widget's own positioning logic too, in case it still
      // tries to override CSS.
      if (typeof (window as any).positionYearFilter === 'function') {
        (window as any).positionYearFilter();
      }
    });
    await page.waitForTimeout(50);

    const after = await page.evaluate(() => {
      const el = document.querySelector('.year-filter-container.image-positioned') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });

    // Position must be unchanged (within 1px for sub-pixel rounding).
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  });

  test('sits inside the viewport (visible to the user)', async ({ page }) => {
    const visible = await page.evaluate(() => {
      const el = document.querySelector('.year-filter-container.image-positioned') as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        inViewport: r.right > 0 && r.bottom > 0
          && r.left < window.innerWidth && r.top < window.innerHeight,
        right: r.right, bottom: r.bottom,
        vw: window.innerWidth, vh: window.innerHeight,
      };
    });
    expect(visible.inViewport, `expected filter visible in ${visible.vw}x${visible.vh} viewport`).toBe(true);
    // Anchored to the bottom-right with ~12px margin → right edge close to vw,
    // bottom edge close to vh. Allow generous slack for safe-area padding.
    expect(visible.vw - visible.right).toBeLessThan(40);
    expect(visible.vh - visible.bottom).toBeLessThan(40);
  });
});
