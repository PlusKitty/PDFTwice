import React from 'react';
import { Lock, Unlock, Download, X, AlertTriangle } from 'lucide-react';

/**
 * UtilityButtons - Action buttons for sync, export, close
 * 
 * Features:
 * - Sync scroll toggle (left panel only)
 * - Export button with dirty indicator
 * - Close button
 */
const UtilityButtons = ({
    side,
    syncScroll,
    setSyncScroll,
    hasComments,
    hasBookmarks,
    isDirty,
    onExport,
    onClose,
}) => {
    return (
        <>
            {/* Sync scroll toggle - left side only */}
            {side === 'left' && setSyncScroll && (
                <button
                    onClick={() => setSyncScroll(!syncScroll)}
                    className={`h-[22px] w-[24px] flex items-center justify-center p-0 rounded-none transition-colors ${syncScroll
                            ? 'bg-green-500 text-white hover:bg-green-600'
                            : 'bg-transparent text-gray-600 hover:bg-gray-200'
                        }`}
                    title={syncScroll ? "Sync view (on)" : "Sync view (off)"}
                >
                    {syncScroll ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </button>
            )}

            {/* Export button */}
            <button
                onClick={onExport}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 rounded-none bg-purple-500 text-white hover:bg-purple-600 transition-colors relative"
                title={`Export PDF${hasComments ? ' with comments' : ''}${hasBookmarks ? ' with bookmarks' : ''}${isDirty ? ' (has changes)' : ''}`}
            >
                <Download className="w-4 h-4" />
                {isDirty && (
                    <div
                        className="absolute -top-1 -right-1 bg-yellow-400 text-black rounded-full border border-[0.5px] border-white p-[1px]"
                        title="Unsaved manual changes"
                    >
                        <AlertTriangle className="w-2 h-2" />
                    </div>
                )}
            </button>

            {/* Close button */}
            <button
                onClick={onClose}
                className="h-[22px] w-[24px] flex items-center justify-center p-0 hover:bg-red-100 rounded-none text-gray-400 hover:text-red-500 transition-colors"
                title="Close"
            >
                <X className="w-4 h-4" />
            </button>
        </>
    );
};

export default UtilityButtons;
