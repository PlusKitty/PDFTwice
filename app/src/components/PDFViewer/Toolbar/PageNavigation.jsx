import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * PageNavigation - Page navigation controls
 * 
 * Features:
 * - Previous/Next page buttons
 * - Page number input
 * - Total pages display
 */
const PageNavigation = ({
    page,
    setPage,
    numPages,
    pageInputValue,
    setPageInputValue,
    onPageBlur,
    onPageKeyDown,
    viewMode,
    scrollToPage,
}) => {
    const handlePrev = () => {
        const prev = Math.max(1, page - 1);
        if (viewMode === 'continuous') scrollToPage?.(prev);
        setPage(prev);
    };

    const handleNext = () => {
        const next = Math.min(numPages, page + 1);
        if (viewMode === 'continuous') scrollToPage?.(next);
        setPage(next);
    };

    return (
        <div className="flex items-center">
            {/* Previous page */}
            <button
                onClick={handlePrev}
                disabled={page <= 1}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 disabled:opacity-50"
                title="Previous page"
            >
                <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Page input */}
            <div className="flex items-center gap-0.5 mx-0">
                <input
                    type="text"
                    value={pageInputValue}
                    onChange={(e) => setPageInputValue(e.target.value)}
                    onBlur={onPageBlur}
                    onKeyDown={onPageKeyDown}
                    className="text-center text-xs bg-gray-200/50 border-none rounded-none p-0 h-[22px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    style={{ width: `${Math.max(2, numPages.toString().length) + 1}ch` }}
                />
            </div>

            {/* Separator and total */}
            <span className="text-xs text-gray-500 px-0.5">/</span>
            <span className="text-xs text-gray-500">{numPages}</span>

            {/* Next page */}
            <button
                onClick={handleNext}
                disabled={page >= numPages}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 disabled:opacity-50"
                title="Next page"
            >
                <ChevronRight className="w-4 h-4" />
            </button>
        </div>
    );
};

export default PageNavigation;
