import { useState, useCallback, useEffect } from 'react';

/**
 * useZoom - Hook for managing zoom/scale state and handlers
 * 
 * Provides:
 * - Scale state with min/max clamping
 * - Zoom in/out functions
 * - Fit-to-page calculation
 * - Wheel zoom handler (Ctrl+scroll)
 * - Input value tracking for zoom input fields
 * 
 * @param {Object} options
 * @param {number} options.initialScale - Starting scale (default: 1.0)
 * @param {number} options.minScale - Minimum allowed scale (default: 0.25)
 * @param {number} options.maxScale - Maximum allowed scale (default: 3.0)
 * @param {number} options.step - Zoom step size (default: 0.1)
 * @param {Function} options.onScaleChange - Callback when scale changes
 */
function useZoom(options = {}) {
    const {
        initialScale = 1.0,
        minScale = 0.25,
        maxScale = 3.0,
        step = 0.1,
        onScaleChange = null,
    } = options;

    const [scale, setScaleInternal] = useState(initialScale);
    const [inputValue, setInputValue] = useState(Math.round(initialScale * 100).toString());

    // Clamp and set scale
    const setScale = useCallback((newScaleOrFn) => {
        setScaleInternal(prev => {
            const newScale = typeof newScaleOrFn === 'function'
                ? newScaleOrFn(prev)
                : newScaleOrFn;
            const clamped = Math.min(Math.max(minScale, newScale), maxScale);

            if (onScaleChange && clamped !== prev) {
                onScaleChange(clamped, prev);
            }

            return clamped;
        });
    }, [minScale, maxScale, onScaleChange]);

    // Sync input value with scale
    useEffect(() => {
        setInputValue(Math.round(scale * 100).toString());
    }, [scale]);

    // Zoom in by step
    const zoomIn = useCallback(() => {
        setScale(prev => prev + step);
    }, [setScale, step]);

    // Zoom out by step
    const zoomOut = useCallback(() => {
        setScale(prev => prev - step);
    }, [setScale, step]);

    // Reset to initial scale
    const resetZoom = useCallback(() => {
        setScale(initialScale);
    }, [setScale, initialScale]);

    // Handle zoom input blur (commit value)
    const handleInputBlur = useCallback(() => {
        const val = parseInt(inputValue);
        if (isNaN(val) || val < minScale * 100 || val > maxScale * 100) {
            setInputValue(Math.round(scale * 100).toString());
        } else {
            setScale(val / 100);
        }
    }, [inputValue, scale, minScale, maxScale, setScale]);

    // Handle zoom input keydown
    const handleInputKeyDown = useCallback((e) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            setInputValue(Math.round(scale * 100).toString());
            e.currentTarget.blur();
        }
    }, [scale]);

    // Calculate fit-to-page scale
    const calculateFitScale = useCallback(async (pdfDoc, pageNum, containerElement) => {
        if (!pdfDoc || !containerElement) return null;

        try {
            const pageObj = await pdfDoc.getPage(pageNum);
            const viewport = pageObj.getViewport({ scale: 1.0 });

            const buffer = 4; // Safety buffer
            const availableWidth = containerElement.clientWidth - buffer;
            const availableHeight = containerElement.clientHeight - buffer;

            const horizontalScale = availableWidth / viewport.width;
            const verticalScale = availableHeight / viewport.height;

            return Math.min(horizontalScale, verticalScale);
        } catch (e) {
            console.error('Failed to calculate fit scale:', e);
            return null;
        }
    }, []);

    // Apply fit-to-page
    const fitToPage = useCallback(async (pdfDoc, pageNum, containerElement) => {
        const fitScale = await calculateFitScale(pdfDoc, pageNum, containerElement);
        if (fitScale !== null) {
            setScale(fitScale);
        }
        return fitScale;
    }, [calculateFitScale, setScale]);

    // Create wheel handler for Ctrl+scroll zoom
    const createWheelHandler = useCallback((viewerElement) => {
        if (!viewerElement) return () => { };

        const handleWheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY;
                const direction = delta > 0 ? -1 : 1;
                setScale(prev => prev + (direction * step));
            }
        };

        viewerElement.addEventListener('wheel', handleWheel, { passive: false });
        return () => viewerElement.removeEventListener('wheel', handleWheel);
    }, [setScale, step]);

    return {
        // State
        scale,
        inputValue,

        // Setters
        setScale,
        setInputValue,

        // Actions
        zoomIn,
        zoomOut,
        resetZoom,
        fitToPage,
        calculateFitScale,

        // Handlers
        handleInputBlur,
        handleInputKeyDown,
        createWheelHandler,

        // Config
        minScale,
        maxScale,
        step,
    };
}

export default useZoom;
