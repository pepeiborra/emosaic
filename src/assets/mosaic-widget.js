// Mobile detection
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           ('ontouchstart' in window) ||
           (navigator.maxTouchPoints > 0);
}

// Attempt to hide Safari toolbar on iOS
function attemptHideIOSToolbar() {
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        console.log('iOS detected - attempting to hide Safari toolbar');
        
        // Method 1: Scroll trick to hide address bar
        setTimeout(() => {
            window.scrollTo(0, 1);
        }, 100);
        
        // Method 2: Request fullscreen if supported
        if (document.documentElement.requestFullscreen) {
            document.addEventListener('touchstart', function requestFullscreen() {
                document.documentElement.requestFullscreen().catch(() => {
                    console.log('Fullscreen request failed or not supported');
                });
                document.removeEventListener('touchstart', requestFullscreen);
            }, { once: true });
        }
        
        // Method 3: Detect if running as web app (added to home screen)
        if (window.navigator.standalone) {
            console.log('Running as standalone web app - toolbar already hidden');
        } else {
            console.log('Running in Safari browser - toolbar may be visible');
            console.log('Tip: Add to Home Screen for full-screen experience');
        }
    }
}

// Zoom and pan state
let currentZoom = 1;
let currentPanX = 0;
let currentPanY = 0;
let lastTouchDistance = 0;
let lastTouchCenter = { x: 0, y: 0 };
let isPanning = false;
let isZooming = false;
let wasZooming = false;
let minZoom = 0.5; // Will be updated based on image fit
const maxZoom = 5;

// Touch handling for zoom and pan
function getTouchDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touch1, touch2) {
    return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2
    };
}

function calculateMinZoom() {
    const image = document.querySelector('.mosaic-image');
    const container = document.querySelector('.mosaic-container');

    console.log('calculateMinZoom called');

    if (!isMobile()) {
        return 0.1; // Very low value for desktop, effectively no limit
    }

    if (!image || !container) {
        return 0.5;
    }

    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        return 0.5;
    }

    const containerRect = container.getBoundingClientRect();

    console.log('Container dimensions:', containerRect.width, 'x', containerRect.height);

    // On mobile, image renders at 1:1 scale (natural size)
    // Calculate what zoom would make the image fit entirely in the container
    const scaleToFitWidth = containerRect.width / image.naturalWidth;
    const scaleToFitHeight = containerRect.height / image.naturalHeight;

    // The minimum zoom is the smaller scale (fits both dimensions)
    const scaleToFit = Math.min(scaleToFitWidth, scaleToFitHeight);

    // Add small buffer to ensure image fits completely, but don't exceed 1.0
    const minZoomValue = Math.min(scaleToFit * 0.95, 1);

    return minZoomValue;
}

function updateMinZoom() {

    const newMinZoom = calculateMinZoom();
    const oldMinZoom = minZoom;
    minZoom = newMinZoom;

    // If current zoom is below new minimum, adjust it
    if (currentZoom < minZoom) {
        currentZoom = minZoom;
        applyTransform(true);
    }
}

function initializeMobileZoom() {
    if (isMobile()) {
        console.log('Mobile detected - initializing at minimum zoom');
        updateMinZoom();
        currentZoom = minZoom;
        // Reset pan to center when initializing
        currentPanX = 0;
        currentPanY = 0;
        applyTransform(false);
        console.log('Mobile zoom initialized to:', currentZoom);
    }
}

