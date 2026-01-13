import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';

/**
 * ZoomControls - Zoom buttons and input
 * 
 * Features:
 * - Zoom in/out buttons
 * - Zoom percentage input
 * - Fit to page button
 * - Reset zoom button
 */
const ZoomControls = ({
    scale,
    setScale,
    zoomInputValue,
    setZoomInputValue,
    onZoomBlur,
    onZoomKeyDown,
    onFitToPage,
}) => {
    return (
        <div className="flex items-center">
            {/* Zoom out */}
            <button
                onClick={() => setScale(Math.max(0.5, scale - 0.25))}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200"
                title="Zoom out"
            >
                <ZoomOut className="w-4 h-4" />
            </button>

            {/* Zoom input */}
            <div className="flex items-center gap-0.5 mx-0">
                <input
                    type="text"
                    value={zoomInputValue}
                    onChange={(e) => setZoomInputValue(e.target.value)}
                    onBlur={onZoomBlur}
                    onKeyDown={onZoomKeyDown}
                    className="w-8 text-center text-xs bg-gray-200/50 border-none rounded-none p-0 h-[22px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-500 font-medium">%</span>
            </div>

            {/* Zoom in */}
            <button
                onClick={() => setScale(Math.min(3, scale + 0.25))}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200"
                title="Zoom in"
            >
                <ZoomIn className="w-4 h-4" />
            </button>

            {/* Divider */}
            <div className="w-6 h-[22px] flex items-center justify-center">
                <div className="w-px h-3.5 bg-gray-300" />
            </div>

            {/* Fit to page */}
            <button
                onClick={() => onFitToPage?.(false)}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 text-gray-500 hover:text-blue-600"
                title="Fit to page"
            >
                <Maximize2 className="w-4 h-4" />
            </button>

            {/* Reset zoom */}
            <button
                onClick={() => setScale(1.0)}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 text-gray-500 hover:text-blue-600"
                title="Reset zoom to 100%"
            >
                <RotateCcw className="w-4 h-4" />
            </button>
        </div>
    );
};

export default ZoomControls;
