import React, { useState } from 'react';
import { Github, ChevronDown, ChevronRight } from 'lucide-react';
// Note: Using window.__TAURI__.core.invoke() directly for external links

/**
 * SettingsMenu - Dropdown for view mode, author settings, and export options
 * 
 * Features:
 * - View mode toggle (PAGE / FULL)
 * - Author name input for annotations
 * - Export settings (Tauri only): auto-save, prefix/suffix
 * - Advanced settings (collapsible): Alt text fallback mode, show indicator
 * - Attribution links
 */
const SettingsMenu = ({
    show,
    onClose,
    viewMode,
    setViewMode,
    tempAuthorName,
    setTempAuthorName,
    onSaveAuthor,
    exportSettings,
    setExportSettings,
    isTauri = false,
    onLinkHover,
    scaleMode,
    setScaleMode,
    defaultScaleLevel,
    setDefaultScaleLevel,
    altTextSettings,
    setAltTextSettings,
}) => {
    const [showLevelInput, setShowLevelInput] = useState(false);
    const [tempLevel, setTempLevel] = useState(defaultScaleLevel?.toString() || '100');
    const [advancedExpanded, setAdvancedExpanded] = useState(false);

    if (!show) return null;

    return (
        <>
            {/* Overlay to close on click outside */}
            <div
                className="fixed inset-0 z-[105]"
                onClick={onClose}
            />
            <div
                className="absolute top-full right-0 bg-white border border-gray-300 rounded-none z-[110] min-w-[200px] animate-in fade-in slide-in-from-top-1 duration-200"
                style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' }}
            >
                {/* View mode toggle */}
                {setViewMode && (
                    <div className="p-1.5">
                        <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-tight">View</div>
                        <div className="flex border border-gray-200 bg-gray-50 p-0 mb-3">
                            <button
                                onClick={() => setViewMode('single')}
                                className={`flex-1 text-[10px] py-1.5 transition-colors ${viewMode === 'single' ? 'bg-gray-800 text-white font-bold' : 'text-gray-500 hover:bg-gray-200'}`}
                                title="See one page at a time (recommended)"
                            >
                                PAGE
                            </button>
                            <button
                                onClick={() => setViewMode('continuous')}
                                className={`flex-1 text-[10px] py-1.5 transition-colors ${viewMode === 'continuous' ? 'bg-gray-800 text-white font-bold' : 'text-gray-500 hover:bg-gray-200'}`}
                                title="Load all pages to scroll through them"
                            >
                                FULL
                            </button>
                        </div>

                        {/* Scale Settings */}
                        {setScaleMode && (
                            <>
                                <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-tight">Scale</div>
                                <div className="relative">
                                    <div className="flex border border-gray-200 bg-gray-50 p-0">
                                        <button
                                            onClick={() => {
                                                setScaleMode('fit');
                                                setShowLevelInput(false);
                                            }}
                                            className={`flex-1 text-[10px] py-1.5 transition-colors ${scaleMode === 'fit' ? 'bg-gray-800 text-white font-bold' : 'text-gray-500 hover:bg-gray-200'}`}
                                            title="Fit to page by default (recommended)"
                                        >
                                            FIT
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (scaleMode !== 'level') {
                                                    setScaleMode('level');
                                                    setShowLevelInput(true);
                                                } else {
                                                    setShowLevelInput(!showLevelInput);
                                                }
                                            }}
                                            className={`flex-1 text-[10px] py-1.5 transition-colors ${scaleMode === 'level' ? 'bg-gray-800 text-white font-bold' : 'text-gray-500 hover:bg-gray-200'}`}
                                            title="Set default zoom level"
                                        >
                                            LEVEL
                                        </button>
                                    </div>

                                    {/* Level Input Popover */}
                                    {showLevelInput && (
                                        <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white border border-gray-200 shadow-md p-1.5 animate-in fade-in slide-in-from-top-1">
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number"
                                                    value={tempLevel}
                                                    onChange={(e) => setTempLevel(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            let val = parseInt(tempLevel, 10);
                                                            if (!isNaN(val)) {
                                                                // Clamp between 20% and 300%
                                                                const clampedVal = Math.max(20, Math.min(val, 300));
                                                                setDefaultScaleLevel(clampedVal);
                                                                setTempLevel(clampedVal.toString()); // Update displayed value
                                                                setShowLevelInput(false);
                                                            }
                                                        } else if (e.key === 'Escape') {
                                                            setShowLevelInput(false);
                                                            setTempLevel(defaultScaleLevel.toString());
                                                        }
                                                    }}
                                                    className="flex-1 text-xs border border-gray-200 px-1.5 py-1 bg-gray-50 focus:outline-none focus:border-gray-400"
                                                    placeholder="100"
                                                    autoFocus
                                                />
                                                <span className="text-[10px] text-gray-500">%</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Author name input */}
                <div className="p-1.5">
                    <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-tight">Annotator</div>
                    <input
                        type="text"
                        placeholder="Enter name..."
                        value={tempAuthorName}
                        onChange={(e) => setTempAuthorName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onSaveAuthor?.(tempAuthorName);
                                onClose?.();
                            } else if (e.key === 'Escape') {
                                onClose?.();
                            }
                        }}
                        className="w-full text-xs border border-gray-200 rounded-none px-2 py-1.5 focus:outline-none focus:border-gray-400 font-normal bg-gray-50"
                    />
                </div>

                {/* Export Settings (Tauri only) */}
                {isTauri && exportSettings && setExportSettings && (
                    <div className="p-1.5 border-t border-gray-200">
                        <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-tight">Export</div>

                        {/* Auto-save toggle */}
                        <label className="flex items-center gap-2 text-[11px] mb-2 cursor-pointer text-gray-600">
                            <input
                                type="checkbox"
                                checked={exportSettings.autoSaveToSource}
                                onChange={(e) => setExportSettings(prev => ({
                                    ...prev, autoSaveToSource: e.target.checked
                                }))}
                                className="w-3.5 h-3.5"
                            />
                            Save to source folder
                        </label>

                        {/* Prefix input */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-[10px] text-gray-500 w-10">Prefix</span>
                            <input
                                type="text"
                                value={exportSettings.filenamePrefix}
                                onChange={(e) => setExportSettings(prev => ({
                                    ...prev, filenamePrefix: e.target.value
                                }))}
                                placeholder="FINAL_"
                                className="flex-1 text-xs border border-gray-200 px-1.5 py-1 bg-gray-50 focus:outline-none focus:border-gray-400"
                            />
                        </div>

                        {/* Suffix input */}
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-500 w-10">Suffix</span>
                            <input
                                type="text"
                                value={exportSettings.filenameSuffix}
                                onChange={(e) => setExportSettings(prev => ({
                                    ...prev, filenameSuffix: e.target.value
                                }))}
                                placeholder="_commented"
                                className="flex-1 text-xs border border-gray-200 px-1.5 py-1 bg-gray-50 focus:outline-none focus:border-gray-400"
                            />
                        </div>
                    </div>
                )}

                {/* Advanced Settings (Collapsible) */}
                <div className="border-t border-gray-200">
                    <button
                        onClick={() => setAdvancedExpanded(!advancedExpanded)}
                        className="w-full p-1.5 flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-tight hover:bg-gray-50 transition-colors"
                    >
                        <span>Advanced</span>
                        {advancedExpanded ? (
                            <ChevronDown className="w-3 h-3" />
                        ) : (
                            <ChevronRight className="w-3 h-3" />
                        )}
                    </button>

                    {advancedExpanded && altTextSettings && setAltTextSettings && (
                        <div className="px-1.5 pb-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                            {/* Alt Text Section */}
                            <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-tight">Alt Text</div>

                            {/* Show ALT Indicator Checkbox */}
                            <label className="flex items-center gap-2 text-[11px] mb-3 cursor-pointer text-gray-600">
                                <input
                                    type="checkbox"
                                    checked={altTextSettings.showIndicator}
                                    onChange={(e) => setAltTextSettings(prev => ({
                                        ...prev, showIndicator: e.target.checked
                                    }))}
                                    className="w-3.5 h-3.5"
                                />
                                Show ALT indicator
                            </label>

                            {/* Fallback Mode Subsection */}
                            <div className="text-[9px] text-gray-500 mb-1.5 font-medium">Fallback (experimental)</div>
                            <div className="flex border border-gray-200 bg-gray-50 p-0">
                                <button
                                    onClick={() => setAltTextSettings(prev => ({
                                        ...prev, fallbackMode: 'spatial'
                                    }))}
                                    className={`flex-1 text-[10px] py-1.5 transition-colors ${altTextSettings.fallbackMode === 'spatial' ? 'bg-gray-800 text-white font-bold' : 'text-gray-500 hover:bg-gray-200'}`}
                                    title="For PDFs without precise image data, assign alt text based on the author intended visual reading order (recommended)"
                                >
                                    SPATIAL
                                </button>
                                <button
                                    onClick={() => setAltTextSettings(prev => ({
                                        ...prev, fallbackMode: 'draw'
                                    }))}
                                    className={`flex-1 text-[10px] py-1.5 transition-colors ${altTextSettings.fallbackMode === 'draw' ? 'bg-gray-800 text-white font-bold' : 'text-gray-500 hover:bg-gray-200'}`}
                                    title="Assign alt text in strict logical sequence (try if SPATIAL seems incorrect)"
                                >
                                    DRAW
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Attribution */}
                <div className="px-1.5 py-2 mt-1 border-t border-gray-100">
                    <div className="text-[9px] text-gray-400 font-normal">
                        <a
                            href="https://github.com/PlusKits/Twice-PDF"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-gray-600 transition-colors inline-flex items-center gap-1"
                            title="View Source on GitHub"
                            onMouseEnter={() => onLinkHover?.('https://github.com/PlusKits/Twice-PDF')}
                            onMouseLeave={() => onLinkHover?.(null)}
                            onClick={(e) => {
                                if (isTauri && window.__TAURI__?.opener?.openUrl) {
                                    e.preventDefault();
                                    window.__TAURI__.opener.openUrl('https://github.com/PlusKits/Twice-PDF');
                                }
                            }}
                        >
                            © 2025 PlusKits
                            <Github className="w-3 h-3" />
                        </a>
                        {' '}based on{' '}
                        <a
                            href="https://mozilla.github.io/pdf.js/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline hover:text-gray-600 transition-colors"
                            onMouseEnter={() => onLinkHover?.('https://mozilla.github.io/pdf.js/')}
                            onMouseLeave={() => onLinkHover?.(null)}
                            onClick={(e) => {
                                if (isTauri && window.__TAURI__?.opener?.openUrl) {
                                    e.preventDefault();
                                    window.__TAURI__.opener.openUrl('https://mozilla.github.io/pdf.js/');
                                }
                            }}
                        >
                            PDF.js
                        </a>
                    </div>
                </div>
            </div>
        </>
    );
};

export default SettingsMenu;
