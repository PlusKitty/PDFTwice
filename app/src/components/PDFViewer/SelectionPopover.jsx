import React from 'react';
import { Highlighter, MessageSquare } from 'lucide-react';

/**
 * SelectionPopover - Popup that appears after text selection
 * 
 * Shows buttons for:
 * - Highlight (yellow marker)
 * - Comment (add annotation)
 * 
 * Appears at the bottom-center of the selection
 */
const SelectionPopover = ({
    show,
    x,
    y,
    pageNum,
    highlightRect,
    highlightRects,
    selectedText,
    side,
    onHighlight,
    onComment,
    onClose,
}) => {
    if (!show) return null;

    const handleHighlight = (e) => {
        e.stopPropagation();
        onHighlight?.(side, x, y, highlightRects || [highlightRect], selectedText, pageNum);
        onClose?.();
        window.getSelection()?.removeAllRanges();
    };

    const handleComment = (e) => {
        e.stopPropagation();
        onComment?.(side, x, y, highlightRects || [highlightRect], selectedText, pageNum);
        onClose?.();
        window.getSelection()?.removeAllRanges();
    };

    return (
        <div
            className="absolute bg-white border border-gray-200 shadow-xl rounded-none z-50 flex overflow-hidden transform -translate-x-1/2 mt-1"
            style={{
                left: `${x}%`,
                top: `${y}%`,
            }}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <button
                className="px-3 py-1.5 hover:bg-yellow-50 text-yellow-700 transition-colors border-r border-gray-100 flex items-center justify-center"
                onClick={handleHighlight}
                title="Highlight"
            >
                <Highlighter className="w-4 h-4" />
            </button>
            <button
                className="px-3 py-1.5 hover:bg-blue-50 text-blue-600 text-xs font-medium flex items-center gap-1.5 transition-colors"
                onClick={handleComment}
                title="Add comment"
            >
                <MessageSquare className="w-3.5 h-3.5" />
                Comment
            </button>
        </div>
    );
};

export default SelectionPopover;