function constrainPan() {
    if (!isMobile()) {
        console.log('Desktop: no pan constraints');
        return;
    }
    
    const image = document.querySelector('.mosaic-image');
    const container = document.querySelector('.mosaic-container');
    
    if (!image || !container || image.naturalWidth === 0 || image.naturalHeight === 0) {
        return;
    }
    
    const containerRect = container.getBoundingClientRect();
    
    // Calculate the current scaled image dimensions
    const scaledImageWidth = image.naturalWidth * currentZoom;
    const scaledImageHeight = image.naturalHeight * currentZoom;
    
    console.log('Pan constraint - Container:', containerRect.width, 'x', containerRect.height);
    console.log('Pan constraint - Scaled image:', scaledImageWidth, 'x', scaledImageHeight);
    
    let constrainedPanX = currentPanX;
    let constrainedPanY = currentPanY;
    
    // Constrain horizontal pan
    if (scaledImageWidth > containerRect.width) {
        // Image is wider than container - constrain to keep image filling screen
        const maxPanX = (scaledImageWidth - containerRect.width) / 2;
        const minPanX = -maxPanX;
        constrainedPanX = Math.min(maxPanX, Math.max(minPanX, currentPanX));
        console.log('Horizontal constraint - Min:', minPanX, 'Max:', maxPanX, 'Current:', currentPanX, 'Constrained:', constrainedPanX);
    } else {
        // Image is narrower than container - center it
        constrainedPanX = 0;
        console.log('Image narrower than container - centering horizontally');
    }
    
    // Constrain vertical pan
    if (scaledImageHeight > containerRect.height) {
        // Image is taller than container - constrain to keep image filling screen
        const maxPanY = (scaledImageHeight - containerRect.height) / 2;
        const minPanY = -maxPanY;
        constrainedPanY = Math.min(maxPanY, Math.max(minPanY, currentPanY));
        console.log('Vertical constraint - Min:', minPanY, 'Max:', maxPanY, 'Current:', currentPanY, 'Constrained:', constrainedPanY);
    } else {
        // Image is shorter than container - center it
        constrainedPanY = 0;
        console.log('Image shorter than container - centering vertically');
    }
    
    // Update pan values if they were constrained
    if (constrainedPanX !== currentPanX || constrainedPanY !== currentPanY) {
        console.log('Pan constrained from:', currentPanX, currentPanY, 'to:', constrainedPanX, constrainedPanY);
        currentPanX = constrainedPanX;
        currentPanY = constrainedPanY;
    }
}

function applyTransform(smooth = false) {
    // Apply pan constraints before transform on mobile
    constrainPan();
    
    const zoomContainer = document.querySelector('.zoom-container');
    if (zoomContainer) {
        // Add or remove smooth transition class
        if (smooth) {
            zoomContainer.classList.add('smooth-transition');
        } else {
            zoomContainer.classList.remove('smooth-transition');
        }
        const transformValue = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
        console.log('Applying transform:', transformValue, 'smooth:', smooth);
        zoomContainer.style.transform = transformValue;

        // Update CSS variable to counteract zoom for year filter
        updateYearFilterScale();
    }
}

function updateYearFilterScale() {
    // Position year filter at bottom-right of visible image
    positionYearFilter();
}

function positionYearFilter() {
    const yearFilter = document.querySelector('.year-filter-container.image-positioned');
    const image = document.querySelector('.mosaic-image');
    const container = document.querySelector('.mosaic-container');

    if (!yearFilter || !image || !container) {
        console.log('Year filter positioning skipped - missing elements');
        return;
    }

    // Wait for image to be fully loaded and rendered
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        console.log('Year filter positioning skipped - image not loaded');
        setTimeout(() => positionYearFilter(), 50);
        return;
    }

    // Get the actual rendered position and size of the image
    const imageRect = image.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Ensure we have valid dimensions
    if (imageRect.width === 0 || imageRect.height === 0 ||
        containerRect.width === 0 || containerRect.height === 0) {
        console.log('Year filter positioning skipped - invalid dimensions');
        setTimeout(() => positionYearFilter(), 50);
        return;
    }

    // Calculate position relative to container
    const rightOffset = 10; // pixels from right edge of image
    const bottomOffset = 10; // pixels from bottom edge of image

    // Position at bottom-right of the visible image
    const left = (imageRect.right - containerRect.left) - yearFilter.offsetWidth - rightOffset;
    const top = (imageRect.bottom - containerRect.top) - yearFilter.offsetHeight - bottomOffset;

    yearFilter.style.left = Math.max(0, left) + 'px';
    yearFilter.style.top = Math.max(0, top) + 'px';

    // Check if year filter would be outside the visible screen area
    const yearFilterRect = yearFilter.getBoundingClientRect();
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Hide if completely outside screen bounds
    if (yearFilterRect.right < 0 || yearFilterRect.left > screenWidth ||
        yearFilterRect.bottom < 0 || yearFilterRect.top > screenHeight) {
        yearFilter.style.display = 'none';
    } else {
        yearFilter.style.display = '';
    }
}

