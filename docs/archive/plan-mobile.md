# Mobile Experience Improvement Plan

## Executive Summary

This plan addresses three critical mobile UX issues in the emosaic web viewer:
1. Modal close behavior not matching user expectations (browser back button)
2. No pinch-to-zoom on tile card images
3. Year slider performance degradation with 2000+ DOM elements

## Current State Analysis

### Issue 1: Modal Close Behavior

**Current implementation** (`src/assets/mosaic-widget.js` lines 806-830):
- Close button (×) in modal header
- Click outside modal to close
- NO browser back button support

**User expectation**: On mobile, users instinctively use the browser back button to dismiss overlays/modals. The current implementation leaves the modal open and may navigate away from the page entirely.

### Issue 2: Tile Card Zoom

**Current implementation** (`src/assets/mosaic-widget.css` lines 171-180):
```css
.modal-image {
    max-width: 100%;
    max-height: 50vh;
    min-width: 400px;
    object-fit: contain;
}
```

- Static image with no gesture handling
- Main mosaic has pinch-to-zoom, but modal doesn't inherit this
- Modal touch events focus on backdrop clicks, not image interaction

### Issue 3: Year Slider Performance

**Current implementation** (`src/assets/mosaic-widget.js` lines 935-977):
```javascript
function updateYearFilter(sliderValue) {
    const tiles = document.querySelectorAll('.tile-region');
    tiles.forEach(tile => {
        // Manipulates ALL 2000+ tiles on EVERY slider input
        tile.classList.add/remove('disabled');
    });
}
```

**Problems**:
- Queries ALL `.tile-region` elements on every slider input event
- No debouncing - fires continuously during drag
- Direct class manipulation on 2000+ elements triggers style recalculation
- Combined with 2000+ distance overlay tiles = ~4000 DOM elements

---

## Proposed Solutions

### Solution 1: History API Integration for Modal

**Approach**: Use the browser History API to push a state when the modal opens, and listen for `popstate` to close it.

**Implementation**:

```javascript
// In showMobileModal():
function showMobileModal(tileImageUrl, distanceInfo, dateInfo, tileRegion) {
    // Push state BEFORE showing modal
    history.pushState({ modalOpen: true, tileUrl: tileImageUrl }, '', '');

    // ... existing modal display code ...
}

// In closeMobileModal():
function closeMobileModal(fromPopstate = false) {
    const modal = document.getElementById('mobile-modal');
    if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
        // ... existing cleanup code ...

        // Only go back if not triggered by popstate (avoid double navigation)
        if (!fromPopstate && history.state?.modalOpen) {
            history.back();
        }
    }
}

// Add popstate listener (in initialization):
window.addEventListener('popstate', function(event) {
    const modal = document.getElementById('mobile-modal');
    if (modal && modal.classList.contains('active')) {
        closeMobileModal(true); // true = triggered by popstate
    }
});
```

**Benefits**:
- Browser back button closes modal naturally
- Swipe-back gesture on iOS also works
- No visual URL change (empty string in pushState)
- Backward compatible with existing close methods

**Files to modify**:
- `src/assets/mosaic-widget.js`: Add history management

---

### Solution 2: Modal Image Pinch-to-Zoom

**Approach**: Create a dedicated zoom container inside the modal with touch gesture handling similar to the main mosaic.

**Implementation**:

