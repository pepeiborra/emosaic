# Mobile Experience Implementation Tasks

## Issue 1: Modal Close with Browser Back Button

### JS Changes (`src/assets/mosaic-widget.js`)

- [x] Add `popstate` event listener in initialization section to detect browser back button
- [x] Modify `showMobileModal()` to call `history.pushState({ modalOpen: true }, '', '')` before showing modal
- [x] Modify `closeMobileModal()` to accept `fromPopstate` parameter (default false)
- [x] In `closeMobileModal()`, call `history.back()` only when `fromPopstate` is false and modal was active
- [x] In `popstate` handler, call `closeMobileModal(true)` if modal is active
- [x] Handle edge case: multiple modals opened in sequence (ensure history stack is clean)

---

## Issue 2: Modal Image Pinch-to-Zoom

### JS Changes (`src/assets/mosaic-widget.js`)

- [x] Add modal zoom state variables: `modalZoom`, `modalPanX`, `modalPanY`, `modalIsPanning`, `modalIsZooming`, `modalLastTouchDistance`, `modalLastTouchCenter`
- [x] Add constants: `MODAL_MAX_ZOOM = 4`, `MODAL_MIN_ZOOM = 1`
- [x] Create `setupModalZoom()` function to attach touch handlers to modal image wrapper
- [x] Create `handleModalTouchStart(e)` - detect single vs two-finger touch, initialize zoom/pan state
- [x] Create `handleModalTouchMove(e)` - handle pinch-to-zoom (2 fingers) and pan (1 finger when zoomed)
- [x] Create `handleModalTouchEnd(e)` - reset state, snap back to 1x if below threshold
- [x] Create `applyModalTransform(smooth)` - apply CSS transform to modal image
- [x] Create `resetModalZoom()` - reset all modal zoom state to defaults
- [x] Call `setupModalZoom()` in `showMobileModal()` after image loads (use `onload` event)
- [x] Call `resetModalZoom()` in `closeMobileModal()` before clearing modal content
- [x] Reuse existing `getTouchDistance()` and `getTouchCenter()` helper functions

### CSS Changes (`src/assets/mosaic-widget.css`)

- [x] Add `.modal-zoom-wrapper` styles: `overflow: hidden`, `touch-action: none`, flexbox centering
- [x] Add `.modal-image` transform styles: `transform-origin: center center`, `will-change: transform`
- [x] Increase `.modal-image` max-height from 50vh to 60vh for better zoom experience
- [x] Add smooth transition class for snap-back animation

### HTML Changes (`src/mosaic/web/widget.rs`)

- [x] Wrap modal image in `<div id="modal-zoom-wrapper" class="modal-zoom-wrapper">` container
- [x] Ensure modal image has `id="modal-image"` attribute (verify existing)

---

## Issue 3: Year Slider Performance (Option C - Year Index + Class Toggle)

**UPDATE**: Option A (CSS attribute selectors) was implemented but was still too slow for 6000+ tiles (~30ms per change). The problem was that CSS attribute selectors like `[data-filter-year="2005"]` still require the browser to check all 6305 tiles.

**Solution**: Switched to Option C (Year Index) with the following approach:
1. Build a year index (Map: year → tiles) once at initialization
2. Use a class on the container (`year-filter-active`) for the "dim all" effect
3. Only add `year-match` class to matching tiles (~400 instead of 6305)

**Result**: ~0.2ms per filter change (vs ~30ms before) = **135x improvement**

### Rust Changes (`src/mosaic/web/widget.rs`)

- [x] ~~Create `generate_year_filter_css(min_year, max_year)` function~~ (no longer needed)
- [x] Function now returns empty string - CSS is in static file

### JS Changes (`src/assets/mosaic-widget.js`)

- [x] Added `tilesByYear` Map for O(1) year lookup
- [x] Added `currentYearMatchTiles` array to track currently highlighted tiles
- [x] Created `buildYearIndex()` function called once at setup
- [x] Rewrote `updateYearFilter()` to:
  - Clear previous matches (fast - only ~400 elements)
  - Add `year-filter-active` class to container (dims all tiles via CSS)
  - Add `year-match` class only to matching tiles (fast - only ~400 elements)

### CSS Changes (`src/assets/mosaic-widget.css`)

- [x] Added `.zoom-container.year-filter-active .tile-region` - dims all tiles
- [x] Added `.zoom-container.year-filter-active .tile-region.year-match` - shows matching tiles

---

## Testing Checklist

### Modal Close (Back Button)
- [ ] Open modal → press browser back → modal closes, page stays
- [ ] Open modal → tap × button → modal closes, subsequent back goes to previous page
- [ ] Open modal → tap outside modal → modal closes, history is clean
- [ ] Rapid open/close cycles → no history stack corruption
- [ ] iOS Safari: swipe-from-left gesture closes modal
- [ ] Android Chrome: back button closes modal

### Modal Zoom
- [ ] Pinch outward → image zooms in (up to 4x)
- [ ] Pinch inward → image zooms out (minimum 1x)
- [ ] Single finger drag when zoomed → image pans
- [ ] Single finger drag at 1x → no pan (or closes modal via backdrop)
- [ ] Zoom below 1.1x and release → snaps back to 1x
- [ ] Double-tap to zoom (optional enhancement)
- [ ] Zoom center follows pinch center point

### Year Slider
- [ ] Drag slider rapidly → instant visual response, no lag
- [ ] Select specific year → only matching tiles visible
- [ ] Select "All Years" → all tiles visible
- [ ] Page load with 2000+ tiles → no initialization delay
- [ ] Verify `data-filter-year` attribute appears on container
- [ ] Verify tiles have correct `data-year` attributes
- [ ] Performance: measure time for slider change (target: <16ms for 60fps)

---

## Implementation Order

1. **Phase 1: Quick Win**
   - [x] Modal back button support (Issue 1)

2. **Phase 2: Year Slider Fix**
   - [x] CSS generation in Rust (Issue 3)
   - [x] JS simplification (Issue 3)
   - [x] CSS cleanup (Issue 3)

3. **Phase 3: Modal Zoom**
   - [x] HTML wrapper structure (Issue 2)
   - [x] JS touch handlers (Issue 2)
   - [x] CSS styles (Issue 2)

---

## Files Summary

| File | Issues |
|------|--------|
| `src/assets/mosaic-widget.js` | 1, 2, 3 |
| `src/assets/mosaic-widget.css` | 2, 3 |
| `src/mosaic/web/widget.rs` | 2, 3 |