function resetZoom() {
    currentZoom = 1;
    currentPanX = 0;
    currentPanY = 0;
    applyTransform(true); // Use smooth transition for reset
}

function handleTouchStart(e) {
    if (e.touches.length === 1) {
        // Single touch - prepare for panning
        isPanning = true;
        lastTouchCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
        // Two touches - prepare for zoom
        e.preventDefault();
        isZooming = true;
        isPanning = false;
        lastTouchDistance = getTouchDistance(e.touches[0], e.touches[1]);
        lastTouchCenter = getTouchCenter(e.touches[0], e.touches[1]);
    }
}

function handleTouchMove(e) {
    if (e.touches.length === 1 && isPanning && !isZooming) {
        // Single touch panning
        const touch = e.touches[0];
        const deltaX = touch.clientX - lastTouchCenter.x;
        const deltaY = touch.clientY - lastTouchCenter.y;

        currentPanX += deltaX;
        currentPanY += deltaY;

        lastTouchCenter = { x: touch.clientX, y: touch.clientY };
        applyTransform(false); // No transition during active pan
    } else if (e.touches.length === 2 && isZooming) {
        // Two touch zoom and pan
        e.preventDefault();

        const touchDistance = getTouchDistance(e.touches[0], e.touches[1]);
        const touchCenter = getTouchCenter(e.touches[0], e.touches[1]);

        // Calculate zoom
        if (lastTouchDistance > 0) {
            const zoomDelta = touchDistance / lastTouchDistance;
            const proposedZoom = currentZoom * zoomDelta;

            let newZoom;
            if (isMobile()) {
                // Mobile: enforce both min and max zoom
                newZoom = Math.min(maxZoom, Math.max(minZoom, proposedZoom));
            } else {
                // Desktop: only enforce max zoom, no minimum
                newZoom = Math.min(maxZoom, proposedZoom);
            }

            // Zoom towards the center of the pinch
            const container = document.querySelector('.mosaic-container');
            const containerRect = container.getBoundingClientRect();
            const centerX = containerRect.width / 2;
            const centerY = containerRect.height / 2;

            // Calculate the point we're zooming towards relative to container center
            const zoomPointX = touchCenter.x - containerRect.left - centerX;
            const zoomPointY = touchCenter.y - containerRect.top - centerY;

            // Adjust pan to zoom towards the pinch point
            const zoomRatio = newZoom / currentZoom;
            currentPanX = zoomPointX + (currentPanX - zoomPointX) * zoomRatio;
            currentPanY = zoomPointY + (currentPanY - zoomPointY) * zoomRatio;

            // Mark that we're actively zooming if there's significant change
            if (Math.abs(zoomDelta - 1) > 0.02) {
                wasZooming = true;
            }

            currentZoom = newZoom;
        }

        // Update for next iteration
        lastTouchDistance = touchDistance;
        lastTouchCenter = touchCenter;
        applyTransform(false); // No transition during active zoom
    }
}