```javascript
// New modal zoom state
let modalZoom = 1;
let modalPanX = 0;
let modalPanY = 0;
let modalIsPanning = false;
let modalIsZooming = false;
let modalLastTouchDistance = 0;
let modalLastTouchCenter = { x: 0, y: 0 };

const MODAL_MAX_ZOOM = 4;
const MODAL_MIN_ZOOM = 1;

function setupModalZoom() {
    const modalContent = document.querySelector('.modal-content');
    const modalImage = document.getElementById('modal-image');

    if (!modalContent || !modalImage) return;

    // Wrap image in zoom container if not already
    let zoomWrapper = document.getElementById('modal-zoom-wrapper');
    if (!zoomWrapper) {
        zoomWrapper = document.createElement('div');
        zoomWrapper.id = 'modal-zoom-wrapper';
        zoomWrapper.className = 'modal-zoom-wrapper';
        modalImage.parentNode.insertBefore(zoomWrapper, modalImage);
        zoomWrapper.appendChild(modalImage);
    }

    // Touch handlers for modal zoom
    zoomWrapper.addEventListener('touchstart', handleModalTouchStart, { passive: false });
    zoomWrapper.addEventListener('touchmove', handleModalTouchMove, { passive: false });
    zoomWrapper.addEventListener('touchend', handleModalTouchEnd, { passive: false });
}

function handleModalTouchStart(e) {
    if (e.touches.length === 1) {
        modalIsPanning = modalZoom > 1; // Only pan when zoomed in
        modalLastTouchCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
        e.preventDefault();
        modalIsZooming = true;
        modalIsPanning = false;
        modalLastTouchDistance = getTouchDistance(e.touches[0], e.touches[1]);
        modalLastTouchCenter = getTouchCenter(e.touches[0], e.touches[1]);
    }
}

function handleModalTouchMove(e) {
    const modalImage = document.getElementById('modal-image');
    if (!modalImage) return;

    if (e.touches.length === 2 && modalIsZooming) {
        e.preventDefault();

        const touchDistance = getTouchDistance(e.touches[0], e.touches[1]);
        const touchCenter = getTouchCenter(e.touches[0], e.touches[1]);

        if (modalLastTouchDistance > 0) {
            const zoomDelta = touchDistance / modalLastTouchDistance;
            const proposedZoom = modalZoom * zoomDelta;
            const newZoom = Math.min(MODAL_MAX_ZOOM, Math.max(MODAL_MIN_ZOOM, proposedZoom));

            // Zoom toward pinch center
            const rect = modalImage.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const zoomPointX = touchCenter.x - centerX;
            const zoomPointY = touchCenter.y - centerY;

            const zoomRatio = newZoom / modalZoom;
            modalPanX = zoomPointX + (modalPanX - zoomPointX) * zoomRatio;
            modalPanY = zoomPointY + (modalPanY - zoomPointY) * zoomRatio;

            modalZoom = newZoom;
            modalLastTouchDistance = touchDistance;
        }

        applyModalTransform();
    } else if (e.touches.length === 1 && modalIsPanning && modalZoom > 1) {
        e.preventDefault();

        const deltaX = e.touches[0].clientX - modalLastTouchCenter.x;
        const deltaY = e.touches[0].clientY - modalLastTouchCenter.y;

        modalPanX += deltaX;
        modalPanY += deltaY;

        modalLastTouchCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        applyModalTransform();
    }
}

function handleModalTouchEnd(e) {
    if (e.touches.length === 0) {
        modalIsZooming = false;
        modalIsPanning = false;
        modalLastTouchDistance = 0;

        // Snap back to 1x if zoomed out below threshold
        if (modalZoom < 1.1) {
            modalZoom = 1;
            modalPanX = 0;
            modalPanY = 0;
            applyModalTransform(true);
        }
    }
}

function applyModalTransform(smooth = false) {
    const modalImage = document.getElementById('modal-image');
    if (!modalImage) return;

    modalImage.style.transition = smooth ? 'transform 0.2s ease-out' : 'none';
    modalImage.style.transform = `translate(${modalPanX}px, ${modalPanY}px) scale(${modalZoom})`;
}

function resetModalZoom() {
    modalZoom = 1;
    modalPanX = 0;
    modalPanY = 0;
    const modalImage = document.getElementById('modal-image');
    if (modalImage) {
        modalImage.style.transform = '';
        modalImage.style.transition = '';
    }
}
```

**CSS additions**:
```css
.modal-zoom-wrapper {
    overflow: hidden;
    touch-action: none;
    display: flex;
    justify-content: center;
    align-items: center;
    max-height: 60vh;
}

.modal-image {
    transform-origin: center center;
    will-change: transform;
}
```

