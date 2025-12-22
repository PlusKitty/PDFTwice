import React, { useState, useRef, useEffect } from 'react';
import { Upload, Lock, Unlock, MessageSquare, X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, Settings, AlertTriangle, Trash2, Search, Loader2 } from 'lucide-react';

const PDFViewer = ({
    pdf,
    side,
    page,
    setPage,
    scale,
    setScale,
    containerRef,
    viewerRef,
    onScroll,
    onUpload,
    onExport,
    comments,
    deleteComment,
    activeComment,
    setActiveComment,
    commentText,
    setCommentText,
    saveComment,
    addComment,
    pdfjsLoaded,
    syncScroll,
    setSyncScroll,
    hasComments,
    isDirty,
    authorName,
    setAuthorName,
    onClose,
    onLoadFromUrl,
    isLoading = false
}) => {
    const numPages = pdf?.numPages || 0;
    const [selectionBtn, setSelectionBtn] = useState({ show: false, x: 0, y: 0 });
    const [hoveredCommentId, setHoveredCommentId] = useState(null);
    const [pageInputValue, setPageInputValue] = useState(page.toString());
    const [zoomInputValue, setZoomInputValue] = useState(Math.round(scale * 100).toString());
    const [isDragging, setIsDragging] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [tempAuthorName, setTempAuthorName] = useState(authorName);
    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [currentResultIndex, setCurrentResultIndex] = useState(-1);
    const [isSearching, setIsSearching] = useState(false);
    const [extractedText, setExtractedText] = useState(null);
    const searchInputRef = useRef(null);

    // Sync input value with prop page
    useEffect(() => {
        setPageInputValue(page.toString());
    }, [page]);

    // Sync zoom input with prop scale
    useEffect(() => {
        setZoomInputValue(Math.round(scale * 100).toString());
    }, [scale]);

    const handleZoomInputBlur = () => {
        const val = parseInt(zoomInputValue);
        if (isNaN(val) || val < 50 || val > 300) {
            setZoomInputValue(Math.round(scale * 100).toString());
        } else {
            setScale(val / 100);
        }
    };

    const handleZoomInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            setZoomInputValue(Math.round(scale * 100).toString());
            e.currentTarget.blur();
        }
    };

    const handlePageInputBlur = () => {
        const val = parseInt(pageInputValue);
        if (isNaN(val) || val < 1 || val > numPages) {
            setPageInputValue(page.toString());
        } else {
            setPage(val);
        }
    };

    const handlePageInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            setPageInputValue(page.toString());
            e.currentTarget.blur();
        }
    };

    // Zoom gestures (Ctrl+Scroll / Pinch)
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer) return;

        const handleWheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY;
                setScale(prev => {
                    const step = 0.1;
                    const direction = delta > 0 ? -1 : 1;
                    const newScale = prev + (direction * step);
                    return Math.min(Math.max(0.5, newScale), 3);
                });
            }
        };

        viewer.addEventListener('wheel', handleWheel, { passive: false });
        return () => viewer.removeEventListener('wheel', handleWheel);
    }, [setScale, viewerRef]);

    useEffect(() => {
        const handleDocumentSelectionChange = () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                setSelectionBtn({ show: false, x: 0, y: 0 });
            }
        };
        // Listen to selectionchange on document to hide button if selection cleared
        document.addEventListener('selectionchange', handleDocumentSelectionChange);
        return () => document.removeEventListener('selectionchange', handleDocumentSelectionChange);
    }, []);

    const handleMouseUp = () => {
        if (!pdf) return;

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            // Check if selection is inside this viewer
            if (containerRef.current && containerRef.current.contains(range.commonAncestorContainer)) {
                const containerRect = containerRef.current.getBoundingClientRect();

                // Comment Anchor Position (for adding the comment)
                const anchorX = ((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100;
                const anchorY = ((rect.top - containerRect.top) / containerRect.height) * 100;

                // Store the full selection bounds as percentages for highlight annotations
                const highlightRect = {
                    left: ((rect.left - containerRect.left) / containerRect.width) * 100,
                    top: ((rect.top - containerRect.top) / containerRect.height) * 100,
                    right: ((rect.right - containerRect.left) / containerRect.width) * 100,
                    bottom: ((rect.bottom - containerRect.top) / containerRect.height) * 100,
                    width: (rect.width / containerRect.width) * 100,
                    height: (rect.height / containerRect.height) * 100,
                };

                // Get the selected text
                const selectedText = selection.toString();

                setSelectionBtn({
                    show: true,
                    x: anchorX,
                    y: anchorY,
                    highlightRect: highlightRect,
                    selectedText: selectedText,
                });
            }
        }
    };

    const extractAllText = async () => {
        if (!pdf || extractedText) return extractedText;
        setIsSearching(true);
        try {
            const pagesText = [];
            for (let i = 1; i <= numPages; i++) {
                const page = await pdf.doc.getPage(i);
                const content = await page.getTextContent();
                const text = content.items.map(item => item.str).join(' ');
                pagesText.push({ pageNum: i, text });
            }
            const data = { pages: pagesText };
            setExtractedText(data);
            return data;
        } catch (err) {
            console.error("Text extraction failed", err);
            return null;
        } finally {
            setIsSearching(false);
        }
    };

    const performSearch = async (query, isNext = false) => {
        if (!query.trim()) {
            setSearchResults([]);
            setCurrentResultIndex(-1);
            return;
        }

        let data = extractedText;
        if (!data) {
            data = await extractAllText();
        }
        if (!data) return;

        const results = [];
        const lowerQuery = query.toLowerCase();

        data.pages.forEach(page => {
            let pos = page.text.toLowerCase().indexOf(lowerQuery);
            while (pos !== -1) {
                const start = Math.max(0, pos - 40);
                const end = Math.min(page.text.length, pos + query.length + 40);
                const snippet = page.text.substring(start, end);

                results.push({
                    page: page.pageNum,
                    snippet: snippet,
                    pos: pos,
                    queryStart: pos - start,
                    queryEnd: pos - start + query.length
                });
                pos = page.text.toLowerCase().indexOf(lowerQuery, pos + 1);
            }
        });

        setSearchResults(results);

        if (results.length > 0) {
            let nextIndex = 0;
            if (isNext) {
                nextIndex = (currentResultIndex + 1) % results.length;
            } else {
                // Find first result on or after current page
                const firstOnOrAfter = results.findIndex(r => r.page >= page);
                nextIndex = firstOnOrAfter !== -1 ? firstOnOrAfter : 0;
            }
            setCurrentResultIndex(nextIndex);
            setPage(results[nextIndex].page);
        } else {
            setCurrentResultIndex(-1);
        }
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Enter') {
            performSearch(searchQuery, true);
        } else if (e.key === 'Escape') {
            setShowSearch(false);
        }
    };

    // Focus search input when shown
    useEffect(() => {
        if (showSearch && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [showSearch]);

    // Reset search when PDF changes
    useEffect(() => {
        setExtractedText(null);
        setSearchResults([]);
        setCurrentResultIndex(-1);
        setShowSearch(false);
        setSearchQuery('');
    }, [pdf]);

    return (
        <div className="flex-1 flex flex-col border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-50">
            <div className="bg-gray-100 px-2 py-1 border-b border-gray-300">
                <div className="flex items-center justify-between gap-1">
                    {/* File name - compact */}
                    <span className="text-xs font-medium text-gray-600 truncate flex-1 min-w-0" title={pdf ? pdf.name : `${side === 'left' ? 'Left' : 'Right'} PDF`}>
                        {pdf ? pdf.name : `${side === 'left' ? 'Left' : 'Right'} PDF`}
                    </span>

                    {pdf && (
                        <div className="flex items-center gap-1">
                            {/* Search Toggle */}
                            <button
                                onClick={() => setShowSearch(!showSearch)}
                                className={`p-0.5 rounded transition-colors ${showSearch ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300 hover:bg-gray-100'}`}
                                title="Find in PDF"
                            >
                                <Search className="w-3 h-3" />
                            </button>

                            {/* Divider */}
                            <div className="w-px h-4 bg-gray-300 mx-0.5" />
                            {/* Page navigation */}
                            <button
                                onClick={() => setPage(Math.max(1, page - 1))}
                                disabled={page <= 1}
                                className="p-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                                title="Previous page"
                            >
                                <ChevronLeft className="w-3 h-3" />
                            </button>
                            <div className="flex items-center gap-0.5 mx-0.5">
                                <input
                                    type="text"
                                    value={pageInputValue}
                                    onChange={(e) => setPageInputValue(e.target.value)}
                                    onBlur={handlePageInputBlur}
                                    onKeyDown={handlePageInputKeyDown}
                                    className="w-8 text-center text-xs border border-gray-300 rounded p-0 h-5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-[10px] text-gray-400">/ {numPages}</span>
                            </div>
                            <button
                                onClick={() => setPage(Math.min(numPages, page + 1))}
                                disabled={page >= numPages}
                                className="p-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                                title="Next page"
                            >
                                <ChevronRight className="w-3 h-3" />
                            </button>

                            {/* Divider */}
                            <div className="w-px h-4 bg-gray-300 mx-1" />

                            {/* Zoom controls */}
                            <button
                                onClick={() => setScale(Math.max(0.5, scale - 0.25))}
                                className="p-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100"
                                title="Zoom out"
                            >
                                <ZoomOut className="w-3 h-3" />
                            </button>
                            <div className="flex items-center gap-0.5 mx-0.5">
                                <input
                                    type="text"
                                    value={zoomInputValue}
                                    onChange={(e) => setZoomInputValue(e.target.value)}
                                    onBlur={handleZoomInputBlur}
                                    onKeyDown={handleZoomInputKeyDown}
                                    className="w-8 text-center text-xs border border-gray-300 rounded p-0 h-5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-[10px] text-gray-400 font-medium">%</span>
                            </div>
                            <button
                                onClick={() => setScale(Math.min(3, scale + 0.25))}
                                className="p-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100"
                                title="Zoom in"
                            >
                                <ZoomIn className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => setScale(1.0)}
                                className="p-0.5 bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 ml-0.5"
                                title="Reset zoom to 100%"
                            >
                                <RotateCcw className="w-3 h-3" />
                            </button>

                            {/* Divider */}
                            <div className="w-px h-4 bg-gray-300 mx-1" />

                            {/* Sync Scroll - only on left PDF */}
                            {side === 'left' && setSyncScroll && (
                                <button
                                    onClick={() => setSyncScroll(!syncScroll)}
                                    className={`p-0.5 rounded transition-colors ${syncScroll
                                        ? 'bg-green-500 text-white hover:bg-green-600'
                                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                        }`}
                                    title={syncScroll ? "Sync view enabled" : "Sync view disabled"}
                                >
                                    {syncScroll ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                                </button>
                            )}

                            {/* Author Settings - Left Side Only */}
                            {side === 'left' && (
                                <div className="relative">
                                    <button
                                        onClick={() => {
                                            if (!showSettings) setTempAuthorName(authorName);
                                            setShowSettings(!showSettings);
                                        }}
                                        className={`p-0.5 rounded transition-colors ${showSettings ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                                        title="Author Settings"
                                    >
                                        <Settings className="w-3 h-3" />
                                    </button>

                                    {showSettings && (
                                        <>
                                            {/* Click-away overlay */}
                                            <div
                                                className="fixed inset-0 z-[105]"
                                                onClick={() => setShowSettings(false)}
                                            />
                                            <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2.5 z-[110] min-w-[140px] animate-in fade-in zoom-in-95 duration-200">
                                                <div className="text-[10px] text-gray-400 mb-1.5 font-medium">Author</div>
                                                <input
                                                    type="text"
                                                    value={tempAuthorName}
                                                    onChange={(e) => setTempAuthorName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            setAuthorName(tempAuthorName);
                                                            setShowSettings(false);
                                                        } else if (e.key === 'Escape') {
                                                            setShowSettings(false);
                                                        }
                                                    }}
                                                    className="w-full text-xs border border-gray-200 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-400 font-normal bg-gray-50"
                                                    onClick={(e) => e.stopPropagation()}
                                                    autoFocus
                                                    onFocus={(e) => e.target.select()}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Export - per PDF with Dirty Warning */}
                            {hasComments && (
                                <button
                                    onClick={onExport}
                                    className="p-0.5 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors relative"
                                    title={`Export with comments${isDirty ? ' (Unsaved manual changes)' : ''}`}
                                >
                                    <Download className="w-3 h-3" />
                                    {isDirty && (
                                        <div className="absolute -top-1 -right-1 bg-yellow-400 text-black rounded-full border border-[0.5px] border-white p-[1px]" title="Unsaved manual changes">
                                            <AlertTriangle className="w-2 h-2" />
                                        </div>
                                    )}
                                </button>
                            )}

                            <button
                                onClick={onClose}
                                className="p-0.5 ml-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-500 transition-colors"
                                title="Close PDF"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>


            {/* Search Panel */}
            {
                showSearch && (
                    <div className="bg-white border-b border-gray-200 p-2 shadow-sm animate-in slide-in-from-top duration-200">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="relative flex-1">
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Find..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={handleSearchKeyDown}
                                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-16"
                                />
                                <div className="absolute right-2 top-1.5 flex items-center gap-1">
                                    {isSearching ? (
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                                    ) : (
                                        <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                                            {searchResults.length > 0 ? `${currentResultIndex + 1} / ${searchResults.length}` : (searchQuery && !isSearching ? 'No results' : '')}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => setShowSearch(false)}
                                className="p-1.5 hover:bg-gray-100 rounded text-gray-400"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {searchResults.length > 0 && (
                            <div className="max-h-[220px] overflow-y-auto border border-gray-100 rounded bg-gray-50/50">
                                {searchResults.slice(0, 50).map((result, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            setCurrentResultIndex(idx);
                                            setPage(result.page);
                                        }}
                                        className={`w-full text-left p-2 border-b border-gray-50 flex justify-between items-start gap-3 transition-colors ${currentResultIndex === idx ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-white'
                                            }`}
                                    >
                                        <span className="text-[11px] leading-relaxed flex-1 text-gray-600">
                                            {result.snippet.substring(0, result.queryStart)}
                                            <b className="text-blue-700 bg-blue-100/50 px-0.5 rounded">{result.snippet.substring(result.queryStart, result.queryEnd)}</b>
                                            {result.snippet.substring(result.queryEnd)}
                                        </span>
                                        <span className="text-[10px] font-bold text-gray-400 mt-0.5">{result.page}</span>
                                    </button>
                                ))}
                                {searchResults.length > 50 && (
                                    <div className="p-2 text-[10px] text-center text-gray-400 italic">
                                        Showing first 50 of {searchResults.length} results
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )
            }

            {
                !pdf ? (
                    <div
                        className={`flex-1 flex flex-col items-center justify-center transition-all ${isDragging ? 'bg-blue-50 border-4 border-dashed border-blue-400 rounded-lg m-4' : ''}`}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            const file = e.dataTransfer.files[0];
                            if (file && file.type === 'application/pdf') {
                                onUpload({ target: { files: [file] } });
                            }
                        }}
                    >
                        {!pdfjsLoaded ? (
                            <div className="flex flex-col items-center gap-3">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                                <span className="text-gray-600 font-medium">Initializing PDF Engine...</span>
                            </div>
                        ) : (
                            <>
                                <label className={`cursor-pointer flex flex-col items-center gap-3 p-8 border-2 border-dashed rounded-lg transition-colors ${isLoading ? 'border-gray-200 bg-gray-50 cursor-wait' : 'border-gray-400 hover:border-blue-500 hover:bg-blue-50'}`}>
                                    <Upload className={`w-12 h-12 ${isLoading ? 'text-gray-300' : 'text-gray-400'}`} />
                                    <span className={`font-medium ${isLoading ? 'text-gray-400' : 'text-gray-600'}`}>{isLoading ? 'Uploading PDF...' : 'Upload PDF'}</span>
                                    <input
                                        type="file"
                                        accept="application/pdf"
                                        onChange={onUpload}
                                        className="hidden"
                                        disabled={isLoading}
                                    />
                                </label>

                                <div className="flex items-center w-full max-w-xs gap-3 my-4">
                                    <div className="h-px bg-gray-300 flex-1"></div>
                                    <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">Or load from URL</span>
                                    <div className="h-px bg-gray-300 flex-1"></div>
                                </div>

                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        const url = e.target.elements.url.value.trim();
                                        if (url) onLoadFromUrl(url);
                                    }}
                                    className="flex w-full max-w-xs gap-2"
                                >
                                    <input
                                        name="url"
                                        type="text"
                                        placeholder="https://... or C:\..."
                                        disabled={isLoading}
                                        className="flex-1 text-xs border border-gray-300 rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                                        {isLoading ? 'Loading...' : 'Load'}
                                    </button>
                                </form>
                            </>
                        )}
                    </div>
                ) : (
                    <div
                        ref={viewerRef}
                        tabIndex={0}
                        className="flex-1 overflow-auto relative bg-gray-200 p-4 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
                        onScroll={(e) => onScroll(e, side)}
                        onKeyDown={(e) => {
                            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
                            if (e.key === 'ArrowLeft') {
                                setPage(Math.max(1, page - 1));
                            } else if (e.key === 'ArrowRight') {
                                setPage(Math.min(numPages, page + 1));
                            }
                        }}
                    >
                        <div
                            className="relative inline-block bg-white shadow-lg"
                            onDoubleClick={(e) => {
                                const selection = window.getSelection();
                                const hasSelection = selection && !selection.isCollapsed;
                                const isTextSpan = e.target.tagName === 'SPAN';

                                if (hasSelection && isTextSpan) return;

                                // Point comment path
                                setSelectionBtn({ show: false, x: 0, y: 0 });

                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = ((e.clientX - rect.left) / rect.width) * 100;
                                const y = ((e.clientY - rect.top) / rect.height) * 100;

                                addComment(side, x, y);

                                // Clear any stray selection (if we clicked between words)
                                if (selection && !isTextSpan) {
                                    selection.removeAllRanges();
                                }
                            }}
                            onMouseUp={handleMouseUp}
                        >
                            <div ref={containerRef} style={{ position: 'relative' }} />

                            {selectionBtn.show && (
                                <button
                                    className="absolute bg-blue-600 text-white px-3 py-1 rounded shadow-lg z-50 text-sm font-medium hover:bg-blue-700 transform -translate-x-1/2 -translate-y-full mt-[-5px]"
                                    style={{
                                        left: `${selectionBtn.x}%`,
                                        top: `${selectionBtn.y}%`,
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        addComment(side, selectionBtn.x, selectionBtn.y, selectionBtn.highlightRect, selectionBtn.selectedText);
                                        setSelectionBtn({ show: false, x: 0, y: 0, highlightRect: null, selectedText: '' });
                                        window.getSelection()?.removeAllRanges();
                                    }}
                                >
                                    + Add Comment
                                </button>
                            )}

                            {Object.values(comments)
                                .filter(c => c.side === side && c.page === page)
                                .map(comment => (
                                    <React.Fragment key={comment.id}>
                                        {/* The visual marker: either a highlight box or a MessageSquare icon */}
                                        {comment.highlightRect ? (
                                            <div
                                                className="absolute bg-yellow-400 opacity-40 hover:opacity-60 transition-opacity cursor-pointer z-[20]"
                                                style={{
                                                    left: `${comment.highlightRect.left}%`,
                                                    top: `${comment.highlightRect.top}%`,
                                                    width: `${comment.highlightRect.width}%`,
                                                    height: `${comment.highlightRect.height}%`,
                                                }}
                                                onMouseEnter={() => setHoveredCommentId(comment.id)}
                                                onMouseLeave={() => setHoveredCommentId(null)}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveComment(comment);
                                                    setCommentText(comment.text);
                                                }}
                                            />
                                        ) : (
                                            <div
                                                className="absolute text-yellow-600 opacity-70 hover:opacity-100 transition-opacity cursor-pointer z-[30]"
                                                style={{
                                                    left: `${comment.x}%`,
                                                    top: `${comment.y}%`,
                                                    transform: 'translate(-50%, -50%)'
                                                }}
                                                onMouseEnter={() => setHoveredCommentId(comment.id)}
                                                onMouseLeave={() => setHoveredCommentId(null)}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveComment(comment);
                                                    setCommentText(comment.text);
                                                }}
                                            >
                                                <MessageSquare className="w-5 h-5 fill-current" />
                                            </div>
                                        )}

                                        {/* Hover Preview Bubble */}
                                        {hoveredCommentId === comment.id && (!activeComment || activeComment.id !== comment.id) && (
                                            <div
                                                className="absolute bg-white border border-gray-300 rounded shadow-xl p-2 text-xs max-w-[200px] z-[60] pointer-events-none"
                                                style={{
                                                    left: `${comment.x}%`,
                                                    top: `${comment.y}%`,
                                                    transform: 'translate(-50%, calc(-100% - 10px))'
                                                }}
                                            >
                                                <div className="flex justify-between items-center mb-1 border-b border-gray-100 pb-1">
                                                    <span className="font-bold text-gray-500">{comment.author || 'User'}</span>
                                                </div>
                                                <p className="line-clamp-4 text-gray-800 leading-relaxed">
                                                    {comment.text}
                                                </p>
                                            </div>
                                        )}
                                    </React.Fragment>
                                ))}

                            {activeComment && activeComment.side === side && (
                                <div
                                    className="absolute bg-white border-2 border-blue-400 rounded-lg p-3 shadow-2xl z-[70] transition-all duration-200"
                                    style={{
                                        left: `${activeComment.x}%`,
                                        top: `${activeComment.y}%`,
                                        transform: 'translate(-50%, -50%)',
                                        minWidth: '250px'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <textarea
                                        autoFocus
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.ctrlKey && e.key === 'Enter') {
                                                e.preventDefault();
                                                saveComment();
                                            }
                                        }}
                                        placeholder="Add your comment..."
                                        className="w-full p-2 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        rows={3}
                                    />
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={saveComment}
                                            className="flex-1 bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 text-sm font-medium"
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (activeComment.id.toString().includes('imported') || activeComment.id.toString().includes('-1')) {
                                                    // If it's an existing comment being edited, we should probably have a delete option or just close
                                                }
                                                setActiveComment(null);
                                            }}
                                            className="flex-1 bg-gray-200 text-gray-700 px-3 py-1 rounded hover:bg-gray-300 text-sm"
                                        >
                                            Close
                                        </button>
                                        <button
                                            onClick={() => {
                                                deleteComment(activeComment.id);
                                                setActiveComment(null);
                                            }}
                                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                                            title="Delete comment"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default PDFViewer;
