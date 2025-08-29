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

// Constrain panning (on mobile)
function constrainPan() {
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
    if (isMobile()) {
        constrainPan();
    }

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
        if (isMobile()) {
            positionYearFilter();
        }
    }
}

// Position year filter at bottom-right of visible image (used on mobile)
function positionYearFilter() {
    const yearFilter = document.querySelector('.year-filter-container.image-positioned');
    const image = document.querySelector('.mosaic-image');
    const container = document.querySelector('.mosaic-container');

    if (!yearFilter || !image || !container) {
        console.log('Year filter positioning skipped - missing elements');
        return;
    }

    if (!isMobile()) {
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

    // Calculate position relative to container (mobile only)
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
function setupSmartTooltips() {
    // Only set up for desktop devices
    if (isMobile()) return;
    
    const tileRegions = document.querySelectorAll('.tile-region');
    tileRegions.forEach(tileRegion => {
        // Add mouseenter event to position tooltip
        tileRegion.addEventListener('mouseenter', () => {
            // Small delay to ensure tooltip content is loaded/rendered
            setTimeout(() => positionTooltipSmartly(tileRegion), 10);
        });
    });
}

function repositionVisibleTooltips() {
    // Only for desktop devices
    if (isMobile()) return;
    
    const tileRegions = document.querySelectorAll('.tile-region');
    tileRegions.forEach(tileRegion => {
        const tooltip = tileRegion.querySelector('.tooltip');
        // Check if tooltip is visible (opacity > 0 and visibility not hidden)
        if (tooltip && 
            tooltip.style.opacity !== '0' && 
            tooltip.style.visibility !== 'hidden' &&
            window.getComputedStyle(tooltip).opacity > 0) {
            positionTooltipSmartly(tileRegion);
        }
    });
}

window.addEventListener('load', function() {
    console.log('Window loaded, initializing features...');
    attemptHideIOSToolbar();
    adjustMosaicLayout();
    setupYearFilter();
    setupTouchHandlers();
    setupSmartTooltips();

    // Initialize flag system
    window.flagSystem = new TileFlagSystem();

    // Update minimum zoom after everything is loaded
    setTimeout(() => {
        if (isMobile()) {
            updateMinZoom();
            initializeMobileZoom();
            positionYearFilter();
        }
    }, 100);
    console.log('All features initialized');
});
window.addEventListener('resize', function() {
    adjustMosaicLayout();
    if (isMobile()) {
        // Update minimum zoom after resize
        updateMinZoom();
        // Preserve zoom state after layout adjustment
        if (currentZoom !== 1 || currentPanX !== 0 || currentPanY !== 0) {
            setTimeout(() => applyTransform(false), 10);
        }
        // Reposition year filter after resize
        setTimeout(() => positionYearFilter(), 10);
    } else {
        // Reposition visible tooltips on desktop after resize
        setTimeout(() => repositionVisibleTooltips(), 10);
    }
});

// Debounced orientation change handler
let orientationChangeTimeout;
function handleOrientationChange() {
    clearTimeout(orientationChangeTimeout);
    orientationChangeTimeout = setTimeout(() => {
        console.log('Orientation changed, adjusting layout...');
        if (isMobile()) {
            adjustMosaicLayout();
            // Update minimum zoom after orientation change
            updateMinZoom();
            // On mobile, reinitialize to minimum zoom after orientation change
            initializeMobileZoom();
            // Reposition year filter after orientation change with additional delay
            setTimeout(() => positionYearFilter(), 100);
            // Additional positioning attempt for stubborn cases
            setTimeout(() => positionYearFilter(), 300);
        } else {
            // Preserve zoom state after orientation change (only for desktop)
            if (currentZoom !== 1 || currentPanX !== 0 || currentPanY !== 0) {
                setTimeout(() => applyTransform(false), 50);
            }
        }
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

function positionTooltipSmartly(tileRegion) {
    const tooltip = tileRegion.querySelector('.tooltip');
    if (!tooltip) return;

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get tile region position and dimensions
    const tileRect = tileRegion.getBoundingClientRect();
    
    // Clear any previous max-height constraints
    tooltip.style.maxHeight = '';
    tooltip.style.overflowY = '';
    
    // Force tooltip to be visible temporarily to measure its dimensions
    const originalVisibility = tooltip.style.visibility;
    const originalOpacity = tooltip.style.opacity;
    const originalDisplay = tooltip.style.display;
    
    tooltip.style.visibility = 'hidden';
    tooltip.style.opacity = '1';
    tooltip.style.display = 'block';
    tooltip.style.position = 'absolute';
    
    // Wait a moment for content to render (especially images)
    setTimeout(() => {
        // Get tooltip dimensions after content is rendered
        const tooltipRect = tooltip.getBoundingClientRect();
        let tooltipWidth = tooltipRect.width;
        let tooltipHeight = tooltipRect.height;
        
        // Fallback if dimensions are still 0
        if (tooltipWidth === 0 || tooltipHeight === 0) {
            tooltipWidth = tooltip.offsetWidth || 200; // fallback width
            tooltipHeight = tooltip.offsetHeight || 100; // fallback height
        }
        
        // Reset tooltip visibility
        tooltip.style.visibility = originalVisibility;
        tooltip.style.opacity = originalOpacity;
        
        // Calculate desired position (default: below and centered)
        let left = (tileRect.width - tooltipWidth) / 2;
        let top = tileRect.height + 5; // 5px gap below tile
        
        // Check and adjust horizontal positioning
        const tooltipLeftEdge = tileRect.left + left;
        const tooltipRightEdge = tooltipLeftEdge + tooltipWidth;
        
        if (tooltipRightEdge > viewportWidth - 10) {
            // Tooltip would go off right edge - align to right edge of tile
            left = tileRect.width - tooltipWidth;
        }
        if (tooltipLeftEdge < 10) {
            // Tooltip would go off left edge - align to left edge of tile
            left = 0;
        }
        
        // Ensure tooltip doesn't go beyond left edge of tile or screen
        left = Math.max(0, Math.min(left, tileRect.width - Math.min(tooltipWidth, tileRect.width)));
        
        // Check and adjust vertical positioning
        const tooltipBottomEdge = tileRect.top + top + tooltipHeight;
        
        if (tooltipBottomEdge > viewportHeight - 10) {
            // Tooltip would go off bottom edge - position above tile instead
            top = -tooltipHeight - 5; // 5px gap above tile
            
            // Double-check if positioning above would go off top edge
            const tooltipTopEdge = tileRect.top + top;
            if (tooltipTopEdge < 10) {
                // If both above and below don't fit, position below but constrain height
                top = tileRect.height + 5;
                const availableHeight = viewportHeight - (tileRect.top + top) - 20;
                if (availableHeight < tooltipHeight && availableHeight > 50) {
                    tooltip.style.maxHeight = availableHeight + 'px';
                    tooltip.style.overflowY = 'auto';
                }
            }
        }
        
        // Apply positioning
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }, 0);
}

async function loadTooltipImage(tileRegion) {
    // Don't load tooltip images on mobile devices
    if (isMobile()) {
        return;
    }

    // Load flag data lazily for desktop tooltips
    const tileHash = tileRegion.dataset.tileHash;
    if (tileHash && window.flagSystem) {
        try {
            await window.flagSystem.ensureFlagDataLoaded(tileHash);
            window.flagSystem.updateFlagUI(tileHash);
        } catch (error) {
            console.warn('Failed to load flag data for tooltip:', error);
        }
    }

    const img = tileRegion.querySelector('.tooltip-image');
    if (img && img.dataset.src && !img.src) {
        console.log('Loading tooltip image for tile');
        img.src = img.dataset.src;
        img.style.display = 'block';
    }
    
    // Position tooltip smartly to avoid screen edges
    positionTooltipSmartly(tileRegion);
}

function handleTileClick(imagePath, isWebCompatible, tileElement, tileImageUrl, distanceInfo, dateInfo) {
    if (isMobile()) {
        showMobileModal(tileImageUrl, distanceInfo, dateInfo, tileElement);
    } else {
        openTileImage(imagePath, isWebCompatible);
    }
}

async function showMobileModal(imageUrl, distanceInfo, dateInfo, tileElement) {
    const modal = document.getElementById('mobile-modal');
    const modalImage = document.getElementById('modal-image');
    const modalInfo = document.getElementById('modal-info');
    setupModalEvents(modal); // Ensure modal events are set up

    if (!modal || !modalImage || !modalInfo) return;

    modalImage.src = imageUrl;

    // Get tile hash and path from the tile element
    const tileHash = tileElement ? tileElement.dataset.tileHash : '';
    const tilePath = tileElement ? tileElement.dataset.tilePath : '';
    window.currentMobileTileHash = tileHash;

    // Base content
    let content = distanceInfo + dateInfo;

    // Add flag UI for mobile with lazy loading
    if (tileHash && window.flagSystem) {
        // Show loading state initially
        content += `
            <div class="mobile-flag-container">
                <div class="flag-status" id="mobile-flag-status-${tileHash}">
                    <div style="color: #999; margin: 8px 0; font-size: 14px;">Loading flag status...</div>
                </div>
                <button class="flag-button mobile-flag-btn" id="mobile-flag-btn-${tileHash}"
                        onclick="window.flagSystem.toggleFlag('${tileHash}', '${tilePath}')"
                        style="margin-top: 12px; padding: 8px 16px; font-size: 14px;" disabled>
                    Loading...
                </button>
            </div>
        `;

        // Set initial content with loading state
        modalInfo.innerHTML = content;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Load flag data lazily and update UI
        try {
            await window.flagSystem.ensureFlagDataLoaded(tileHash);
            window.flagSystem.updateMobileFlagUI(tileHash);
        } catch (error) {
            console.warn('Failed to load flag data for mobile modal:', error);
            // Update UI to show error state or fallback
            const statusDiv = document.getElementById(`mobile-flag-status-${tileHash}`);
            const button = document.getElementById(`mobile-flag-btn-${tileHash}`);
            if (statusDiv) statusDiv.innerHTML = '';
            if (button) {
                button.textContent = '🚩 Flag for Review';
                button.disabled = false;
            }
        }
        return; // Early return since we've already set up the modal
    }

    modalInfo.innerHTML = content;
    modal.classList.add('active');

    // Prevent body scrolling when modal is open
    document.body.style.overflow = 'hidden';
}

function closeMobileModal() {
    const modal = document.getElementById('mobile-modal');
    if (modal) {
        modal.classList.remove('active');
        // Clear modal content to prevent memory leaks
        const modalImage = document.getElementById('modal-image');
        const modalInfo = document.getElementById('modal-info');
        if (modalImage) {
            modalImage.src = '';
        }
        if (modalInfo) {
            modalInfo.innerHTML = '';
        }

        // Clear global modal state
        window.currentMobileTileHash = null;
        window.currentMobileTilePath = null;

        // CRITICAL: Clean up passive:false modal event listeners immediately to prevent performance issues
        cleanupModalEvents(modal);


        document.body.style.overflow = '';
    }
}

// Modal event handlers - stored for proper cleanup
let modalEventHandlers = {
    click: null,
    touchstart: null,
    touchmove: null,
    touchend: null
};

// Close modal when clicking outside content
function setupModalEvents(modal) {
        // Clean up any existing event listeners first
        cleanupModalEvents(modal);

        // Handle click events for closing modal (desktop)
        modalEventHandlers.click = function(e) {
            if (e.target === modal) {
                closeMobileModal();
            }
        };
        modal.addEventListener('click', modalEventHandlers.click);

        modalEventHandlers.touchstart = function(e) {
            modalTouchStartTime = Date.now();
            touchStartTarget = e.target;
            if (e.target === modal) {
                e.stopPropagation();
                e.preventDefault(); // Prevent any touch handling on tiles below backdrop
            }
        };
        modal.addEventListener('touchstart', modalEventHandlers.touchstart, { passive: false});

        modalEventHandlers.touchmove = function(e) {
            if (e.target === modal) {
                e.stopPropagation();
                e.preventDefault(); // Prevent scrolling/panning on background
            }
        };
        modal.addEventListener('touchmove', modalEventHandlers.touchmove, { passive: false});

        modalEventHandlers.touchend = function(e) {
            // Always stop propagation to prevent tile interactions
            e.stopPropagation();
            if (e.target === modal) {
                e.preventDefault(); // Critical: prevent touch from reaching tiles
                // closeMobileModal(); // Tempting but has misterious performance problems
            }
        };
        modal.addEventListener('touchend', modalEventHandlers.touchend, { passive: false});
}

// Clean up modal event listeners for performance
function cleanupModalEvents(modal) {
        if (modalEventHandlers.click) {
            modal.removeEventListener('click', modalEventHandlers.click);
        }
        if (modalEventHandlers.touchstart) {
            modal.removeEventListener('touchstart', modalEventHandlers.touchstart);
        }
        if (modalEventHandlers.touchmove) {
            modal.removeEventListener('touchmove', modalEventHandlers.touchmove);
        }
        if (modalEventHandlers.touchend) {
            modal.removeEventListener('touchend', modalEventHandlers.touchend);
        }

        // Reset handlers
        modalEventHandlers = {
            click: null,
            touchstart: null,
            touchmove: null,
            touchend: null
        };

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

// Flag management system
class TileFlagSystem {
    constructor() {
        // API endpoint - will be set after deployment
        this.apiBase = 'https://lm86ri8yyk.execute-api.us-east-1.amazonaws.com/prod';
        this.flaggedTiles = new Map(); // tileHash -> cached flagData with TTL
        this.pendingRequests = new Map(); // Track in-flight requests
        this.rateLimiter = new RateLimiter();
        this.useLocalStorage = false; // Phase 2: use real API
        this.fallbackToLocalStorage = true; // Fallback if API fails
        this.CACHE_TTL = 10 * 1000; // 10 seconds TTL for real-time behavior

        // Check for localStorage migration but don't load all flags upfront
        this.handleInitialSetup();
    }

    async handleInitialSetup() {
        // Only check for localStorage migration, don't load all flags upfront
        if (!this.useLocalStorage) {
            try {
                // If API works, check for localStorage migration
                await this.migrateFromLocalStorageIfNeeded();
                return;
            } catch (error) {
                console.warn('API not available, falling back to localStorage:', error);
                if (this.fallbackToLocalStorage) {
                    this.useLocalStorage = true;
                    this.loadFromLocalStorage();
                }
            }
        } else {
            // Load from localStorage (fallback mode)
            this.loadFromLocalStorage();
        }
    }

    setCachedFlag(tileHash, flagData) {
        const now = Date.now();
        this.flaggedTiles.set(tileHash, {
            data: flagData,
            timestamp: now,
            expires: now + this.CACHE_TTL
        });
    }

    getCachedFlag(tileHash) {
        const entry = this.flaggedTiles.get(tileHash);
        if (!entry) return null;

        // Check if cache is still valid
        if (Date.now() >= entry.expires) {
            this.flaggedTiles.delete(tileHash);
            return null;
        }

        return entry.data;
    }

    isCacheValid(tileHash) {
        const entry = this.flaggedTiles.get(tileHash);
        if (!entry) return false;
        return Date.now() < entry.expires;
    }

    async ensureFlagDataLoaded(tileHash, forceRefresh = false) {
        // Return cached data if valid and not forcing refresh
        if (!forceRefresh) {
            const cachedData = this.getCachedFlag(tileHash);
            if (cachedData !== null) {
                return cachedData;
            }
        }

        // Return pending request if in flight
        if (this.pendingRequests.has(tileHash)) {
            return await this.pendingRequests.get(tileHash);
        }

        // Fetch individual tile flag
        const promise = this.fetchSingleFlag(tileHash);
        this.pendingRequests.set(tileHash, promise);

        try {
            const flagData = await promise;
            this.setCachedFlag(tileHash, flagData || null);
            return flagData;
        } finally {
            this.pendingRequests.delete(tileHash);
        }
    }

    async fetchSingleFlag(tileHash) {
        if (this.useLocalStorage) {
            // In localStorage mode, check what we have locally
            const entry = this.flaggedTiles.get(tileHash);
            return entry?.data || null;
        }

        try {
            // Use existing bulk API but with single tile
            const response = await fetch(`${this.apiBase}/tiles/flags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tileHashes: [tileHash] })
            });

            if (!response.ok) {
                console.warn(`Failed to fetch flag for ${tileHash}: ${response.status}`);
                return null;
            }

            const data = await response.json();
            return data.flags?.[tileHash] || null;
        } catch (error) {
            console.warn(`Error fetching flag for ${tileHash}:`, error);
            return null;
        }
    }


    loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem('mosaic-flags');
            if (stored) {
                const data = JSON.parse(stored);
                // Convert old format to TTL cache format
                Object.entries(data).forEach(([tileHash, flagData]) => {
                    this.setCachedFlag(tileHash, flagData);
                });
                console.log('Loaded', this.flaggedTiles.size, 'flags from localStorage');
            }
        } catch (error) {
            console.warn('Failed to load flags from localStorage:', error);
        }
    }

    saveToLocalStorage() {
        try {
            // Extract only the data part from TTL cache entries
            const data = {};
            this.flaggedTiles.forEach((cacheEntry, tileHash) => {
                if (cacheEntry.data && Date.now() < cacheEntry.expires) {
                    data[tileHash] = cacheEntry.data;
                }
            });
            localStorage.setItem('mosaic-flags', JSON.stringify(data));
        } catch (error) {
            console.warn('Failed to save flags to localStorage:', error);
        }
    }

    async migrateFromLocalStorageIfNeeded() {
        // Check if there are flags in localStorage to migrate
        const stored = localStorage.getItem('mosaic-flags');
        if (!stored) {
            // No flags to migrate, mark as attempted
            localStorage.setItem('mosaic-flags-migration-attempted', 'true');
            return;
        }

        try {
            const localFlags = JSON.parse(stored);
            const flagCount = Object.keys(localFlags).length;

            if (flagCount === 0) {
                return;
            }

            console.log(`Migrating ${flagCount} flags from localStorage to API...`);
            this.showToast(`Migrating ${flagCount} saved flags to server...`);

            let successCount = 0;
            let failCount = 0;
            const failures = new Map();

            // Migrate each flag to the API
            for (const [tileHash, flagData] of Object.entries(localFlags)) {
                try {
                    const response = await fetch(`${this.apiBase}/tiles/${tileHash}/flag`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            tilePath: flagData.tilePath || ''
                        })
                    });

                    if (response.ok) {
                        successCount++;
                        // Add to current flagged tiles
                        this.flaggedTiles.set(tileHash, {
                            tilePath: flagData.tilePath || '',
                            flaggedAt: flagData.flaggedAt || new Date().toISOString()
                        });
                    } else {
                        failCount++;
                        failures.set(tileHash, flagData);
                        console.warn(`Failed to migrate flag for tile ${tileHash}:`, response.status);
                    }
                } catch (error) {
                    failCount++;
                    console.warn(`Error migrating flag for tile ${tileHash}:`, error);
                }
            }


            if (successCount > 0) {
                if (failCount === 0) {
                    // Complete success - clear localStorage
                    localStorage.removeItem('mosaic-flags');
                    this.showToast(`✅ Successfully migrated ${successCount} flags to server`);
                    console.log(`Migration complete: ${successCount} flags successfully migrated`);
                } else {
                    localStorage.setItem('mosaic-flags', Object.fromEntries(failures));
                    // Partial success
                    this.showToast(`⚠️ Migrated ${successCount}/${flagCount} flags (${failCount} failed)`);
                    console.log(`Migration partial: ${successCount} succeeded, ${failCount} failed`);
                }

                // Update UI to show current flag states
                this.updateFlagButtons();
            } else {
                // Complete failure
                this.showToast(`❌ Failed to migrate flags to server (keeping local copy)`);
                console.log('Migration failed: no flags were successfully migrated');
            }

        } catch (error) {
            console.error('Error during localStorage migration:', error);
            this.showToast('⚠️ Flag migration failed (keeping local copy)');
        }
    }

    // Manual migration trigger (for testing or user-initiated migration)
    async forceMigration() {
        // Reset migration flag to allow re-migration
        localStorage.removeItem('mosaic-flags-migration-attempted');
        await this.migrateFromLocalStorageIfNeeded();
    }

    async toggleFlag(tileHash, tilePath) {
        const cachedFlag = this.getCachedFlag(tileHash);
        const isFlagged = cachedFlag !== null;

        if (!isFlagged) {
            // Flagging a tile
            if (!this.rateLimiter.canFlag()) {
                this.showToast('Rate limit reached. Please wait before flagging more tiles.');
                return;
            }

            let success = false;

            if (!this.useLocalStorage) {
                // Try API first
                success = await this.flagTileAPI(tileHash, tilePath);
            }

            if (success || this.useLocalStorage) {
                // Update local state immediately
                this.rateLimiter.consume();
                const flagData = {
                    tilePath: tilePath,
                    flaggedAt: new Date().toISOString(),
                    flaggedBy: 'anonymous'
                };
                this.setCachedFlag(tileHash, flagData);

                if (this.useLocalStorage) {
                    this.saveToLocalStorage();
                }

                this.showToast('Tile flagged for review');
            } else {
                this.showToast('Failed to flag tile. Please try again.');
                return;
            }
        } else {
            // Unflagging a tile
            let success = false;

            if (!this.useLocalStorage) {
                success = await this.unflagTileAPI(tileHash);
            }

            if (success || this.useLocalStorage) {
                // Remove from cache immediately
                this.flaggedTiles.delete(tileHash);

                if (this.useLocalStorage) {
                    this.saveToLocalStorage();
                }

                this.showToast('Flag removed');
            } else {
                this.showToast('Failed to remove flag. Please try again.');
                return;
            }
        }

        this.updateFlagUI(tileHash);
        this.updateMobileFlagUI(tileHash);
    }

    async flagTileAPI(tileHash, tilePath) {
        try {
            const response = await fetch(`${this.apiBase}/tiles/${tileHash}/flag`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tilePath })
            });

            if (response.status === 429) {
                this.showToast('Rate limit reached by server');
                return false;
            }

            return response.ok;
        } catch (error) {
            console.warn('API flag request failed:', error);
            return false;
        }
    }

    async unflagTileAPI(tileHash) {
        try {
            const response = await fetch(`${this.apiBase}/tiles/${tileHash}/flag`, {
                method: 'DELETE',
            });

            return response.ok;
        } catch (error) {
            console.warn('API unflag request failed:', error);
            return false;
        }
    }

    updateFlagUI(tileHash) {
        const cachedFlag = this.getCachedFlag(tileHash);
        const isFlagged = cachedFlag !== null;

        // Update desktop tooltip
        const flagStatus = document.getElementById(`flag-status-${tileHash}`);
        const flagButton = document.getElementById(`flag-btn-${tileHash}`);

        if (flagStatus) {
            flagStatus.innerHTML = isFlagged ?
                '<div style="color: #ff6b6b; font-size: 12px; margin: 4px 0;">⚠️ This image has been flagged</div>' : '';
        }

        if (flagButton) {
            flagButton.textContent = isFlagged ? '✓ Flagged' : '🚩 Flag for Review';
            flagButton.disabled = isFlagged;
            flagButton.style.background = isFlagged ? '#666' : '#ff6b6b';
            flagButton.style.cursor = isFlagged ? 'default' : 'pointer';
        }
    }

    updateMobileFlagUI(tileHash) {
        // Update mobile modal if it's currently showing this tile
        if (window.currentMobileTileHash === tileHash) {
            const cachedFlag = this.getCachedFlag(tileHash);
            const isFlagged = cachedFlag !== null;
            const modalInfo = document.getElementById('modal-info');

            if (modalInfo) {
                // Find existing flag UI or create it
                let flagContainer = modalInfo.querySelector('.mobile-flag-container');
                if (!flagContainer) {
                    flagContainer = document.createElement('div');
                    flagContainer.className = 'mobile-flag-container';
                    modalInfo.appendChild(flagContainer);
                }

                flagContainer.innerHTML = `
                    <div class="flag-status">${isFlagged ?
                        '<div style="color: #ff6b6b; margin: 8px 0;">⚠️ This image has been flagged</div>' : ''}</div>
                    <button class="flag-button mobile-flag-btn"
                            onclick="window.flagSystem.toggleFlag('${tileHash}', '${cachedFlag?.tilePath || ''}')">
                        ${isFlagged ? '✓ Flagged' : '🚩 Flag for Review'}
                    </button>
                `;
            }
        }
    }

    updateAllFlagUI() {
        // Update all visible flag UIs
        this.flaggedTiles.forEach((_, tileHash) => {
            this.updateFlagUI(tileHash);
        });
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            z-index: 10000;
            font-size: 14px;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

// Rate limiter for anonymous flagging (10 flags per minute)
class RateLimiter {
    constructor() {
        this.maxFlags = 10;
        this.windowMs = 60 * 1000; // 1 minute
        this.flags = [];
    }

    canFlag() {
        const now = Date.now();
        // Remove flags older than window
        this.flags = this.flags.filter(time => now - time < this.windowMs);
        return this.flags.length < this.maxFlags;
    }

    consume() {
        if (this.canFlag()) {
            this.flags.push(Date.now());
            return true;
        }
        return false;
    }

    getRemainingFlags() {
        const now = Date.now();
        this.flags = this.flags.filter(time => now - time < this.windowMs);
        return Math.max(0, this.maxFlags - this.flags.length);
    }
}

// Global toggle flag function
function toggleFlag(tileHash, tilePath) {
    if (window.flagSystem) {
        window.flagSystem.toggleFlag(tileHash, tilePath);
    } else {
        console.warn('Flag system not initialized');
    }
}

// Make functions globally accessible
window.toggleDistanceOverlay = toggleDistanceOverlay;
window.openTileImage = openTileImage;
window.adjustMosaicLayout = adjustMosaicLayout;
window.setupSmartTooltips = setupSmartTooltips;
window.repositionVisibleTooltips = repositionVisibleTooltips;
window.positionTooltipSmartly = positionTooltipSmartly;
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