**Integration**:
- Call `setupModalZoom()` in `showMobileModal()` after image loads
- Call `resetModalZoom()` in `closeMobileModal()` for cleanup

**Files to modify**:
- `src/assets/mosaic-widget.js`: Add modal zoom handlers
- `src/assets/mosaic-widget.css`: Add zoom wrapper styles
- `src/mosaic/web/widget.rs`: Add zoom wrapper div structure

---

### Solution 3: Year Slider Performance Redesign

This is the most complex change. Three approaches, in order of recommendation:

#### Option A: CSS-Based Filtering with Data Attributes (Recommended)

**Approach**: Use a single CSS rule with attribute selectors instead of manipulating individual elements.

**Implementation**:

1. **Add a container-level attribute for the selected year**:
```javascript
function updateYearFilter(sliderValue) {
    const container = document.querySelector('.zoom-container');
    const display = document.getElementById('year-display');

    if (sliderValue === 0) {
        container.removeAttribute('data-filter-year');
        display.textContent = 'All Years';
    } else {
        const selectedYear = yearFilterMinYear + sliderValue - 1;
        container.setAttribute('data-filter-year', selectedYear);
        display.textContent = String(selectedYear);
    }
}
```

2. **CSS handles visibility**:
```css
/* When filtering is active, hide non-matching tiles */
.zoom-container[data-filter-year] .tile-region {
    pointer-events: none;
    opacity: 0.3;
}

/* Show only matching tiles */
.zoom-container[data-filter-year="2020"] .tile-region[data-year="2020"],
.zoom-container[data-filter-year="2021"] .tile-region[data-year="2021"],
/* ... generated for each year ... */
{
    pointer-events: auto;
    opacity: 1;
}
```

3. **Generate CSS dynamically** (in widget.rs):
```rust
fn generate_year_filter_css(&self, min_year: i32, max_year: i32) -> String {
    let mut css = String::new();
    for year in min_year..=max_year {
        css.push_str(&format!(
            ".zoom-container[data-filter-year=\"{}\"] .tile-region[data-year=\"{}\"] {{ pointer-events: auto; opacity: 1; }}\n",
            year, year
        ));
    }
    css
}
```

**Benefits**:
- Single attribute change instead of 2000+ class manipulations
- Browser optimizes CSS selector matching
- No JavaScript iteration needed
- Instant response regardless of tile count

**Drawbacks**:
- Requires generating ~30 CSS rules (one per year)
- Slightly larger CSS payload

#### Option B: Debounced + requestAnimationFrame

**Approach**: Keep current logic but add debouncing and batch updates.

```javascript
let yearFilterDebounceTimer = null;
let yearFilterPendingValue = null;

function updateYearFilter(sliderValue) {
    yearFilterPendingValue = sliderValue;

    if (yearFilterDebounceTimer) {
        return; // Already scheduled
    }

    yearFilterDebounceTimer = requestAnimationFrame(() => {
        yearFilterDebounceTimer = null;
        applyYearFilter(yearFilterPendingValue);
    });
}

function applyYearFilter(sliderValue) {
    // Use classList.toggle for efficiency
    const tiles = document.querySelectorAll('.tile-region');
    const selectedYear = sliderValue === 0 ? null : yearFilterMinYear + sliderValue - 1;

    // Batch DOM reads first
    const updates = [];
    tiles.forEach(tile => {
        const tileYear = tile.dataset.year;
        const shouldDisable = selectedYear !== null &&
            (tileYear === 'unknown' || parseInt(tileYear) !== selectedYear);
        const isDisabled = tile.classList.contains('disabled');

        if (shouldDisable !== isDisabled) {
            updates.push({ tile, shouldDisable });
        }
    });

    // Batch DOM writes
    updates.forEach(({ tile, shouldDisable }) => {
        tile.classList.toggle('disabled', shouldDisable);
    });
}
```

