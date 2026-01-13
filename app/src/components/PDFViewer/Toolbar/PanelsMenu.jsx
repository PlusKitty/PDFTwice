import React from 'react';
import { Bookmark, MessageSquare } from 'lucide-react';

/**
 * PanelsMenu - Dropdown to toggle side panels
 * 
 * Features:
 * - Toggle bookmarks panel
 * - Toggle annotations panel
 * - Checkmarks for active panels
 */
const PanelsMenu = ({
    show,
    onClose,
    showBookmarks,
    setShowBookmarks,
    showAnnotations,
    setShowAnnotations,
}) => {
    if (!show) return null;

    return (
        <>
            {/* Overlay to close on click outside */}
            <div
                className="fixed inset-0 z-[105]"
                onClick={onClose}
            />
            <div
                className="absolute top-full right-0 bg-white border border-gray-300 rounded-none z-[110] animate-in fade-in slide-in-from-top-1 duration-200"
                style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' }}
            >
                <button
                    onClick={() => {
                        setShowBookmarks(!showBookmarks);
                        onClose?.();
                    }}
                    className="w-full text-left px-2 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
                >
                    <span className="w-4">{showBookmarks ? '✓' : ''}</span>
                    <Bookmark className="w-3.5 h-3.5" />
                    Bookmarks
                </button>
                <button
                    onClick={() => {
                        setShowAnnotations(!showAnnotations);
                        onClose?.();
                    }}
                    className="w-full text-left px-2 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
                >
                    <span className="w-4">{showAnnotations ? '✓' : ''}</span>
                    <MessageSquare className="w-3.5 h-3.5" />
                    Annotations
                </button>
            </div>
        </>
    );
};

export default PanelsMenu;
