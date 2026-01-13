/**
 * scrollUtils - Utility functions for scroll position and visibility detection
 * 
 * Inspired by PDF.js ui_utils.js patterns for efficient page visibility detection.
 */

/**
 * Binary search to find the first visible element in a list
 * O(log n) instead of linear iteration for large documents
 * 
 * @param {Array} items - Array of items with getBoundingClientRect() support
 * @param {Function} isAboveViewport - Function that returns true if item is above viewport
 * @returns {number} Index of first visible item, or items.length if none found
 */
export function binarySearchFirstVisible(items, isAboveViewport) {
    let low = 0;
    let high = items.length;

    while (low < high) {
        const mid = (low + high) >> 1;
        if (isAboveViewport(items[mid])) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
}

/**
 * Get visible elements within a scrollable container
 * 
 * @param {Object} options
 * @param {HTMLElement} options.scrollEl - The scrollable container element
 * @param {Array<HTMLElement>} options.views - Array of page elements (1-indexed in refs)
 * @param {boolean} options.sortByVisibility - Whether to sort results by visibility percentage
 * @returns {Object} { first, last, views: [{ id, percent, element }], ids: Set }
 */
export function getVisibleElements({ scrollEl, views, sortByVisibility = false }) {
    const viewerRect = scrollEl.getBoundingClientRect();
    const visibleViews = [];
    const visibleIds = new Set();

    let firstVisibleIndex = -1;
    let lastVisibleIndex = -1;

    for (let i = 0; i < views.length; i++) {
        const element = views[i];
        if (!element) continue;

        const rect = element.getBoundingClientRect();

        // Check if element is within viewport
        const isVisible = rect.bottom > viewerRect.top && rect.top < viewerRect.bottom;

        if (isVisible) {
            if (firstVisibleIndex === -1) firstVisibleIndex = i;
            lastVisibleIndex = i;

            // Calculate visibility percentage
            const visibleTop = Math.max(rect.top, viewerRect.top);
            const visibleBottom = Math.min(rect.bottom, viewerRect.bottom);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            const percent = rect.height > 0 ? visibleHeight / rect.height : 0;

            visibleViews.push({
                id: i + 1, // Page numbers are 1-indexed
                percent,
                element
            });
            visibleIds.add(i + 1);
        }
    }

    if (sortByVisibility) {
        visibleViews.sort((a, b) => b.percent - a.percent);
    }

    return {
        first: firstVisibleIndex >= 0 ? firstVisibleIndex + 1 : null,
        last: lastVisibleIndex >= 0 ? lastVisibleIndex + 1 : null,
        views: visibleViews,
        ids: visibleIds
    };
}

/**
 * Calculate global scroll position as (page - 1) + percent
 * 
 * @param {Object} options
 * @param {HTMLElement} options.viewerEl - The scrollable viewer container
 * @param {Object} options.pageRefs - Object mapping page numbers to page elements
 * @param {number} options.numPages - Total number of pages
 * @param {number} options.currentPage - Current page number (fallback)
 * @returns {number} Global scroll position (e.g., 2.5 = halfway through page 3)
 */
export function getGlobalScrollPosition({ viewerEl, pageRefs, numPages, currentPage }) {
    if (!viewerEl) return currentPage - 1;

    const viewerRect = viewerEl.getBoundingClientRect();

    let activePage = currentPage;
    let pagePercent = 0;
    let found = false;

    // Find first page visible at top of viewport
    for (let i = 1; i <= numPages; i++) {
        const el = pageRefs[i];
        if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.bottom > viewerRect.top + 1) {
                activePage = i;

                if (rect.top <= viewerRect.top) {
                    const offset = viewerRect.top - rect.top;
                    pagePercent = rect.height > 0 ? offset / rect.height : 0;
                }
                found = true;
                break;
            }
        }
    }

    // Handle edge case: scrolled to very bottom
    if (!found && numPages > 0) {
        if (viewerEl.scrollTop + viewerEl.clientHeight >= viewerEl.scrollHeight - 5) {
            activePage = numPages;
            pagePercent = 1;
        }
    }

    return (activePage - 1) + pagePercent;
}

/**
 * Scroll to a specific page and position within that page
 * 
 * @param {Object} options
 * @param {HTMLElement} options.viewerEl - The scrollable viewer container
 * @param {HTMLElement} options.pageEl - The target page element
 * @param {number} options.verticalPercent - Percentage down the page (0-1)
 * @param {number} options.horizontalPercent - Percentage across the page (0-1)
 */
export function scrollToPagePosition({ viewerEl, pageEl, verticalPercent = 0, horizontalPercent = 0 }) {
    if (!viewerEl || !pageEl) return;

    const viewerRect = viewerEl.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();

    // Calculate absolute top position
    const top = pageRect.top - viewerRect.top + viewerEl.scrollTop;
    const targetScrollTop = top + (pageEl.clientHeight * verticalPercent);

    viewerEl.scrollTop = targetScrollTop;

    // Horizontal scroll
    const maxScrollLeft = viewerEl.scrollWidth - viewerEl.clientWidth;
    if (maxScrollLeft > 0) {
        viewerEl.scrollLeft = maxScrollLeft * horizontalPercent;
    }
}

/**
 * Create a debounced scroll handler with direction tracking
 * 
 * @param {Function} callback - Called with scroll info { scrollTop, scrollLeft, direction }
 * @param {number} delay - Debounce delay in ms
 * @returns {Function} Debounced scroll handler
 */
export function createScrollHandler(callback) {
    let lastScrollTop = 0;
    let lastScrollLeft = 0;
    let rafId = null;

    return function handleScroll(event) {
        if (rafId) return;

        rafId = requestAnimationFrame(() => {
            const target = event.target;
            const scrollTop = target.scrollTop;
            const scrollLeft = target.scrollLeft;

            const direction = {
                down: scrollTop > lastScrollTop,
                right: scrollLeft > lastScrollLeft
            };

            lastScrollTop = scrollTop;
            lastScrollLeft = scrollLeft;
            rafId = null;

            callback({
                scrollTop,
                scrollLeft,
                scrollHeight: target.scrollHeight,
                scrollWidth: target.scrollWidth,
                clientHeight: target.clientHeight,
                clientWidth: target.clientWidth,
                direction
            });
        });
    };
}

export default {
    binarySearchFirstVisible,
    getVisibleElements,
    getGlobalScrollPosition,
    scrollToPagePosition,
    createScrollHandler
};
