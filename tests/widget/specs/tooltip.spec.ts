import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from './fixture-url';

// Bug #3: hovering a tile on desktop must show the tooltip — the dark box
// with the tile's preview image and date metadata. The widget relies on a
// CSS `.tile-region:hover .tooltip { opacity:1; visibility:visible }` rule
// to reveal it, with JS lazily loading the preview image into
// `<img.tooltip-image>` and positioning the tooltip to avoid screen edges.
// Mobile profiles hide tooltips by design (the modal replaces them on tap).

function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

test.describe('Bug #3 — tooltip appears on hover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    await page.waitForLoadState('load');
    await page.waitForTimeout(800);
  });

  test('desktop: hovering a tile reveals tooltip (opacity 1, visibility visible)', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'desktop only — mobile hides tooltips by CSS');

    const tile = page.locator('.tile-region').nth(0);
    await tile.hover();
    const tooltip = tile.locator('.tooltip');

    // CSS rule `.tile-region:hover .tooltip { opacity:1; visibility:visible }`
    // is what reveals the tooltip; assert against computed values so a
    // regression in either rule (or a media-query override) is flagged.
    await expect.poll(
      async () => tooltip.evaluate(t => {
        const cs = window.getComputedStyle(t);
        return { opacity: cs.opacity, visibility: cs.visibility };
      }),
      { timeout: 2000 }
    ).toEqual({ opacity: '1', visibility: 'visible' });
  });

  test('desktop: revealed tooltip actually paints (compositor visibility, not just JS)', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'desktop only');

    // The opacity/visibility/getBoundingClientRect checks above pass even
    // when `contain: paint` on .tile-region silently clips the tooltip's
    // pixels to the tile's ~11px box. document.elementFromPoint, in
    // contrast, asks the compositor what's actually paintable at the
    // point — if the tooltip's pixels are clipped, elementFromPoint
    // returns the underlying tile-region (or its sibling) instead of
    // the tooltip or its descendants.
    const tile = page.locator('.tile-region').nth(0);
    await tile.hover();
    await page.waitForTimeout(150); // let positionTooltipSmartly settle
    const hit = await tile.evaluate(t => {
      const tooltip = (t as HTMLElement).querySelector<HTMLElement>('.tooltip')!;
      const r = tooltip.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const el = document.elementFromPoint(cx, cy);
      const inTooltip = el === tooltip || (el && tooltip.contains(el));
      return {
        tooltipRect: { x: r.x, y: r.y, w: r.width, h: r.height },
        hitPoint: { cx, cy },
        hitElement: el ? `${el.tagName.toLowerCase()}.${el.className || '(no class)'}` : 'null',
        inTooltip,
      };
    });
    expect(
      hit.inTooltip,
      `elementFromPoint(${hit.hitPoint.cx}, ${hit.hitPoint.cy}) returned ${hit.hitElement} ` +
      `instead of the tooltip or a descendant — tooltip is JS-visible but ` +
      `compositor-clipped (likely contain:paint on an ancestor with smaller box). ` +
      `Tooltip rect: ${JSON.stringify(hit.tooltipRect)}`,
    ).toBe(true);
  });

  test('desktop: hovered tile loads its preview image (loadTooltipImage runs)', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'desktop only');

    const tile = page.locator('.tile-region').nth(0);
    await tile.hover();
    const img = tile.locator('.tooltip-image');

    // loadTooltipImage swaps img.src in from data-src and flips display:block.
    // A failure here means either the hover listener didn't fire or the
    // image-load path is broken.
    await expect.poll(
      async () => img.evaluate((el: HTMLImageElement) => ({
        hasSrc: !!el.src && el.src.length > 0,
        display: window.getComputedStyle(el).display,
      })),
      { timeout: 5000, message: 'tooltip image must load + display after hover' }
    ).toMatchObject({ hasSrc: true, display: 'block' });
  });

  test('desktop: tooltip metadata (year) is visible inside the revealed tooltip', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'desktop only');

    const tile = page.locator('.tile-region').nth(0);
    await tile.hover();
    const tooltip = tile.locator('.tooltip');

    // The reveal must paint readable text — guards against a tooltip that's
    // positioned off-screen or zero-sized despite opacity:1.
    await expect(tooltip).toBeVisible({ timeout: 2000 });
    const text = (await tooltip.textContent()) || '';
    expect(text).toMatch(/\d{4}/);
  });

  test('desktop: rapid hover across many tiles still shows tooltip on the final one', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'desktop only');

    // Production mosaics have thousands of ~10×10 px tiles; the cursor crosses
    // many of them in a single move. Each mouseenter fires both an inline
    // loadTooltipImage(this) and a setupSmartTooltips-deferred call, and the
    // positioning function temporarily flips inline visibility while measuring.
    // If the resets lag behind the next enter, the final hovered tile's
    // tooltip can stay stuck hidden. Reproduce that pattern.
    const tiles = page.locator('.tile-region');
    const total = await tiles.count();
    test.skip(total < 5, 'fixture has too few tiles to stress-test (need ≥5)');

    // Visit a handful of tiles quickly, then settle on the last one.
    const indices = [0, 1, 2, 3, 4].filter(i => i < total);
    for (const i of indices.slice(0, -1)) {
      await tiles.nth(i).hover();
    }
    // Final hover is the one whose tooltip must end up visible.
    const finalTile = tiles.nth(indices[indices.length - 1]);
    await finalTile.hover();
    const finalTooltip = finalTile.locator('.tooltip');

    await expect.poll(
      async () => finalTooltip.evaluate(t => {
        const cs = window.getComputedStyle(t);
        return { opacity: cs.opacity, visibility: cs.visibility };
      }),
      { timeout: 3000, message: 'after rapid hover across tiles, final tile must reveal its tooltip' }
    ).toEqual({ opacity: '1', visibility: 'visible' });
  });

  test('mobile: tooltip stays hidden on tap (modal replaces it)', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), 'mobile only');

    const tile = page.locator('.tile-region').first();
    const tooltip = tile.locator('.tooltip');
    await tile.tap();
    const state = await tooltip.evaluate(t => {
      const cs = window.getComputedStyle(t);
      return { display: cs.display, opacity: cs.opacity, visibility: cs.visibility };
    });
    expect(state.display).toBe('none');
  });
});
