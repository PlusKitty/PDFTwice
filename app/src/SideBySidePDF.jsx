import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Lock, Unlock, MessageSquare, X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, Settings, AlertTriangle, Trash2, Check, AlertCircle, Search } from 'lucide-react';
import { PDFDocument, StandardFonts, PDFName, PDFArray, PDFNumber, PDFString, PDFHexString } from 'pdf-lib';

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
    setAuthorName
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
    const [extractedText, setExtractedText] = useState(null); // Cache: { pages: [{text, pageNum}, ...] }
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

    // Sync input value with prop page
    useEffect(() => {
        setPageInputValue(page.toString());
    }, [page]);

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
                // Calculate position relative to the container
                // We want to calculate percentage relative to the *page content* for the comment anchor,
                // BUT for the button we want absolute/fixed screen coordinates or relative to the viewport.
                // Actually, the button should be floating near the selection.
                // Let's position it absolute to the viewer container or body.
                // The viewerRef has 'relative', so we can use offsetLeft/Top if we want.
                // But rect is client rect (viewport).

                // Let's use the container's bounding rect to convert to %.
                const containerRect = containerRef.current.getBoundingClientRect(); // This is the DIV holding canvas + textLayer

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
                // Prevent clearing immediately
                // e.stopPropagation(); 
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
                        </div>
                    )}
                </div>
            </div>


            {/* Search Panel */}
            {showSearch && (
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
            )}

            {!pdf ? (
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
                        <label className="cursor-pointer flex flex-col items-center gap-3 p-8 border-2 border-dashed border-gray-400 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors">
                            <Upload className="w-12 h-12 text-gray-400" />
                            <span className="text-gray-600 font-medium">Upload PDF</span>
                            <input
                                type="file"
                                accept="application/pdf"
                                onChange={onUpload}
                                className="hidden"
                            />
                        </label>
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
            )}
        </div>
    );
};