function handleTouchEnd(e) {
    console.log('TouchEnd - touches remaining:', e.touches.length, 'zoom:', currentZoom, 'wasZooming:', wasZooming);
    if (e.touches.length === 0) {
        // All touches released - maintain current zoom/pan state
        isPanning = false;
        isZooming = false;
        lastTouchDistance = 0;

        console.log('All touches released, preserving zoom state:', currentZoom);
        // Ensure the final transform is applied without resetting
        applyTransform(false);

        // Set a flag to prevent any automatic resets
        setTimeout(() => {
            console.log('Zoom state after timeout:', currentZoom, 'transform:', document.querySelector('.zoom-container').style.transform);
        }, 100);

        // Clear wasZooming after delay
        setTimeout(() => { wasZooming = false; }, 1000);
    } else if (e.touches.length === 1) {
        // Transition from zoom to pan
        isZooming = false;
        isPanning = true;
        lastTouchCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        lastTouchDistance = 0;
    }
}

function toggleDistanceOverlay() {
    const overlay = document.getElementById('distance-overlay');
    if (overlay) {
        overlay.classList.toggle('visible');
    }
    // Notify parent window of state change
    if (window.parent !== window) {
        const isVisible = overlay && overlay.classList.contains('visible');
        window.parent.postMessage({
            type: 'distanceOverlayToggled',
            visible: isVisible
        }, '*');
    }
}

function openTileImage(imagePath, isWebCompatible) {
    if (isWebCompatible) {
        // For web hosting, open the relative URL directly
        console.log('Opening tile image:', imagePath);
        window.open(imagePath, '_blank');
    } else {
        // Convert file path to file:// URL for local files
        let absolutePath;
        if (imagePath.startsWith('/') || imagePath.match(/^[A-Za-z]:/)) {
            absolutePath = imagePath;
        } else {
            // Use current directory as fallback for local files
            const cwd = window.location.protocol === 'file:' ?
                window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) :
                '';
            absolutePath = cwd + '/' + imagePath;
        }
        const fileUrl = 'file://' + absolutePath;
        console.log('Opening tile image:', absolutePath);
        window.open(fileUrl, '_blank');
    }
}

// Listen for messages from parent window
window.addEventListener('message', function(event) {
    if (event.data.type === 'toggleDistanceOverlay') {
        toggleDistanceOverlay();
    }
});

// Adjust positioning when image loads or window resizes
function adjustMosaicLayout() {
    const image = document.querySelector('.mosaic-image');
    const container = document.querySelector('.mosaic-container');
    const zoomContainer = document.querySelector('.zoom-container');
    const overlay = document.querySelector('.distance-overlay');
    const tileRegions = document.querySelectorAll('.tile-region');
    const overlayTiles = document.querySelectorAll('.distance-overlay-tile');

    if (!image || !container || !zoomContainer) return;

    // Store current zoom state to preserve it
    const currentTransform = zoomContainer.style.transform;
    console.log('adjustMosaicLayout called, current transform:', currentTransform, 'zoom state:', currentZoom);

    // Get actual image dimensions and position relative to zoom container
    const imageRect = image.getBoundingClientRect();
    const zoomContainerRect = zoomContainer.getBoundingClientRect();

    // Calculate offset from zoom container to image
    const offsetX = imageRect.left - zoomContainerRect.left;
    const offsetY = imageRect.top - zoomContainerRect.top;

    // Update overlay dimensions and position to match the image exactly
    if (overlay) {
        overlay.style.left = offsetX + 'px';
        overlay.style.top = offsetY + 'px';
        overlay.style.width = imageRect.width + 'px';
        overlay.style.height = imageRect.height + 'px';
    }


    // Distance overlay tiles should keep their percentage positioning relative to the overlay container
    // Since the overlay container is already positioned and sized to match the image,
    // the tiles inside should maintain their original percentage positions

    // Restore zoom state if it was modified
    if (currentTransform && currentTransform !== zoomContainer.style.transform) {
        console.log('Restoring transform after layout adjustment');
        zoomContainer.style.transform = currentTransform;
    } else if (currentZoom !== 1 || currentPanX !== 0 || currentPanY !== 0) {
        // Re-apply current zoom state even if transform looks the same
        console.log('Re-applying zoom state after layout adjustment');
        applyTransform(false);
    }
}

