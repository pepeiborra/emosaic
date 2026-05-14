import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from './fixture-url';

// Bug #1: the entire mosaic image must be visible — not cropped by any
// ancestor's overflow/clip, and the rendered <img> must keep its natural
// aspect ratio (i.e. no off-axis scaling that hides part of the image).
//
// The widget centers the image in a flex container with overflow:hidden,
// so any layout change that pushes the image past the container's edge
// silently clips it. This test asserts the visible rect equals the
// rendered rect equals the natural-aspect rect.

test.describe('Bug #1 — mosaic image is fully visible', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE_URL);
    // Wait for image to actually decode so getBoundingClientRect is meaningful.
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image');
      return !!img && img.complete && img.naturalWidth > 0;
    });
  });

  test('rendered <img> has non-zero size and natural aspect ratio', async ({ page }) => {
    const dims = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image')!;
      const rect = img.getBoundingClientRect();
      return {
        rectW: rect.width,
        rectH: rect.height,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
      };
    });

    expect(dims.rectW, 'rendered width must be > 0').toBeGreaterThan(0);
    expect(dims.rectH, 'rendered height must be > 0').toBeGreaterThan(0);
    expect(dims.naturalW).toBeGreaterThan(0);
    expect(dims.naturalH).toBeGreaterThan(0);

    // Aspect-ratio check: rendered ratio must match natural ratio.
    // (object-fit:fill on the image would let it stretch; this catches that.)
    const renderedRatio = dims.rectW / dims.rectH;
    const naturalRatio = dims.naturalW / dims.naturalH;
    expect(Math.abs(renderedRatio - naturalRatio)).toBeLessThan(0.01);
  });

  test('image is fully inside the viewport (no off-screen clipping)', async ({ page }) => {
    const fit = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image')!;
      const r = img.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        r,
        vw,
        vh,
        offTop: r.top < 0 ? -r.top : 0,
        offBottom: r.bottom > vh ? r.bottom - vh : 0,
        offLeft: r.left < 0 ? -r.left : 0,
        offRight: r.right > vw ? r.right - vw : 0,
      };
    });
    // Allow a 1-px sub-pixel slop; anything more is real clipping.
    expect(fit.offTop, `image clipped at top by ${fit.offTop}px`).toBeLessThanOrEqual(1);
    expect(fit.offBottom, `image clipped at bottom by ${fit.offBottom}px`).toBeLessThanOrEqual(1);
    expect(fit.offLeft, `image clipped at left by ${fit.offLeft}px`).toBeLessThanOrEqual(1);
    expect(fit.offRight, `image clipped at right by ${fit.offRight}px`).toBeLessThanOrEqual(1);
  });

  test('image is not clipped by any ancestor with overflow:hidden', async ({ page }) => {
    // Walk up the parent chain; for each ancestor with overflow != visible,
    // verify the image's rect lies fully inside its rect.
    const clip = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image')!;
      const imgRect = img.getBoundingClientRect();
      const offenders: Array<{ tag: string; cls: string; overflow: string; cutPx: number }> = [];
      let el: HTMLElement | null = img.parentElement;
      while (el && el !== document.documentElement) {
        const cs = window.getComputedStyle(el);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const r = el.getBoundingClientRect();
          const cutTop = Math.max(0, r.top - imgRect.top);
          const cutBottom = Math.max(0, imgRect.bottom - r.bottom);
          const cutLeft = Math.max(0, r.left - imgRect.left);
          const cutRight = Math.max(0, imgRect.right - r.right);
          const cutPx = Math.max(cutTop, cutBottom, cutLeft, cutRight);
          if (cutPx > 1) {
            offenders.push({
              tag: el.tagName.toLowerCase(),
              cls: el.className || '(no class)',
              overflow: `${cs.overflow}/${cs.overflowX}/${cs.overflowY}`,
              cutPx,
            });
          }
        }
        el = el.parentElement;
      }
      return offenders;
    });
    expect(clip, `image clipped by ancestor(s): ${JSON.stringify(clip)}`).toEqual([]);
  });

  test('zoom-container height does not exceed image height (no extra space)', async ({ page }) => {
    // A regression we hit during development: a stray inline-flow SVG inside
    // zoom-container gave it a line box and added baseline height beyond the
    // image. Catch that recurring.
    const heights = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('.mosaic-image')!;
      const zoom = document.querySelector<HTMLElement>('.zoom-container')!;
      return {
        imgH: img.getBoundingClientRect().height,
        zoomH: zoom.getBoundingClientRect().height,
      };
    });
    // Allow 2 px slop for sub-pixel rendering.
    expect(
      heights.zoomH - heights.imgH,
      `zoom-container is ${heights.zoomH - heights.imgH}px taller than the image`
    ).toBeLessThanOrEqual(2);
  });
});
