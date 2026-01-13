import { useState, useCallback, useEffect } from 'react';

/**
 * useTextSelection - Hook for handling text selection in PDF pages
 * 
 * Provides:
 * - Selection state tracking (show, position, rects, text)
 * - Mouse up handler for capturing selection
 * - Rectangle merging for multi-line selections
 * - Selection change listener for auto-hide
 * 
 * @param {Object} options
 * @param {boolean} options.enabled - Whether selection is enabled
 */
function useTextSelection(options = {}) {
    const { enabled = true } = options;

    const [selectionState, setSelectionState] = useState({
        show: false,
        x: 0,
        y: 0,
        page: null,
        highlightRect: null,
        highlightRects: null,
        selectedText: '',
    });

    // Clear selection state
    const clearSelection = useCallback(() => {
        setSelectionState({
            show: false,
            x: 0,
            y: 0,
            page: null,
            highlightRect: null,
            highlightRects: null,
            selectedText: '',
        });
    }, []);

    // Merge adjacent rectangles (for multi-line selections)
    const mergeRects = useCallback((rects, containerRect) => {
        if (!rects || rects.length <= 1) return rects;

        // Sort by top then left
        const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
        const lineGroups = [];
        let currentLine = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];

            // Group by Y (lines) with a small threshold
            const verticalOverlap = Math.abs(curr.top - prev.top) < (prev.height * 0.4);

            if (verticalOverlap) {
                currentLine.push(curr);
            } else {
                lineGroups.push(currentLine);
                currentLine = [curr];
            }
        }
        lineGroups.push(currentLine);

        const merged = [];
        for (const line of lineGroups) {
            line.sort((a, b) => a.left - b.left);
            let active = { ...line[0] };

            for (let i = 1; i < line.length; i++) {
                const curr = line[i];

                // Calculate a dynamic threshold based on the line height
                const aspectRatio = containerRect
                    ? containerRect.height / containerRect.width
                    : 1;
                const threshold = (active.height * aspectRatio) * 1.5;

                // Merge if they overlap or are close horizontally
                if (curr.left <= active.right + threshold) {
                    active.right = Math.max(active.right, curr.right);
                    active.width = active.right - active.left;
                    active.top = Math.min(active.top, curr.top);
                    active.bottom = Math.max(active.bottom, curr.bottom);
                    active.height = active.bottom - active.top;
                } else {
                    merged.push(active);
                    active = { ...curr };
                }
            }
            merged.push(active);
        }
        return merged;
    }, []);

    // Calculate percentage-based rectangle from DOM rect
    const calculatePercentRect = useCallback((domRect, containerRect) => {
        return {
            left: ((domRect.left - containerRect.left) / containerRect.width) * 100,
            top: ((domRect.top - containerRect.top) / containerRect.height) * 100,
            right: ((domRect.right - containerRect.left) / containerRect.width) * 100,
            bottom: ((domRect.bottom - containerRect.top) / containerRect.height) * 100,
            width: (domRect.width / containerRect.width) * 100,
            height: (domRect.height / containerRect.height) * 100,
        };
    }, []);

    // Process selection and update state
    const processSelection = useCallback((pageContainer, pageNum) => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return null;
        }

        const range = selection.getRangeAt(0);
        let targetContainer = range.commonAncestorContainer;
        if (targetContainer.nodeType === 3) targetContainer = targetContainer.parentNode;

        // Verify selection is within the page container
        if (!pageContainer || !pageContainer.contains(targetContainer)) {
            return null;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = pageContainer.getBoundingClientRect();

        // Calculate anchor position (center-bottom of selection)
        const anchorX = ((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100;
        const anchorY = ((rect.bottom - containerRect.top) / containerRect.height) * 100;

        // Calculate highlight rectangle
        const highlightRect = calculatePercentRect(rect, containerRect);

        // Get all client rects for multi-line selections
        const clientRects = range.getClientRects();
        const rawRects = Array.from(clientRects).map(r => calculatePercentRect(r, containerRect));
        const highlightRects = mergeRects(rawRects, containerRect);

        const result = {
            show: true,
            x: anchorX,
            y: anchorY,
            page: pageNum,
            highlightRect,
            highlightRects,
            selectedText: selection.toString(),
        };

        setSelectionState(result);
        return result;
    }, [calculatePercentRect, mergeRects]);

    // Create mouse up handler for a specific page container
    const createMouseUpHandler = useCallback((getPageContainer, getPageNum) => {
        return () => {
            if (!enabled) return;

            const pageContainer = typeof getPageContainer === 'function'
                ? getPageContainer()
                : getPageContainer;
            const pageNum = typeof getPageNum === 'function'
                ? getPageNum()
                : getPageNum;

            processSelection(pageContainer, pageNum);
        };
    }, [enabled, processSelection]);

    // Listen for selection changes to auto-hide popover
    useEffect(() => {
        if (!enabled) return;

        const handleSelectionChange = () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                clearSelection();
            }
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    }, [enabled, clearSelection]);

    // Clear browser selection
    const clearBrowserSelection = useCallback(() => {
        window.getSelection()?.removeAllRanges();
        clearSelection();
    }, [clearSelection]);

    return {
        // State
        selectionState,
        isSelecting: selectionState.show,

        // Actions
        clearSelection,
        clearBrowserSelection,
        processSelection,

        // Handlers
        createMouseUpHandler,

        // Utilities
        mergeRects,
        calculatePercentRect,
    };
}

export default useTextSelection;