// Adjust layout when image loads and on window resize
window.addEventListener('load', function() {
    console.log('Window loaded, initializing features...');
    attemptHideIOSToolbar();
    adjustMosaicLayout();
    setupModalEvents();
    setupYearFilter();
    setupTouchHandlers();
    // Update minimum zoom after everything is loaded
    setTimeout(() => {
        updateMinZoom();
        initializeMobileZoom();
        positionYearFilter();
    }, 100);
    console.log('All features initialized');
});
window.addEventListener('resize', function() {
    adjustMosaicLayout();
    // Update minimum zoom after resize
    updateMinZoom();
    // Preserve zoom state after layout adjustment
    if (currentZoom !== 1 || currentPanX !== 0 || currentPanY !== 0) {
        setTimeout(() => applyTransform(false), 10);
    }
    // Reposition year filter after resize
    setTimeout(() => positionYearFilter(), 10);
});

// Debounced orientation change handler
let orientationChangeTimeout;
function handleOrientationChange() {
    clearTimeout(orientationChangeTimeout);
    orientationChangeTimeout = setTimeout(() => {
        console.log('Orientation changed, adjusting layout...');
        adjustMosaicLayout();
        // Update minimum zoom after orientation change
        updateMinZoom();
        // On mobile, reinitialize to minimum zoom after orientation change
        initializeMobileZoom();
        // Preserve zoom state after orientation change (only for desktop)
        if (!isMobile() && (currentZoom !== 1 || currentPanX !== 0 || currentPanY !== 0)) {
            setTimeout(() => applyTransform(false), 50);
        }
        // Reposition year filter after orientation change with additional delay
        setTimeout(() => positionYearFilter(), 100);
        // Additional positioning attempt for stubborn cases
        setTimeout(() => positionYearFilter(), 300);
    }, 150);
}

// Handle orientation changes specifically
window.addEventListener('orientationchange', handleOrientationChange);

// Also listen for screen.orientation changes (modern browsers)
if (screen && screen.orientation) {
    screen.orientation.addEventListener('change', handleOrientationChange);
}

function setupTouchHandlers() {
    const container = document.querySelector('.mosaic-container');
    if (container && 'ontouchstart' in window) {
        container.addEventListener('touchstart', handleTouchStart, { passive: false });
        container.addEventListener('touchmove', handleTouchMove, { passive: false });
        container.addEventListener('touchend', handleTouchEnd, { passive: false });
    }

    // Setup year filter touch handling
    setupYearFilterTouchHandlers();
}

function setupYearFilterTouchHandlers() {
    const yearSlider = document.getElementById('year-slider');
    if (yearSlider) {
        // Prevent year slider touches from bubbling up to image pan/zoom handlers
        yearSlider.addEventListener('touchstart', function(e) {
            e.stopPropagation();
        }, { passive: true });

        yearSlider.addEventListener('touchmove', function(e) {
            e.stopPropagation();
        }, { passive: true });

        yearSlider.addEventListener('touchend', function(e) {
            e.stopPropagation();
        }, { passive: true });
    }
}

function loadTooltipImage(tileRegion) {
    // Don't load tooltip images on mobile devices
    if (isMobile()) {
        return;
    }
    
    const img = tileRegion.querySelector('.tooltip-image');
    if (img && img.dataset.src && !img.src) {
        console.log('Loading tooltip image for tile');
        img.src = img.dataset.src;
        img.style.display = 'block';
    }
}

function handleTileClick(imagePath, isWebCompatible, tileElement, tileImageUrl, distanceInfo, dateInfo) {
    if (isMobile()) {
        showMobileModal(tileImageUrl, distanceInfo, dateInfo);
    } else {
        openTileImage(imagePath, isWebCompatible);
    }
}