**Benefits**:
- Minimal code changes
- Reduces redundant updates during drag
- Only modifies tiles that need changing

**Drawbacks**:
- Still O(n) iteration
- Still slow for initial filter application

#### Option C: Virtual Year Index (Most Performant)

**Approach**: Pre-compute year->tile mappings and only manipulate visible/changed tiles.

```javascript
// Build index once at initialization
const tilesByYear = new Map(); // year -> Set of tile elements

function buildYearIndex() {
    const tiles = document.querySelectorAll('.tile-region');
    tiles.forEach(tile => {
        const year = tile.dataset.year;
        if (!tilesByYear.has(year)) {
            tilesByYear.set(year, new Set());
        }
        tilesByYear.get(year).add(tile);
    });
}

let currentFilteredYear = null;

function updateYearFilter(sliderValue) {
    const newYear = sliderValue === 0 ? null : String(yearFilterMinYear + sliderValue - 1);

    if (newYear === currentFilteredYear) return;

    requestAnimationFrame(() => {
        // Only update changed tiles
        if (currentFilteredYear !== null) {
            // Unhide previously filtered year
            const oldTiles = tilesByYear.get(currentFilteredYear);
            if (oldTiles) {
                oldTiles.forEach(t => t.classList.add('disabled'));
            }
        }

        if (newYear === null) {
            // Show all - remove disabled from everything
            tilesByYear.forEach(tiles => {
                tiles.forEach(t => t.classList.remove('disabled'));
            });
        } else {
            // Hide all except selected year
            tilesByYear.forEach((tiles, year) => {
                const shouldShow = year === newYear;
                tiles.forEach(t => t.classList.toggle('disabled', !shouldShow));
            });
        }

        currentFilteredYear = newYear;
    });
}
```

**Benefits**:
- O(1) lookup for year groups
- Minimal DOM manipulation when switching between years
- Pre-computed at load time

**Drawbacks**:
- Additional memory for index
- More complex state management

---

## Implementation Order

### Phase 1: Quick Wins (Low Risk)
1. **History API for modal** - Standalone change, high user impact
2. **Year slider debouncing** (Option B) - Immediate improvement, minimal code change

### Phase 2: Modal Enhancement
3. **Modal pinch-to-zoom** - Requires careful touch event handling

### Phase 3: Performance Optimization
4. **CSS-based year filtering** (Option A) - Requires Rust template changes

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/assets/mosaic-widget.js` | History API, modal zoom handlers, year filter optimization |
| `src/assets/mosaic-widget.css` | Modal zoom wrapper styles, CSS year filter rules |
| `src/mosaic/web/widget.rs` | Modal HTML structure, generate year filter CSS |

---

## Testing Plan

1. **Modal close behavior**:
   - Open modal, press browser back → modal closes, page stays
   - Open modal, close via × button → modal closes, back button behavior unchanged
   - Open modal, tap outside → modal closes, history cleaned up

2. **Modal zoom**:
   - Pinch to zoom in → image scales up to 4x
   - Pan when zoomed → image moves within bounds
   - Pinch out below 1x → snaps back to 1x

3. **Year slider**:
   - Drag slider rapidly → no lag, smooth updates
   - Initial page load → no delay from year filter setup
   - Switch between years → instant visual response

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| History API | Low | Feature detection, fallback to current behavior |
| Modal zoom | Medium | Isolate touch handlers, test on iOS/Android |
| CSS year filter | Low | Generated CSS is deterministic, easy to verify |
| Year index | Medium | Memory overhead for large tilesets, fallback to debounced version |

---

## Estimated Complexity

- **Issue 1 (Back button)**: Small - ~50 lines JS
- **Issue 2 (Modal zoom)**: Medium - ~150 lines JS + CSS
- **Issue 3 (Year slider)**: Medium to Large - depends on chosen approach
  - Option A (CSS): ~30 lines Rust + ~50 lines CSS
  - Option B (Debounce): ~40 lines JS
  - Option C (Index): ~80 lines JS
