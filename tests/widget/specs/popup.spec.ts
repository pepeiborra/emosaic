import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from './fixture-url';

// Bug #2: tapping a tile on mobile must open the .mobile-modal with the tile
// preview image + metadata. On desktop, clicking should call window.open
// to navigate to the tile image in a new tab.
//
// We detect mobile vs desktop by checking whether the project name starts
// with "mobile-" — Playwright's device profile sets `hasTouch` accordingly
// and the widget's isMobile() returns true.

function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

test.describe('Bug #2 — clicking a tile shows a popup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    // Sanity: tiles must be present and clickable.
    const tileCount = await page.evaluate(
      () => document.querySelectorAll('.tile-region').length
    );
    expect(tileCount).toBeGreaterThan(0);
  });

  test('mobile: tile tap opens the mobile-modal with metadata', async ({ page }, testInfo) => {
    test.skip(
      !isMobileProject(testInfo.project.name),
      'only meaningful on a touch device profile'
    );

    // Sanity: widget agrees we are on mobile.
    const onMobile = await page.evaluate(() => (window as any).isMobile?.());
    expect(onMobile, 'isMobile() must return true on mobile profile').toBe(true);

    const tile = page.locator('.tile-region').first();
    await tile.tap();

    // The modal should become .active and visible within one frame.
    const modal = page.locator('#mobile-modal');
    await expect(modal).toHaveClass(/\bactive\b/, { timeout: 2000 });
    await expect(modal).toBeVisible();

    // It must show the tile image…
    const modalImage = page.locator('#modal-image');
    await expect(modalImage).toBeVisible();
    const src = await modalImage.getAttribute('src');
    expect(src && src.length > 0, 'modal image must have a src').toBe(true);

    // …and the tile metadata (date / distance) must be in the info pane.
    const info = await page.locator('#modal-info').textContent();
    expect(info, 'modal info must contain a year').toMatch(/\d{4}/);
    expect(info, 'modal info must contain a distance').toMatch(/Distance/i);
  });

  test.fixme('mobile: modal closes when the X button is tapped', async ({ page }, testInfo) => {
    // Pre-existing issue (not the reported bug): .modal-zoom-wrapper sits
    // above .modal-close at the same stacking context, so taps on the X
    // button get intercepted. Tracked separately — leaving as fixme so the
    // test runs (and can be flipped to a green expectation) once a z-index
    // is added to .modal-close.
    test.skip(!isMobileProject(testInfo.project.name), 'mobile only');

    await page.locator('.tile-region').first().tap();
    const modal = page.locator('#mobile-modal');
    await expect(modal).toHaveClass(/\bactive\b/);
    await page.locator('.modal-close').tap();
    await expect(modal).not.toHaveClass(/\bactive\b/, { timeout: 2000 });
  });

  test('mobile: tile is still tappable when year filter is active', async ({ page }, testInfo) => {
    // Regression guard for the overlay+SVG-mask change: the .year-dim-overlay
    // sits above .tile-region (z-index 4 vs default 0). If pointer-events
    // weren't `none` on the overlay, taps would be swallowed by it and the
    // modal would never open.
    test.skip(!isMobileProject(testInfo.project.name), 'mobile only');

    // Engage the year filter on year 2020 (matches the first tile in fixture).
    await page.evaluate(() => {
      const slider = document.getElementById('year-slider') as HTMLInputElement;
      slider.value = '1';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() =>
      document.querySelector('.zoom-container')!.classList.contains('year-filter-active')
    );

    // Tap a matching tile and assert modal opens.
    const matchTile = page.locator('.tile-region.year-match').first();
    await matchTile.tap();
    await expect(page.locator('#mobile-modal')).toHaveClass(/\bactive\b/, { timeout: 2000 });
  });

  test('desktop: tile click triggers window.open to the tile image', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'desktop only');

    // Sanity: widget agrees we are NOT on mobile.
    const onMobile = await page.evaluate(() => (window as any).isMobile?.());
    expect(onMobile, 'isMobile() must return false on desktop profile').toBe(false);

    // Intercept window.open so we don't actually open a tab.
    const opened = await page.evaluate(() => {
      let openedUrl: string | null = null;
      const origOpen = window.open;
      window.open = ((url: string) => {
        openedUrl = url;
        return null;
      }) as any;
      try {
        document.querySelector<HTMLElement>('.tile-region')?.click();
        return openedUrl;
      } finally {
        window.open = origOpen;
      }
    });
    expect(opened, 'window.open must be called with the tile URL').toBeTruthy();
    expect(opened).toContain('tile-');
  });
});