function showMobileModal(imageUrl, distanceInfo, dateInfo) {
    const modal = document.getElementById('mobile-modal');
    const modalImage = document.getElementById('modal-image');
    const modalInfo = document.getElementById('modal-info');

    if (!modal || !modalImage || !modalInfo) return;

    modalImage.src = imageUrl;
    modalInfo.innerHTML = distanceInfo + dateInfo;
    modal.classList.add('active');

    // Prevent body scrolling when modal is open
    document.body.style.overflow = 'hidden';
}

function closeMobileModal() {
    const modal = document.getElementById('mobile-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Close modal when clicking outside content
function setupModalEvents() {
    const modal = document.getElementById('mobile-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeMobileModal();
            }
        });
    }
}

// Year filter functionality
// Note: yearFilterMinYear and yearFilterMaxYear are defined in the HTML

function setupYearFilter() {
    const slider = document.getElementById('year-slider');
    const display = document.getElementById('year-display');

    if (!slider || !display) {
        console.log('Year filter elements not found');
        return;
    }

    console.log('Setting up year filter with range:', yearFilterMinYear, 'to', yearFilterMaxYear);

    // Set slider range: 0 = "All", 1 to N = specific years
    slider.min = '0';
    slider.max = String(yearFilterMaxYear - yearFilterMinYear + 1);
    slider.value = '0'; // Default to "All"

    console.log('Slider range set to 0 -', slider.max);

    slider.addEventListener('input', function() {
        const value = parseInt(this.value);
        console.log('Slider value changed to:', value);
        updateYearFilter(value);
    });
}

function updateYearFilter(sliderValue) {
    const display = document.getElementById('year-display');
    const tiles = document.querySelectorAll('.tile-region');

    if (!display || !tiles.length) {
        console.log('Display or tiles not found for year filter');
        return;
    }

    console.log('Updating year filter with value:', sliderValue, 'Total tiles:', tiles.length);

    if (sliderValue === 0) {
        // Show all tiles
        display.textContent = 'All Years';
        tiles.forEach(tile => {
            if (tile.classList.contains('disabled')) {
                tile.classList.remove('disabled');
            }
        });
        console.log('Showing all tiles');
    } else {
        // Filter by specific year
        const selectedYear = yearFilterMinYear + sliderValue - 1;
        display.textContent = String(selectedYear);
        console.log('Filtering by year:', selectedYear);

        let enabledCount = 0;
        let disabledCount = 0;

        tiles.forEach(tile => {
            const tileYear = tile.dataset.year;
            if (tileYear === 'unknown' || parseInt(tileYear) !== selectedYear) {
                    tile.classList.add('disabled');
                disabledCount++;
            } else {
                    tile.classList.remove('disabled');
                enabledCount++;
            }
        });

        console.log('Year filter results - Enabled:', enabledCount, 'Disabled:', disabledCount);
    }
}

// Make functions globally accessible
window.toggleDistanceOverlay = toggleDistanceOverlay;
window.openTileImage = openTileImage;
window.adjustMosaicLayout = adjustMosaicLayout;
window.loadTooltipImage = loadTooltipImage;
window.handleTileClick = handleTileClick;
window.showMobileModal = showMobileModal;
window.closeMobileModal = closeMobileModal;
window.setupYearFilter = setupYearFilter;
window.updateYearFilter = updateYearFilter;
window.setupTouchHandlers = setupTouchHandlers;
window.setupYearFilterTouchHandlers = setupYearFilterTouchHandlers;
window.positionYearFilter = positionYearFilter;
window.resetZoom = resetZoom;
window.calculateMinZoom = calculateMinZoom;
window.updateMinZoom = updateMinZoom;
window.initializeMobileZoom = initializeMobileZoom;
window.constrainPan = constrainPan;
window.attemptHideIOSToolbar = attemptHideIOSToolbar;