export default function SideBySidePDF() {
    const [leftPDF, setLeftPDF] = useState(null);
    const [rightPDF, setRightPDF] = useState(null);
    const [leftPage, setLeftPage] = useState(1);
    const [rightPage, setRightPage] = useState(1);
    const [leftScale, setLeftScale] = useState(1.0);
    const [rightScale, setRightScale] = useState(1.0);
    const [syncScroll, setSyncScroll] = useState(true);
    const [comments, setComments] = useState({});
    const [activeComment, setActiveComment] = useState(null);
    const [commentText, setCommentText] = useState('');
    const [pdfjsLoaded, setPdfjsLoaded] = useState(false);
    const [authorName, setAuthorName] = useState(() => localStorage.getItem('pdf_author_name') || 'User');
    const [isDirty, setIsDirty] = useState(false);
    const [loadingError, setLoadingError] = useState(null);

    // URL Loading Logic
    const loadPDFFromURL = useCallback(async (url, side) => {
        if (!url || !pdfjsLoaded) return;

        try {
            let fetchUrl = url;
            // Detect local paths (e.g. C:\ or D:\) or path traversal hints
            if (/^[a-zA-Z]:\\/.test(url) || url.startsWith('\\\\') || !url.startsWith('http') && !url.startsWith('/')) {
                fetchUrl = `/api/pdf?path=${encodeURIComponent(url)}`;
            }

            const response = await fetch(fetchUrl);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`${response.status} ${response.statusText}${errorText ? ': ' + errorText : ''}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

            const pdfData = {
                doc: pdfDoc,
                name: url.split(/[\\/]/).pop(),
                numPages: pdfDoc.numPages,
                data: arrayBuffer
            };

            if (side === 'left') {
                setLeftPDF(pdfData);
                setLeftPage(1);
            } else {
                setRightPDF(pdfData);
                setRightPage(1);
            }
        } catch (err) {
            console.error(`Error loading ${side} PDF from URL:`, err);
            setLoadingError({
                side,
                url,
                message: err.message
            });
        }
    }, [pdfjsLoaded]);

    // Parse URL on mount
    useEffect(() => {
        if (!pdfjsLoaded) return;

        const params = new URLSearchParams(window.location.search);
        const leftUrl = params.get('left');
        const rightUrl = params.get('right');

        if (leftUrl) loadPDFFromURL(leftUrl, 'left');
        if (rightUrl) loadPDFFromURL(rightUrl, 'right');
    }, [pdfjsLoaded, loadPDFFromURL]);

    // Save author name to localStorage
    useEffect(() => {
        localStorage.setItem('pdf_author_name', authorName);
    }, [authorName]);

    // Session Persistence: Load on mount
    useEffect(() => {
        const savedComments = localStorage.getItem('pdf_comments_backup');
        if (savedComments) {
            try {
                const parsed = JSON.parse(savedComments);
                if (Object.keys(parsed).length > 0) {
                    const confirmRestore = window.confirm("You have unsaved comments from a previous session. Would you like to restore them?");
                    if (confirmRestore) {
                        setComments(parsed);
                        setIsDirty(true);
                    } else {
                        localStorage.removeItem('pdf_comments_backup');
                    }
                }
            } catch (e) {
                console.error("Failed to parse saved comments", e);
            }
        }
    }, []);

    // Session Persistence: Save on change
    useEffect(() => {
        if (Object.keys(comments).length > 0) {
            localStorage.setItem('pdf_comments_backup', JSON.stringify(comments));
        } else {
            localStorage.removeItem('pdf_comments_backup');
        }
    }, [comments]);

    // Exit protection
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (isDirty) {
                const msg = "You have unsaved comments. Are you sure you want to leave?";
                e.returnValue = msg;
                return msg;
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    const leftContainerRef = useRef(null);
    const rightContainerRef = useRef(null);
    const leftViewerRef = useRef(null);
    const rightViewerRef = useRef(null);

    const isSyncingLeft = useRef(false);
    const isSyncingRight = useRef(false);

    const leftRenderTask = useRef(null);
    const rightRenderTask = useRef(null);
    const leftPreRenderTask = useRef(null);
    const rightPreRenderTask = useRef(null);

    const leftPreRenderCache = useRef({ page: null, scale: null, content: null });
    const rightPreRenderCache = useRef({ page: null, scale: null, content: null });

    useEffect(() => {
        if (window.pdfjsLib) {
            setPdfjsLoaded(true);
            return;
        }

        // Use legacy build which includes proper font handling
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.async = true;
        script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

            // Enable standard font data for better text rendering
            window.pdfjsLib.GlobalWorkerOptions.standardFontDataUrl =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/';

            setPdfjsLoaded(true);
        };
        script.onerror = () => {
            console.error('Failed to load PDF.js script');
            alert('Failed to load PDF engine. Please check your internet connection.');
        };
        document.head.appendChild(script);

        // Load official pdf.js text layer CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css';
        document.head.appendChild(link);

        // Add minimal overrides for our use case
        const style = document.createElement('style');
        style.textContent = `
      .textLayer {
        pointer-events: auto;
      }
      .textLayer > span {
        pointer-events: auto;
      }
      .textLayer ::selection {
        background: rgba(0, 100, 255, 0.3);
      }
      .pdf-page-canvas {
        display: block;
      }
    `;
        document.head.appendChild(style);

        return () => {
            if (document.head.contains(link)) {
                document.head.removeChild(link);
            }
            if (document.head.contains(style)) {
                document.head.removeChild(style);
            }
        };
    }, []);

    const renderPDFPage = async (pdfDoc, pageNum, container, scale, renderTaskRef, isPreRender = false, cacheRef = null) => {
        if (!pdfDoc || (!isPreRender && !container) || !window.pdfjsLib) return;

        // If this is a real render and we have a cached version, swap it immediately
        if (!isPreRender && cacheRef && cacheRef.current.page === pageNum && cacheRef.current.scale === scale && cacheRef.current.content) {
            container.replaceChildren(...cacheRef.current.content.childNodes);
            // Clear cache after use to prevent stale content
            cacheRef.current = { page: null, scale: null, content: null };
            return;
        }

        if (renderTaskRef.current) {
            try {
                await renderTaskRef.current.cancel();
            } catch {
                // Cancellation is expected
            }
        }

        try {
            // Create a temporary container for rendering to avoid flashes
            const tempDiv = document.createElement('div');
            tempDiv.style.position = 'relative';

            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            const outputScale = window.devicePixelRatio || 1;

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            const context = canvas.getContext('2d');

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = Math.floor(viewport.width) + 'px';
            canvas.style.height = Math.floor(viewport.height) + 'px';

            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

            renderTaskRef.current = page.render({
                canvasContext: context,
                viewport: viewport,
                transform: transform
            });

            await renderTaskRef.current.promise;
            renderTaskRef.current = null;

            tempDiv.appendChild(canvas);

            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'textLayer';
            textLayerDiv.style.width = Math.floor(viewport.width) + 'px';
            textLayerDiv.style.height = Math.floor(viewport.height) + 'px';
            textLayerDiv.style.setProperty('--scale-factor', scale.toString());
            tempDiv.appendChild(textLayerDiv);

            const textContent = await page.getTextContent();

            if (window.pdfjsLib.TextLayer) {
                const textLayer = new window.pdfjsLib.TextLayer({
                    textContentSource: textContent,
                    container: textLayerDiv,
                    viewport: viewport,
                });
                await textLayer.render();
            } else {
                const renderTask = window.pdfjsLib.renderTextLayer({
                    textContent: textContent,
                    container: textLayerDiv,
                    viewport: viewport,
                    textDivs: []
                });
                if (renderTask.promise) await renderTask.promise;
            }

            // Swap: Replace the entire content once ready
            if (isPreRender && cacheRef) {
                // For pre-render, just store it
                cacheRef.current = { page: pageNum, scale: scale, content: tempDiv };
            } else {
                container.replaceChildren(...tempDiv.childNodes);
            }
        } catch (error) {
            if (error.name !== 'RenderingCancelledException') {
                console.error('Error rendering page:', error);
            }
        }
    };

    useEffect(() => {
        if (leftPDF && leftContainerRef.current && pdfjsLoaded) {
            renderPDFPage(leftPDF.doc, leftPage, leftContainerRef.current, leftScale, leftRenderTask, false, leftPreRenderCache).then(() => {
                // After successful render, pre-render the next page
                if (leftPage < leftPDF.numPages) {
                    renderPDFPage(leftPDF.doc, leftPage + 1, null, leftScale, leftPreRenderTask, true, leftPreRenderCache);
                }
            });
        }
    }, [leftPDF, leftPage, leftScale, pdfjsLoaded]);

    useEffect(() => {
        if (rightPDF && rightContainerRef.current && pdfjsLoaded) {
            renderPDFPage(rightPDF.doc, rightPage, rightContainerRef.current, rightScale, rightRenderTask, false, rightPreRenderCache).then(() => {
                // After successful render, pre-render the next page
                if (rightPage < rightPDF.numPages) {
                    renderPDFPage(rightPDF.doc, rightPage + 1, null, rightScale, rightPreRenderTask, true, rightPreRenderCache);
                }
            });
        }
    }, [rightPDF, rightPage, rightScale, pdfjsLoaded]);

    const handleFileUpload = async (e, side) => {
        console.log('Upload triggered for', side);
        const file = e.target.files[0];
        if (!file) return;

        if (!pdfjsLoaded || !window.pdfjsLib) {
            console.error('PDF.js lib not loaded');
            alert('PDF engine is not ready yet. Please wait a moment.');
            return;
        }

        if (file.type !== 'application/pdf') {
            console.warn('File type is not application/pdf:', file.type);
            // Proceed cautiously
        }

        try {
            console.log('Loading file:', file.name);
            const arrayBuffer = await file.arrayBuffer();
            // We need to keep the buffer for export. 
            // pdfjsLib.getDocument might transfer the buffer if it was a worker, but we are in main thread or using workerSrc.
            // Let's copy it or pass it. 
            const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
            console.log('PDF Loaded, pages:', pdfDoc.numPages);

            const pdfData = {
                doc: pdfDoc,
                name: file.name,
                numPages: pdfDoc.numPages,
                data: arrayBuffer // Store raw data for export
            };

            // Extract existing annotations using pdf-lib for reliability
            const extractedComments = {};
            try {
                const pdfLibDoc = await PDFDocument.load(arrayBuffer);
                const pages = pdfLibDoc.getPages();

                // Helper to safely extract text from a PDF object
                const getText = (obj) => {
                    if (!obj) return null;
                    try {
                        if (typeof obj.decodeText === 'function') {
                            return obj.decodeText();
                        }
                        if (typeof obj.asString === 'function') {
                            return obj.asString();
                        }
                        const str = obj.toString();
                        // PDF strings/names often start with / or are wrapped in ()
                        return str.replace(/^\/|^\(|\)$/g, '');
                    } catch {
                        return null;
                    }
                };

                // Helper to parse PDF date strings (D:YYYYMMDDHHmmSSOHH'mm')
                const parsePDFDate = (dateStr) => {
                    if (!dateStr || typeof dateStr !== 'string') return new Date().toISOString();
                    const cleanDate = dateStr.replace(/^D:/, '');
                    const year = cleanDate.substring(0, 4);
                    const month = cleanDate.substring(4, 6);
                    const day = cleanDate.substring(6, 8);
                    const hours = cleanDate.substring(8, 10);
                    const mins = cleanDate.substring(10, 12);
                    const secs = cleanDate.substring(12, 14);

                    if (!year || !month || !day) return new Date().toISOString();
                    try {
                        const date = new Date(`${year}-${month}-${day}T${hours || '00'}:${mins || '00'}:${secs || '00'}`);
                        return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
                    } catch {
                        return new Date().toISOString();
                    }
                };

                pages.forEach((page, pageIdx) => {
                    const { width, height } = page.getSize();
                    const annots = page.node.lookup(PDFName.of('Annots'));

                    if (annots instanceof PDFArray) {
                        for (let j = 0; j < annots.size(); j++) {
                            const annotDict = annots.lookup(j);
                            if (!annotDict || typeof annotDict.lookup !== 'function') continue;

                            const subtypeObj = annotDict.lookup(PDFName.of('Subtype'));
                            const subtypeStr = subtypeObj ? subtypeObj.toString() : '';
                            const isHighlight = subtypeStr === '/Highlight';
                            const isText = subtypeStr === '/Text';

                            const contents = getText(annotDict.lookup(PDFName.of('Contents')));

                            if ((isHighlight || isText) && contents) {
                                const rect = annotDict.lookup(PDFName.of('Rect'));
                                if (!(rect instanceof PDFArray)) continue;

                                const r = rect.asArray().map(v => v instanceof PDFNumber ? v.asNumber() : 0);
                                const left = r[0];
                                const bottom = r[1];
                                const right = r[2];
                                const top = r[3];

                                const x_percent = (left / width) * 100;
                                const y_percent = (1 - (top / height)) * 100;

                                const author = getText(annotDict.lookup(PDFName.of('T'))) || 'Unknown';
                                const rawDate = getText(annotDict.lookup(PDFName.of('M')));
                                const date = parsePDFDate(rawDate);

                                const annotId = getText(annotDict.lookup(PDFName.of('NM'))) || `id-${Math.random().toString(36).substr(2, 5)}`;
                                const commentId = `imported-${side}-${annotId}`;

                                let highlightRect = null;
                                if (isHighlight) {
                                    highlightRect = {
                                        left: (left / width) * 100,
                                        top: (1 - (top / height)) * 100,
                                        right: (right / width) * 100,
                                        bottom: (1 - (bottom / height)) * 100,
                                        width: ((right - left) / width) * 100,
                                        height: ((top - bottom) / height) * 100
                                    };
                                }

                                extractedComments[commentId] = {
                                    id: commentId,
                                    side: side,
                                    x: x_percent,
                                    y: y_percent,
                                    page: pageIdx + 1,
                                    text: contents,
                                    highlightRect,
                                    selectedText: contents.substring(0, 50) + (contents.length > 50 ? '...' : ''),
                                    timestamp: date,
                                    author: author
                                };
                            }
                        }
                    }
                });
            } catch (libErr) {
                console.warn('Error extracting annotations with pdf-lib:', libErr);
            }

            if (Object.keys(extractedComments).length > 0) {
                setComments(prev => ({ ...prev, ...extractedComments }));
            }

            if (side === 'left') {
                setLeftPDF(pdfData);
                setLeftPage(1);
            } else {
                setRightPDF(pdfData);
                setRightPage(1);
            }
        } catch (error) {
            console.error('Error loading PDF:', error);
            alert('Failed to load PDF. Please try again.');
        }
    };

    const handleScroll = (e, source) => {
        if (!syncScroll) return;

        const targetRef = source === 'left' ? rightViewerRef : leftViewerRef;
        const scrollPercentage = e.target.scrollTop / (e.target.scrollHeight - e.target.clientHeight || 1);
        const scrollLeftPercentage = e.target.scrollLeft / (e.target.scrollWidth - e.target.clientWidth || 1);

        if (source === 'left') {
            if (isSyncingLeft.current) {
                isSyncingLeft.current = false;
                return;
            }
            isSyncingRight.current = true;
            if (targetRef.current) {
                const targetMaxScroll = targetRef.current.scrollHeight - targetRef.current.clientHeight;
                targetRef.current.scrollTop = scrollPercentage * targetMaxScroll;

                const targetMaxScrollLeft = targetRef.current.scrollWidth - targetRef.current.clientWidth;
                targetRef.current.scrollLeft = scrollLeftPercentage * targetMaxScrollLeft;
            }
        } else {
            if (isSyncingRight.current) {
                isSyncingRight.current = false;
                return;
            }
            isSyncingLeft.current = true;
            if (targetRef.current) {
                const targetMaxScroll = targetRef.current.scrollHeight - targetRef.current.clientHeight;
                targetRef.current.scrollTop = scrollPercentage * targetMaxScroll;

                const targetMaxScrollLeft = targetRef.current.scrollWidth - targetRef.current.clientWidth;
                targetRef.current.scrollLeft = scrollLeftPercentage * targetMaxScrollLeft;
            }
        }
    };

    const handlePageChange = (newPage, side) => {
        const oldPage = side === 'left' ? leftPage : rightPage;
        if (newPage === oldPage) return;
        const delta = newPage - oldPage;

        if (side === 'left') {
            setLeftPage(newPage);
            if (syncScroll && rightPDF) {
                setRightPage(prev => Math.min(Math.max(1, prev + delta), rightPDF.numPages));
            }
        } else {
            setRightPage(newPage);
            if (syncScroll && leftPDF) {
                setLeftPage(prev => Math.min(Math.max(1, prev + delta), leftPDF.numPages));
            }
        }
    };

    const handleScaleChange = (newScale, side) => {
        if (syncScroll) {
            setLeftScale(newScale);
            setRightScale(newScale);
        } else {
            if (side === 'left') {
                setLeftScale(newScale);
            } else {
                setRightScale(newScale);
            }
        }
    };

    const addComment = (side, x, y, highlightRect = null, selectedText = '') => {
        const id = `${side}-${Date.now()}`;
        setActiveComment({
            id,
            side,
            x,
            y,
            text: '',
            highlightRect,
            selectedText
        });
        setCommentText('');
        setIsDirty(true); // Manually mark as dirty
    };

    const saveComment = () => {
        if (activeComment && commentText.trim()) {
            setComments(prev => ({
                ...prev,
                [activeComment.id]: {
                    ...activeComment,
                    text: commentText,
                    author: authorName,
                    page: activeComment.side === 'left' ? leftPage : rightPage,
                    timestamp: new Date().toISOString()
                }
            }));
            setActiveComment(null);
            setCommentText('');
            setIsDirty(true); // Manually mark as dirty
        }
    };

    const deleteComment = (id) => {
        setComments(prev => {
            const newComments = { ...prev };
            delete newComments[id];
            return newComments;
        });
        setIsDirty(true); // Manually mark as dirty
    };

    const processPDFAndDownload = async (side) => {
        const pdfData = side === 'left' ? leftPDF : rightPDF;
        if (!pdfData || !pdfData.data) return;

        const sideComments = Object.values(comments).filter(c => c.side === side);
        if (sideComments.length === 0) {
            alert(`No comments to export for the ${side} PDF.`);
            return;
        }

        try {
            const pdfDoc = await PDFDocument.load(pdfData.data);
            const { PDFName, PDFString, PDFArray } = await import('pdf-lib');

            for (const comment of sideComments) {
                const pageIndex = comment.page - 1;
                if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

                const page = pdfDoc.getPage(pageIndex);
                const { width, height } = page.getSize();

                // Convert % to points
                const x = (comment.x / 100) * width;
                const y = height - ((comment.y / 100) * height);

                const formatPDFDate = (date) => {
                    const pad = (n) => n.toString().padStart(2, '0');
                    const year = date.getFullYear();
                    const month = pad(date.getMonth() + 1);
                    const day = pad(date.getDate());
                    const hours = pad(date.getHours());
                    const minutes = pad(date.getMinutes());
                    const seconds = pad(date.getSeconds());
                    const tzOffset = -date.getTimezoneOffset();
                    const tzSign = tzOffset >= 0 ? '+' : '-';
                    const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
                    const tzMins = pad(Math.abs(tzOffset) % 60);
                    return `D:${year}${month}${day}${hours}${minutes}${seconds}${tzSign}${tzHours}'${tzMins}'`;
                };

                const commentDate = comment.timestamp ? new Date(comment.timestamp) : new Date();
                const highlightColor = [1, 1, 0]; // Yellow
                const annotId = `annot-${comment.id}-${Date.now()}`;

                let annot;
                let annotRect;

                if (comment.highlightRect) {
                    const hr = comment.highlightRect;
                    const left = (hr.left / 100) * width;
                    const right = (hr.right / 100) * width;
                    const top = height - ((hr.top / 100) * height);
                    const bottom = height - ((hr.bottom / 100) * height);

                    const quadPoints = [
                        left, top,      // top-left
                        right, top,     // top-right
                        left, bottom,   // bottom-left
                        right, bottom   // bottom-right
                    ];

                    annotRect = [left, bottom, right, top];

                    annot = pdfDoc.context.obj({
                        Type: PDFName.of('Annot'),
                        Subtype: PDFName.of('Highlight'),
                        NM: PDFString.of(annotId),
                        Rect: annotRect,
                        QuadPoints: quadPoints,
                        Contents: PDFString.of(comment.text),
                        C: highlightColor,
                        CA: 0.4,
                        F: 4,
                        T: PDFString.of('Author'),
                        M: PDFString.of(formatPDFDate(commentDate)),
                        CreationDate: PDFString.of(formatPDFDate(commentDate)),
                    });
                } else {
                    annotRect = [x, y - 20, x + 20, y];

                    annot = pdfDoc.context.obj({
                        Type: PDFName.of('Annot'),
                        Subtype: PDFName.of('Text'),
                        NM: PDFString.of(annotId),
                        Rect: annotRect,
                        Contents: PDFString.of(comment.text),
                        C: highlightColor,
                        Name: PDFName.of('Comment'),
                        Open: false,
                        F: 4,
                        T: PDFString.of('Author'),
                        M: PDFString.of(formatPDFDate(commentDate)),
                        CreationDate: PDFString.of(formatPDFDate(commentDate)),
                    });
                }

                const annotRef = pdfDoc.context.register(annot);

                // Create linked Popup annotation for sidebar visibility
                const popupRect = [
                    annotRect[2],
                    annotRect[1],
                    annotRect[2] + 200,
                    annotRect[1] + 100
                ];

                const popup = pdfDoc.context.obj({
                    Type: PDFName.of('Annot'),
                    Subtype: PDFName.of('Popup'),
                    Rect: popupRect,
                    Parent: annotRef,
                    Open: false,
                    F: 0,
                });

                const popupRef = pdfDoc.context.register(popup);
                annot.set(PDFName.of('Popup'), popupRef);

                const existingAnnots = page.node.lookup(PDFName.of('Annots'));
                if (existingAnnots instanceof PDFArray) {
                    existingAnnots.push(annotRef);
                    existingAnnots.push(popupRef);
                } else {
                    const newAnnots = pdfDoc.context.obj([annotRef, popupRef]);
                    page.node.set(PDFName.of('Annots'), newAnnots);
                }
            }

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const nameParts = pdfData.name.split('.');
            const baseName = nameParts.length > 1 ? nameParts.slice(0, -1).join('.') : nameParts[0];
            a.download = `${baseName}_commented.pdf`;

            a.click();
            URL.revokeObjectURL(url);

            // Clear dirty flag and backup on successful export
            setIsDirty(false);
            localStorage.removeItem('pdf_comments_backup');
        } catch (err) {
            console.error(`Error exporting ${side} PDF:`, err);
            alert(`Failed to export ${side} PDF.`);
        }
    };

    const exportSinglePDF = async (side) => {
        await processPDFAndDownload(side);
    };

    return (
        <div className="w-full h-screen flex flex-col bg-gray-100 p-2">
            <div className="flex-1 flex gap-2 min-h-0">
                <PDFViewer
                    pdf={leftPDF}
                    side="left"
                    page={leftPage}
                    setPage={(p) => handlePageChange(p, 'left')}
                    scale={leftScale}
                    setScale={(s) => handleScaleChange(s, 'left')}
                    containerRef={leftContainerRef}
                    viewerRef={leftViewerRef}
                    onScroll={handleScroll}
                    onUpload={(e) => handleFileUpload(e, 'left')}
                    onExport={() => exportSinglePDF('left')}
                    comments={comments}
                    deleteComment={deleteComment}
                    activeComment={activeComment}
                    setActiveComment={setActiveComment}
                    commentText={commentText}
                    setCommentText={setCommentText}
                    saveComment={saveComment}
                    addComment={addComment}
                    pdfjsLoaded={pdfjsLoaded}
                    syncScroll={syncScroll}
                    setSyncScroll={setSyncScroll}
                    hasComments={Object.values(comments).some(c => c.side === 'left')}
                    isDirty={isDirty}
                    authorName={authorName}
                    setAuthorName={setAuthorName}
                />
                <PDFViewer
                    pdf={rightPDF}
                    side="right"
                    page={rightPage}
                    setPage={(p) => handlePageChange(p, 'right')}
                    scale={rightScale}
                    setScale={(s) => handleScaleChange(s, 'right')}
                    containerRef={rightContainerRef}
                    viewerRef={rightViewerRef}
                    onScroll={handleScroll}
                    onUpload={(e) => handleFileUpload(e, 'right')}
                    onExport={() => exportSinglePDF('right')}
                    comments={comments}
                    deleteComment={deleteComment}
                    activeComment={activeComment}
                    setActiveComment={setActiveComment}
                    commentText={commentText}
                    setCommentText={setCommentText}
                    saveComment={saveComment}
                    addComment={addComment}
                    pdfjsLoaded={pdfjsLoaded}
                    hasComments={Object.values(comments).some(c => c.side === 'right')}
                    isDirty={isDirty}
                    authorName={authorName}
                    setAuthorName={setAuthorName}
                />
            </div>

            {/* Error Modal */}
            {loadingError && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-red-100 transform animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3 text-red-600 mb-4">
                            <div className="p-2 bg-red-50 rounded-lg">
                                <AlertCircle className="w-6 h-6" />
                            </div>
                            <h2 className="text-lg font-bold">Failed to Load PDF</h2>
                        </div>

                        <div className="space-y-3 mb-6">
                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Error Details</div>
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                <p className="text-sm font-medium text-gray-700 break-words mb-1">
                                    <span className="text-gray-400 mr-2">Target:</span> {loadingError.url}
                                </p>
                                <p className="text-xs text-red-500 font-mono italic leading-relaxed">
                                    {loadingError.message}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => setLoadingError(null)}
                            className="w-full bg-gray-900 text-white rounded-lg py-2.5 font-medium hover:bg-gray-800 transition-colors shadow-lg shadow-gray-200"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
