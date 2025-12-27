import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Upload, Lock, Unlock, MessageSquare, X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, Settings, AlertTriangle, Trash2, Search, Loader2, Maximize, Maximize2, Highlighter, Send, ExternalLink, Github } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

const PDFViewer = forwardRef(({
    pdf,
    side,
    page,
    setPage,
    scale,
    setScale,
    viewerRef: externalViewerRef, // Now optional or used if provided
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
    addHighlight,
    syncScroll,
    setSyncScroll,
    hasComments,
    isDirty,
    authorName,
    setAuthorName,
    onClose,
    onLoadFromUrl,
    onFitToPage,
    isLoading = false,
    viewMode = 'single', // 'single' | 'continuous'
    setViewMode,
    className,
}, ref) => {
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
    const [searchResults, _setSearchResults] = useState([]);
    const searchResultsRef = useRef([]);
    const setSearchResults = (resultsOrFn) => {
        if (typeof resultsOrFn === 'function') {
            _setSearchResults(prev => {
                const newResults = resultsOrFn(prev);
                searchResultsRef.current = newResults;
                return newResults;
            });
        } else {
            searchResultsRef.current = resultsOrFn;
            _setSearchResults(resultsOrFn);
        }
    };
    const [currentResultIndex, _setCurrentResultIndex] = useState(-1);
    const currentResultIndexRef = useRef(-1);
    const setCurrentResultIndex = (idx) => {
        currentResultIndexRef.current = idx;
        _setCurrentResultIndex(idx);
    };

    const [isSearching, setIsSearching] = useState(false);
    const [extractedText, setExtractedText] = useState(null);
    const searchInputRef = useRef(null);
    const searchResultRefs = useRef({});
    const activeSearchRef = useRef(0);
    const selectedResultIdRef = useRef(null); // Track selected result by identity { page, pos }
    const activeNavigationRef = useRef(0); // Simple version counter for navigation
    const userNavigatedRef = useRef(false); // Flag to track explicit user navigation vs batch updates
    const [defaultPageHeight, setDefaultPageHeight] = useState(800); // Default placeholder height
    const [isBlinking, setIsBlinking] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState(null);

    const activeCommentRef = useRef(null);

    // Internal Ref if not provided
    const internalViewerRef = useRef(null);
    const viewerRef = externalViewerRef || internalViewerRef;

    // Hooks
    useClickOutside(activeCommentRef, activeComment, commentText, setActiveComment, setIsBlinking, side);



    // Single Page Refs
    const singlePageContainerRef = useRef(null);
    const renderTaskRef = useRef(null);
    const preRenderTaskRef = useRef(null); // Fix missing ref
    const preRenderCache = useRef({ page: null, scale: null, content: null });

    // Continuous Mode Refs
    const pageRefs = useRef({});
    const observerRef = useRef(null);
    const visiblePages = useRef(new Set());
    const preRenderingPages = useRef(new Set()); // Track pages currently being pre-rendered
    const idleCallbackRef = useRef(null); // Track idle callback for cleanup

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        scrollToPagePercent: (pageNum, percent, horizontalPercent = 0) => {
            if (viewMode === 'continuous' && pdf) {
                const pageEl = pageRefs.current[pageNum];
                const viewer = viewerRef.current;
                if (pageEl && viewer) {
                    const pageHeight = pageEl.clientHeight;
                    // Robust absolute top calculation: distance from viewer content start to page element
                    const viewerRect = viewer.getBoundingClientRect();
                    const pageRect = pageEl.getBoundingClientRect();
                    const top = pageRect.top - viewerRect.top + viewer.scrollTop;
                    const targetScrollTop = top + (pageHeight * percent);

                    // Horizontal Scroll
                    // Use direct assignment for robustness (matches Legacy/Single view logic)
                    viewer.scrollTop = targetScrollTop;

                    const maxScrollLeft = viewer.scrollWidth - viewer.clientWidth;
                    viewer.scrollLeft = maxScrollLeft * horizontalPercent;
                }
            } else if (viewMode === 'single') {
                if (pageNum !== page) setPage(pageNum);
                // Handle vertical and horizontal scrolling if zoomed
                if (viewerRef.current) {
                    const maxScrollTop = viewerRef.current.scrollHeight - viewerRef.current.clientHeight;
                    if (maxScrollTop > 0) viewerRef.current.scrollTop = maxScrollTop * percent;

                    const maxScrollLeft = viewerRef.current.scrollWidth - viewerRef.current.clientWidth;
                    if (maxScrollLeft > 0) viewerRef.current.scrollLeft = maxScrollLeft * horizontalPercent;
                }
            }
        },
        getGlobalScrollPosition: () => {
            if (viewMode === 'continuous' && pdf) {
                const viewer = viewerRef.current;
                if (!viewer) return (page - 1);

                const viewerRect = viewer.getBoundingClientRect();

                let activePage = page;
                let pagePercent = 0;
                let found = false;

                // Iterate to find the first page that is currently visible at the top
                for (let i = 1; i <= numPages; i++) {
                    const el = pageRefs.current[i];
                    if (el) {
                        const rect = el.getBoundingClientRect();
                        if (rect.bottom > viewerRect.top + 1) {
                            activePage = i;

                            if (rect.top > viewerRect.top) {
                                // pagePercent = 0; // Standard calculation below handles this now
                            } else {
                                const offset = viewerRect.top - rect.top;
                                pagePercent = offset / rect.height;
                            }
                            found = true;
                            break;
                        }
                    }
                }

                if (!found && numPages > 0) {
                    if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 5) {
                        activePage = numPages;
                        pagePercent = 1;
                    } else {
                        // Fallback to current prop state if not found (rare)
                        activePage = page;
                        pagePercent = 0;
                    }
                }

                // Metric: (Page - 1) + Percent
                // e.g. Page 1 Top = 0.0
                // Page 1 Bottom = 1.0 (approaching Page 2)
                return (activePage - 1) + pagePercent;
            }
            return (page - 1);
        },
        allowRemote: () => import.meta.env.VITE_ENABLE_REMOTE_PDFS !== 'false',
        triggerFitToPage: () => handleFitToPage(true)
    }));

    // Sync input value with prop page
    useEffect(() => {
        setPageInputValue(page.toString());
    }, [page]);

    // Sync zoom input with prop scale
    useEffect(() => {
        setZoomInputValue(Math.round(scale * 100).toString());
    }, [scale]);

    // --- Rendering Logic ---
    const renderPDFPage = async (pdfDoc, pageNum, container, currentScale, taskRef, isPreRender = false, cacheRef = null) => {
        if (!pdfDoc || (!isPreRender && !container) || !pdfjsLib) return false;

        // Use cached content if available
        if (!isPreRender && cacheRef && cacheRef.current.page === pageNum && cacheRef.current.scale === currentScale && cacheRef.current.content) {
            container.replaceChildren(...cacheRef.current.content);
            container.dataset.renderedScale = currentScale.toString();
            container.dataset.renderedPageNumber = pageNum.toString();
            const [cvs] = cacheRef.current.content;
            if (cvs) {
                container.dataset.renderedWidth = cvs.style.width;
                container.dataset.renderedHeight = cvs.style.height;
            }

            const [cvsEl, txt] = cacheRef.current.content;
            if (cvsEl) { cvsEl.style.visibility = ''; cvsEl.style.position = 'relative'; cvsEl.style.zIndex = ''; }
            if (txt) { txt.style.visibility = ''; txt.style.position = 'absolute'; txt.style.zIndex = ''; }

            cacheRef.current = { page: null, scale: null, content: null };
            return true;
        }

        if (taskRef?.current) {
            try {
                await taskRef.current.cancel();
            } catch { /* ignore cancellation */ }
        }

        try {
            const pageObj = await pdfDoc.getPage(pageNum);
            const viewport = pageObj.getViewport({ scale: currentScale });
            const outputScale = window.devicePixelRatio || 1;

            // Canvas size guard: 16MP limit
            const totalPixels = (viewport.width * outputScale) * (viewport.height * outputScale);
            if (totalPixels > 16777216) {
                throw new Error(`Canvas size guard: Page ${pageNum} is too large to render (${Math.round(totalPixels / 1000000)}MP). Please zoom out.`);
            }

            const newCanvas = document.createElement('canvas');
            newCanvas.className = 'pdf-page-canvas';
            newCanvas.style.display = 'block';

            const context = newCanvas.getContext('2d');
            newCanvas.width = Math.floor(viewport.width * outputScale);
            newCanvas.height = Math.floor(viewport.height * outputScale);
            newCanvas.style.width = Math.floor(viewport.width) + 'px';
            newCanvas.style.height = Math.floor(viewport.height) + 'px';
            newCanvas.style.visibility = 'hidden'; // Hide initially

            const newTextLayer = document.createElement('div');
            newTextLayer.className = 'textLayer';
            newTextLayer.style.width = Math.floor(viewport.width) + 'px';
            newTextLayer.style.height = Math.floor(viewport.height) + 'px';
            newTextLayer.style.setProperty('--scale-factor', currentScale.toString());
            newTextLayer.style.visibility = 'hidden';

            // Handle Pre-render (Off-screen)
            if (isPreRender) {
                const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
                const renderTask = pageObj.render({ canvasContext: context, viewport, transform });
                if (taskRef) taskRef.current = renderTask;
                await renderTask.promise;
                if (taskRef) taskRef.current = null;

                const textContent = await pageObj.getTextContent();
                if (pdfjsLib.TextLayer) {
                    await new pdfjsLib.TextLayer({ textContentSource: textContent, container: newTextLayer, viewport }).render();
                } else {
                    const tTask = pdfjsLib.renderTextLayer({ textContent, container: newTextLayer, viewport, textDivs: [] });
                    if (tTask.promise) await tTask.promise;
                }

                if (cacheRef) cacheRef.current = { page: pageNum, scale: currentScale, content: [newCanvas, newTextLayer] };
                return true;
            }

            // Overlay strategy for smooth swap
            container.style.position = 'relative';
            newCanvas.style.position = 'absolute';
            newCanvas.style.top = '0';
            newCanvas.style.left = '0';
            newCanvas.style.zIndex = '5'; // New on top

            newTextLayer.style.position = 'absolute';
            newTextLayer.style.top = '0';
            newTextLayer.style.left = '0';
            newTextLayer.style.zIndex = '6';

            container.appendChild(newCanvas);
            container.appendChild(newTextLayer);

            // Render canvas and text in parallel
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
            const renderTask = pageObj.render({ canvasContext: context, viewport, transform });

            if (taskRef) taskRef.current = renderTask;

            const textContentPromise = pageObj.getTextContent();

            const [_, textContent] = await Promise.all([
                renderTask.promise,
                textContentPromise
            ]);

            if (taskRef) taskRef.current = null;

            if (pdfjsLib.TextLayer) {
                await new pdfjsLib.TextLayer({ textContentSource: textContent, container: newTextLayer, viewport }).render();
            } else {
                const tTask = pdfjsLib.renderTextLayer({ textContent, container: newTextLayer, viewport, textDivs: [] });
                if (tTask.promise) await tTask.promise;
            }

            // Atomic swap
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    container.style.width = newCanvas.style.width;
                    container.style.height = newCanvas.style.height;
                    container.style.minWidth = newCanvas.style.width;
                    container.style.minHeight = newCanvas.style.height;

                    // Mark as rendered at this scale AND dimension
                    container.dataset.renderedScale = currentScale.toString();
                    container.dataset.renderedWidth = newCanvas.style.width;
                    container.dataset.renderedHeight = newCanvas.style.height;
                    container.dataset.renderedPageNumber = pageNum.toString();

                    container.replaceChildren(newCanvas, newTextLayer);

                    newCanvas.style.visibility = '';
                    newCanvas.style.position = 'relative';
                    newCanvas.style.top = '';
                    newCanvas.style.left = '';
                    newCanvas.style.zIndex = '';

                    newTextLayer.style.visibility = '';
                    newTextLayer.style.position = 'absolute';
                    newTextLayer.style.top = '0';
                    newTextLayer.style.left = '0';
                    newTextLayer.style.zIndex = '';

                    resolve();
                });
            });

            return true;

        } catch (error) {
            if (error.name !== 'RenderingCancelledException') {
                console.error('Error rendering page:', error);
            }
            return false;
        }
    };

    // --- Single Mode Rendering ---
    useEffect(() => {
        if (viewMode === 'single' && pdf && singlePageContainerRef.current) {
            renderPDFPage(pdf.doc, page, singlePageContainerRef.current, scale, renderTaskRef, false, preRenderCache).then(() => {
                if (page < numPages) {
                    renderPDFPage(pdf.doc, page + 1, null, scale, preRenderTaskRef, true, preRenderCache);
                }
                if (page > 1) {
                    renderPDFPage(pdf.doc, page - 1, null, scale, preRenderTaskRef, true, preRenderCache);
                }
            });
        }
    }, [viewMode, pdf, page, numPages]); // Remove scale - handled by transform effect below

    // --- Single Mode Transform Zoom ---
    // Exact same logic as continuous mode (lines 406-510) but for single container
    useEffect(() => {
        if (viewMode !== 'single' || !pdf) return;

        const viewer = viewerRef.current;
        const container = singlePageContainerRef.current;
        if (!viewer || !container) return;

        const renderedScale = parseFloat(container.dataset.renderedScale) || scale;

        if (renderedScale === scale) {
            const canvas = container.querySelector('canvas');
            const textLayer = container.querySelector('.textLayer');
            if (canvas) {
                canvas.style.transform = '';
                canvas.style.transformOrigin = '';
            }
            if (textLayer) {
                textLayer.style.transform = '';
                textLayer.style.transformOrigin = '';
            }
            if (container.dataset.renderedWidth && container.dataset.renderedHeight) {
                container.style.width = container.dataset.renderedWidth;
                container.style.height = container.dataset.renderedHeight;
                container.style.minWidth = container.dataset.renderedWidth;
                container.style.minHeight = container.dataset.renderedHeight;
            }
        } else {
            const ratio = scale / renderedScale;
            const canvas = container.querySelector('canvas');
            const textLayer = container.querySelector('.textLayer');

            const transform = `scale(${ratio})`;

            if (canvas) {
                canvas.style.transformOrigin = 'top left';
                canvas.style.transform = transform;
            }
            if (textLayer) {
                textLayer.style.transformOrigin = 'top left';
                textLayer.style.transform = transform;
            }

            // Resize container to match scaled size
            if (container.dataset.renderedWidth && container.dataset.renderedHeight) {
                const originalW = parseFloat(container.dataset.renderedWidth);
                const originalH = parseFloat(container.dataset.renderedHeight);
                if (!isNaN(originalW)) {
                    const newW = (originalW * ratio) + 'px';
                    const newH = (originalH * ratio) + 'px';
                    container.style.width = newW;
                    container.style.height = newH;
                    container.style.minWidth = newW;
                    container.style.minHeight = newH;
                }
            }
        }

        // Adjust scroll for zoom
        const previousPending = pendingScaleRef.current;
        if (previousPending > 0) {
            const scrollRatio = scale / previousPending;
            viewer.scrollTop *= scrollRatio;
            viewer.scrollLeft *= scrollRatio;
        }
        pendingScaleRef.current = scale;

        // Debounce re-render
        if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
        const targetScale = scale;

        zoomDebounceRef.current = setTimeout(() => {
            if (container) container.dataset.targetScale = targetScale.toString();
            // Trigger direct re-render (no observer needed for single page)
            renderPDFPage(pdf.doc, page, container, targetScale, renderTaskRef, false, preRenderCache).then(() => {
                delete container.dataset.targetScale;
            });
            zoomDebounceRef.current = null;
        }, 150);

    }, [viewMode, pdf, scale, viewerRef]);

    const zoomDebounceRef = useRef(null);
    const pendingScaleRef = useRef(scale);

    useEffect(() => {
        if (viewMode !== 'continuous' || !pdf) return;

        const viewer = viewerRef.current;
        if (!viewer) return;

        // Apply transforms per page
        for (let i = 1; i <= numPages; i++) {
            const container = pageRefs.current[i];
            if (container) {
                const renderedScale = parseFloat(container.dataset.renderedScale) || scale;

                if (renderedScale === scale) {
                    const canvas = container.querySelector('canvas');
                    const textLayer = container.querySelector('.textLayer');
                    if (canvas) {
                        canvas.style.transform = '';
                        canvas.style.transformOrigin = '';
                    }
                    if (textLayer) {
                        textLayer.style.transform = '';
                        textLayer.style.transformOrigin = '';
                    }
                    if (container.dataset.renderedWidth && container.dataset.renderedHeight) {
                        container.style.width = container.dataset.renderedWidth;
                        container.style.height = container.dataset.renderedHeight;
                        container.style.minWidth = container.dataset.renderedWidth;
                        container.style.minHeight = container.dataset.renderedHeight;
                    }
                } else {
                    const ratio = scale / renderedScale;
                    const canvas = container.querySelector('canvas');
                    const textLayer = container.querySelector('.textLayer');

                    const transform = `scale(${ratio})`;

                    if (canvas) {
                        canvas.style.transformOrigin = 'top left';
                        canvas.style.transform = transform;
                    }
                    if (textLayer) {
                        textLayer.style.transformOrigin = 'top left';
                        textLayer.style.transform = transform;
                    }

                    // Resize container to match scaled size
                    if (container.dataset.renderedWidth && container.dataset.renderedHeight) {
                        const originalW = parseFloat(container.dataset.renderedWidth);
                        const originalH = parseFloat(container.dataset.renderedHeight);
                        if (!isNaN(originalW)) {
                            const newW = (originalW * ratio) + 'px';
                            const newH = (originalH * ratio) + 'px';
                            container.style.width = newW;
                            container.style.height = newH;
                            container.style.minWidth = newW;
                            container.style.minHeight = newH;
                        }
                    }
                }
            }
        }

        // Adjust scroll
        const previousPending = pendingScaleRef.current;
        if (previousPending > 0) {
            const scrollRatio = scale / previousPending;
            viewer.scrollTop *= scrollRatio;
            viewer.scrollLeft *= scrollRatio;
        }
        pendingScaleRef.current = scale;

        // Debounce re-render
        if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
        const targetScale = scale;

        zoomDebounceRef.current = setTimeout(() => {
            // Mark pages
            for (let i = 1; i <= numPages; i++) {
                const container = pageRefs.current[i];
                if (container) container.dataset.targetScale = targetScale.toString();
            }

            // Trigger Observer
            if (observerRef.current) {
                observerRef.current.disconnect();
                requestAnimationFrame(() => {
                    for (let i = 1; i <= numPages; i++) {
                        const el = pageRefs.current[i];
                        if (el && observerRef.current) observerRef.current.observe(el);
                    }
                });
            }
            zoomDebounceRef.current = null;
        }, 150);

    }, [viewMode, pdf, numPages, scale, viewerRef]);

    // --- Continuous Mode Rendering ---
    const renderPageInContinuous = useCallback(async (pageNum) => {
        const container = pageRefs.current[pageNum];
        if (!container || !pdf) return;

        const needsRerender = container.dataset.targetScale !== undefined;
        if (container.hasChildNodes() && !needsRerender) return;

        const taskRef = { current: null };
        const success = await renderPDFPage(pdf.doc, pageNum, container, scale, taskRef);

        if (success) {
            delete container.dataset.targetScale;

            // Handle scale drift if UI scale changed during render
            if (scale !== pendingScaleRef.current) {
                const rendered = parseFloat(container.dataset.renderedScale);
                const ratio = pendingScaleRef.current / rendered;

                const canvas = container.querySelector('canvas');
                const textLayer = container.querySelector('.textLayer');
                if (canvas) {
                    canvas.style.transformOrigin = 'top left';
                    canvas.style.transform = `scale(${ratio})`;
                }
                if (textLayer) {
                    textLayer.style.transformOrigin = 'top left';
                    textLayer.style.transform = `scale(${ratio})`;
                }

                // Resize container for drift
                if (container.dataset.renderedWidth && container.dataset.renderedHeight) {
                    const originalW = parseFloat(container.dataset.renderedWidth);
                    const originalH = parseFloat(container.dataset.renderedHeight);
                    if (!isNaN(originalW)) {
                        const newW = (originalW * ratio) + 'px';
                        const newH = (originalH * ratio) + 'px';
                        container.style.width = newW;
                        container.style.height = newH;
                        container.style.minWidth = newW;
                        container.style.minHeight = newH;
                    }
                }
            }
        }

        preRenderingPages.current.delete(pageNum);
    }, [pdf, scale]);

    // Pre-render nearby pages during idle time
    const schedulePreRender = useCallback((centerPage) => {
        if (!pdf) return;

        // Cancel any pending idle callback
        if (idleCallbackRef.current) {
            cancelIdleCallback(idleCallbackRef.current);
        }

        // Determine pages to pre-render (3 ahead, 2 behind)
        const pagesToPreRender = [];
        for (let offset = 1; offset <= 3; offset++) {
            const ahead = centerPage + offset;
            const behind = centerPage - offset;
            if (ahead <= numPages) pagesToPreRender.push(ahead);
            if (behind >= 1 && offset <= 2) pagesToPreRender.push(behind);
        }

        // Filter out already visible, already rendered, or currently pre-rendering pages
        const filtered = pagesToPreRender.filter(p => {
            const container = pageRefs.current[p];
            return container &&
                !container.hasChildNodes() &&
                !visiblePages.current.has(p) &&
                !preRenderingPages.current.has(p);
        });

        if (filtered.length === 0) return;

        // Schedule pre-rendering during idle time
        idleCallbackRef.current = requestIdleCallback((deadline) => {
            for (const pageNum of filtered) {
                if (deadline.timeRemaining() < 10) break;
                if (pageRefs.current[pageNum]?.hasChildNodes()) continue;

                preRenderingPages.current.add(pageNum);
                renderPageInContinuous(pageNum);
            }
            idleCallbackRef.current = null;
        }, { timeout: 1000 });
    }, [pdf, numPages, renderPageInContinuous]);

    useEffect(() => {
        if (viewMode !== 'continuous' || !pdf) {
            if (observerRef.current) {
                observerRef.current.disconnect();
                observerRef.current = null;
            }
            return;
        }

        if (observerRef.current) observerRef.current.disconnect();

        observerRef.current = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const pageNum = parseInt(entry.target.dataset.page);
                if (entry.isIntersecting) {
                    visiblePages.current.add(pageNum);
                    renderPageInContinuous(pageNum);
                    schedulePreRender(pageNum);
                } else {
                    visiblePages.current.delete(pageNum);
                    // Clear off-screen pages (memory optimization)
                    const container = entry.target;
                    if (container && container.hasChildNodes()) {
                        const currentHeight = container.offsetHeight;
                        const currentWidth = container.offsetWidth;
                        container.innerHTML = '';
                        container.style.minHeight = `${currentHeight}px`;
                        container.style.minWidth = `${currentWidth}px`;
                    }
                }
            });
        }, {
            root: viewerRef.current,
            rootMargin: '200% 0px 200% 0px',
            threshold: 0
        });

        for (let i = 1; i <= numPages; i++) {
            const el = pageRefs.current[i];
            if (el) observerRef.current.observe(el);
        }

        return () => {
            if (observerRef.current) observerRef.current.disconnect();
            if (idleCallbackRef.current) cancelIdleCallback(idleCallbackRef.current);
        };
    }, [viewMode, pdf, numPages, renderPageInContinuous, schedulePreRender, scale, viewerRef]);

    // --- Maintain page position when switching to continuous view ---
    useEffect(() => {
        if (viewMode === 'continuous' && pdf) {
            // Use requestAnimationFrame to ensure the list of pages is rendered in the DOM
            // so that pageRefs.current[page] is available for scrollIntoView.
            requestAnimationFrame(() => {
                if (pageRefs.current[page] && viewerRef.current) {
                    pageRefs.current[page].scrollIntoView({ behavior: 'auto', block: 'start' });
                }
            });
        }
    }, [viewMode, pdf]); // Trigger when viewMode changes to continuous

    // --- Continuous Scroll Handler ---
    const handleScrollInternal = (e) => {
        // Calculate detailed scroll info for sync
        let scrollInfo = null;

        if (viewMode === 'continuous' && pdf) {
            const viewer = e.target;
            const viewerRect = viewer.getBoundingClientRect();

            let topMostPage = page;
            let topMostPagePercent = 0;
            let foundTopMost = false;

            let mostVisiblePage = page;
            let maxVisibleHeight = -1;

            // Iterate to find the first page available and the one with the most visibility
            for (let i = 1; i <= numPages; i++) {
                const el = pageRefs.current[i];
                if (el) {
                    const rect = el.getBoundingClientRect();

                    // Calculate visible overlap with viewport
                    const visibleTop = Math.max(viewerRect.top, rect.top);
                    const visibleBottom = Math.min(viewerRect.bottom, rect.bottom);
                    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

                    // Check for most visible
                    if (visibleHeight > maxVisibleHeight) {
                        maxVisibleHeight = visibleHeight;
                        mostVisiblePage = i;
                    }

                    // Logic for Top-Most (Sync Reference)
                    // We use +5 tolerance for "at top" to catch page transitions smoothly
                    if (!foundTopMost && rect.bottom > viewerRect.top + 5) {
                        topMostPage = i;
                        if (rect.top > viewerRect.top) {
                            topMostPagePercent = 0;
                        } else {
                            const offset = viewerRect.top - rect.top;
                            topMostPagePercent = Math.max(0, Math.min(1, offset / rect.height));
                        }
                        foundTopMost = true;
                    }
                }
            }

            // Update visible page state if the most visible one changed
            if (mostVisiblePage !== page) {
                setPage(mostVisiblePage);
            }

            // Synchronization info is ALWAYS based on the top-most page to ensure sides align correctly
            scrollInfo = { page: topMostPage, percent: topMostPagePercent };
        }

        if (onScroll) onScroll(e, side, scrollInfo);
    };

    const scrollToPage = (targetPage) => {
        if (viewMode === 'continuous' && pageRefs.current[targetPage]) {
            pageRefs.current[targetPage].scrollIntoView({ behavior: 'auto', block: 'start' });
        } else {
            setPage(targetPage);
        }
    };

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
            if (viewMode === 'continuous') scrollToPage(val);
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

    const handleFitToPage = async (isFromSync = false) => {
        if (!pdf || !viewerRef.current) return;
        try {
            const pageObj = await pdf.doc.getPage(page);
            const viewport = pageObj.getViewport({ scale: 1.0 });

            const viewer = viewerRef.current;
            const style = window.getComputedStyle(viewer);
            const borderX = parseFloat(style.borderLeftWidth || 0) + parseFloat(style.borderRightWidth || 0);
            const borderY = parseFloat(style.borderTopWidth || 0) + parseFloat(style.borderBottomWidth || 0);

            // Buffer: 4px for safety
            const buffer = 4;

            // Use clientWidth: This is the actual visible area EXCLUDING scrollbars.
            // Using offsetWidth causes landscape PDFs to be clipped by the vertical scrollbar (~15-20px).
            // We ignore padding in the calculation as requested to maximize zoom.
            const availableWidth = viewer.clientWidth - buffer;
            const availableHeight = viewer.clientHeight - buffer;

            const horizontalScale = availableWidth / viewport.width;
            const verticalScale = availableHeight / viewport.height;

            const newScale = Math.min(horizontalScale, verticalScale);
            // Clamp to limits, and pass false to disable sync
            setScale(Math.min(Math.max(0.25, newScale), 3), false);

            // If sync is on and this wasn't triggered BY a sync, notify parent to trigger other side
            if (!isFromSync && syncScroll && onFitToPage) {
                onFitToPage(side);
            }
        } catch (e) {
            console.error("Fit to page failed", e);
        }
    };

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
    }, [setScale, viewerRef, pdf]);

    useEffect(() => {
        const handleDocumentSelectionChange = () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                setSelectionBtn({ show: false, x: 0, y: 0 });
            }
        };
        document.addEventListener('selectionchange', handleDocumentSelectionChange);
        return () => document.removeEventListener('selectionchange', handleDocumentSelectionChange);
    }, []);

    const handleMouseUp = () => {
        setIsDragging(false);
        if (!pdf) return;

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);

            let targetContainer = range.commonAncestorContainer;
            if (targetContainer.nodeType === 3) targetContainer = targetContainer.parentNode;

            let pageNumFound = null;
            let pageContainer = null;

            if (viewMode === 'single') {
                if (singlePageContainerRef.current && singlePageContainerRef.current.contains(targetContainer)) {
                    pageNumFound = page;
                    pageContainer = singlePageContainerRef.current;
                }
            } else {
                for (let i = 1; i <= numPages; i++) {
                    if (pageRefs.current[i] && pageRefs.current[i].contains(targetContainer)) {
                        pageNumFound = i;
                        pageContainer = pageRefs.current[i];
                        break;
                    }
                }
            }

            if (pageContainer) {
                const rect = range.getBoundingClientRect();
                const containerRect = pageContainer.getBoundingClientRect();

                const anchorX = ((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100;
                const anchorY = ((rect.bottom - containerRect.top) / containerRect.height) * 100;

                const highlightRect = {
                    left: ((rect.left - containerRect.left) / containerRect.width) * 100,
                    top: ((rect.top - containerRect.top) / containerRect.height) * 100,
                    right: ((rect.right - containerRect.left) / containerRect.width) * 100,
                    bottom: ((rect.bottom - containerRect.top) / containerRect.height) * 100,
                    width: (rect.width / containerRect.width) * 100,
                    height: (rect.height / containerRect.height) * 100,
                };

                const clientRects = range.getClientRects();
                const rawRects = Array.from(clientRects).map(r => ({
                    left: ((r.left - containerRect.left) / containerRect.width) * 100,
                    top: ((r.top - containerRect.top) / containerRect.height) * 100,
                    right: ((r.right - containerRect.left) / containerRect.width) * 100,
                    bottom: ((r.bottom - containerRect.top) / containerRect.height) * 100,
                    width: (r.width / containerRect.width) * 100,
                    height: (r.height / containerRect.height) * 100,
                }));

                const mergeRects = (rects) => {
                    if (rects.length <= 1) return rects;

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

                            // Calculate a dynamic threshold based on the line height (roughly 1.5em)
                            // We need to convert height (which is in % of page height) to % of page width
                            // to compare with horizontal coordinates.
                            const aspectRatio = containerRect.height / containerRect.width;
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
                };

                const highlightRects = mergeRects(rawRects);

                setSelectionBtn({
                    show: true,
                    x: anchorX,
                    y: anchorY,
                    page: pageNumFound,
                    highlightRect: highlightRect,
                    highlightRects: highlightRects,
                    selectedText: selection.toString(),
                });
            }
        }
    };

    const extractPageText = async (pageNum) => {
        try {
            const pageObj = await pdf.doc.getPage(pageNum);
            const content = await pageObj.getTextContent(); // Default (false) to match DOM spans

            let text = "";
            const charMap = []; // Maps char index to item index
            let lastItem = null;

            for (let j = 0; j < content.items.length; j++) {
                const item = content.items[j];
                if (!item.str && item.str.length === 0) continue;

                if (lastItem) {
                    const isSameLine = Math.abs(item.transform[5] - lastItem.transform[5]) < (item.height || 10) * 0.5;
                    const gap = item.transform[4] - (lastItem.transform[4] + lastItem.width);

                    const significantGap = gap > (item.height || 10) * 0.12;
                    const alreadyHasSpace = lastItem.str.endsWith(' ') || item.str.startsWith(' ');

                    if (!isSameLine || (significantGap && !alreadyHasSpace)) {
                        text += " ";
                        charMap.push(-1); // Map space to -1
                    }
                }

                for (let k = 0; k < item.str.length; k++) {
                    charMap.push(j);
                }
                text += item.str;
                lastItem = item;
            }

            return {
                pageNum: pageNum,
                text,
                charMap
            };
        } catch (err) {
            console.error(`Page ${pageNum} text extraction failed`, err);
            return null;
        }
    };



    // Lazy coordinate fetching - only called when navigating to a result
    const getResultRect = async (pageNum, query, posInText) => {
        if (!pdf) return null;
        try {
            const pageObj = await pdf.doc.getPage(pageNum);
            const content = await pageObj.getTextContent({ normalizeWhitespace: true });
            const viewport = pageObj.getViewport({ scale: 1.0 });

            // Rebuild text and mapping for this page using EXACT SAME logic as extractAllText
            let text = "";
            let itemIndexAtPos = -1;
            let offsetInItem = -1;
            let charIndex = 0;
            let lastItem = null;

            for (let i = 0; i < content.items.length; i++) {
                const item = content.items[i];
                if (!item.str && item.str.length === 0) continue;

                if (lastItem) {
                    const isSameLine = Math.abs(item.transform[5] - lastItem.transform[5]) < (item.height || 10) * 0.5;
                    const gap = item.transform[4] - (lastItem.transform[4] + lastItem.width);

                    const significantGap = gap > (item.height || 10) * 0.12;
                    const alreadyHasSpace = lastItem.str.endsWith(' ') || item.str.startsWith(' ');

                    if (!isSameLine || (significantGap && !alreadyHasSpace)) {
                        if (charIndex === posInText) {
                            // Match starts on the space we inserted!
                            // We'll jump to the next character's item
                            itemIndexAtPos = i;
                            offsetInItem = 0;
                        }
                        charIndex++;
                        text += " ";
                    }
                }

                if (posInText >= charIndex && posInText < charIndex + item.str.length) {
                    itemIndexAtPos = i;
                    offsetInItem = posInText - charIndex;
                }

                charIndex += item.str.length;
                text += item.str;
                lastItem = item;

                if (itemIndexAtPos !== -1) {
                    const matchedItem = content.items[itemIndexAtPos];
                    const x = matchedItem.transform[4];
                    const y = matchedItem.transform[5];
                    const h = matchedItem.height || Math.abs(matchedItem.transform[0]) || Math.abs(matchedItem.transform[3]) || 10;
                    const w = matchedItem.width;

                    const queryLen = Math.min(query.length, matchedItem.str.length - offsetInItem);

                    // Linear estimation of character positions
                    const subXOffset = (offsetInItem / matchedItem.str.length) * w;
                    const subWidth = (queryLen / matchedItem.str.length) * w;

                    return {
                        left: ((x + subXOffset) / viewport.width) * 100,
                        top: ((viewport.height - (y + h)) / viewport.height) * 100,
                        width: (subWidth / viewport.width) * 100,
                        height: (h / viewport.height) * 100
                    };
                }
            }
            return null;
        } catch (err) {
            console.error("Failed to get result coordinates", err);
            return null;
        }
    };

    const performSearch = async (query, isNext = false) => {
        if (!query.trim()) {
            setSearchResults([]);
            setCurrentResultIndex(-1);
            return;
        }

        // NAVIGATION ONLY
        if (isNext) {
            // Use refs to get current values (avoids stale state with rapid keypresses)
            const results = searchResultsRef.current;
            if (results.length > 0) {
                const currentIdx = currentResultIndexRef.current;
                const nextIndex = (currentIdx + 1) % results.length;
                userNavigatedRef.current = true; // Mark as explicit navigation
                setCurrentResultIndex(nextIndex);
                selectedResultIdRef.current = { page: results[nextIndex].page, pos: results[nextIndex].pos };

                // Reuse existing page data from cache if possible
                const pageData = extractedText?.pages?.find(p => p.pageNum === results[nextIndex].page);
                navigateToResult(results[nextIndex], results[nextIndex].query, pageData);
            }
            return;
        }

        // NEW SEARCH
        const searchId = ++activeSearchRef.current;
        setSearchResults([]);
        setCurrentResultIndex(-1);
        selectedResultIdRef.current = null; // Reset selected identity
        setIsSearching(true);

        // Ensure cache structure
        let currentCache = extractedText || { pages: [] };
        if (!extractedText) setExtractedText(currentCache);

        const lowerQuery = query.toLowerCase();

        // Proximity Order: Start from current page -> end, then 1 -> current page - 1
        const searchOrder = [];
        for (let i = page; i <= numPages; i++) searchOrder.push(i);
        for (let i = 1; i < page; i++) searchOrder.push(i);

        try {
            for (const i of searchOrder) {
                if (activeSearchRef.current !== searchId) return; // Cancelled

                // Check Cache
                let pageData = currentCache.pages.find(p => p.pageNum === i);
                if (!pageData) {
                    pageData = await extractPageText(i);
                    if (pageData) {
                        currentCache.pages.push(pageData);
                    }
                }

                if (!pageData) continue;

                // Search logic (same as before)
                const newResults = [];
                let pos = pageData.text.toLowerCase().indexOf(lowerQuery);
                let occurrence = 0;

                while (pos !== -1) {
                    const start = Math.max(0, pos - 40);
                    const end = Math.min(pageData.text.length, pos + query.length + 40);
                    const snippet = pageData.text.substring(start, end);

                    // Calculate exact item range
                    let startItemIndex = -1;
                    let endItemIndex = -1;
                    if (pageData.charMap) {
                        startItemIndex = pageData.charMap[pos];
                        endItemIndex = pageData.charMap[pos + query.length - 1];

                        // If either is -1 (a space we inserted), try nudging
                        if (startItemIndex === -1 && pageData.charMap[pos + 1] !== undefined) startItemIndex = pageData.charMap[pos + 1];
                        if (endItemIndex === -1 && pageData.charMap[pos + query.length - 2] !== undefined) endItemIndex = pageData.charMap[pos + query.length - 2];
                    }

                    newResults.push({
                        page: pageData.pageNum,
                        snippet: snippet,
                        pos: pos,
                        query: query, // Store the exact query used for this search
                        queryStart: pos - start,
                        queryEnd: pos - start + query.length,
                        startItemIndex,
                        endItemIndex,
                        occurrenceOnPage: occurrence
                    });
                    pos = pageData.text.toLowerCase().indexOf(lowerQuery, pos + 1);
                    occurrence++;
                }

                if (newResults.length > 0) {
                    if (activeSearchRef.current !== searchId) return;
                    setSearchResults(prev => {
                        // 1. Combine and Sort
                        const combined = [...prev, ...newResults];
                        combined.sort((a, b) => {
                            if (a.page !== b.page) return a.page - b.page;
                            return a.pos - b.pos;
                        });

                        // 2. Find the index of the currently selected result by identity
                        let newIndex = -1;
                        const selectedId = selectedResultIdRef.current;
                        if (selectedId) {
                            newIndex = combined.findIndex(r => r.page === selectedId.page && r.pos === selectedId.pos);
                        }

                        // 3. Auto-select first result if we had no selection and this is the first batch
                        if (newIndex === -1 && prev.length === 0 && newResults.length > 0) {
                            const firstFound = newResults[0];
                            selectedResultIdRef.current = { page: firstFound.page, pos: firstFound.pos };
                            newIndex = combined.findIndex(r => r.page === firstFound.page && r.pos === firstFound.pos);
                            setTimeout(() => navigateToResult(firstFound, firstFound.query || query, pageData), 0);
                        }

                        // 4. Update state index only for first result auto-selection
                        // Skip during batch updates to prevent scroll jitter
                        if (newIndex !== -1 && prev.length === 0) {
                            setCurrentResultIndex(newIndex);
                        }

                        return combined;
                    });
                }

                // Yield to UI
                await new Promise(r => setTimeout(r, 0));
            }

            // Final cache update to be sure
            if (activeSearchRef.current === searchId) {
                setExtractedText({ ...currentCache });
            }

        } catch (err) {
            console.error("Progressive search failed", err);
        } finally {
            if (activeSearchRef.current === searchId) {
                setIsSearching(false);
            }
        }
    };

    const navigateToResult = async (result, query, pageData = null) => {
        // Set navigation guard - increment version counter to cancel any in-flight attempts
        const navVersion = ++activeNavigationRef.current;

        // Clear previous highlights only on the target page's container
        let prevContainer = viewMode === 'continuous'
            ? pageRefs.current[result.page]
            : singlePageContainerRef.current?.closest('.pdf-page-container');

        // FALLBACK: If container ref is missing or not visible in continuous mode, try to scroll viewer to that page first
        if (viewMode === 'continuous') {
            const selector = `.pdf-page-container[data-page-number="${result.page}"]`;
            let el = pageRefs.current[result.page] || document.querySelector(selector);

            if (el) {
                prevContainer = el;
                pageRefs.current[result.page] = el; // update ref

                // Smart Scroll: Only scroll container if we suspect text layer isn't rendered or element is far off
                const textLayer = el.querySelector('.textLayer');
                if (!textLayer || textLayer.children.length === 0) {
                    // Scroll to trigger virtualization/render
                    el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                }
            } else {
                console.warn('[Nav] Container not found for page', result.page);
            }
        }

        if (prevContainer) {
            prevContainer.querySelectorAll('.search-highlight').forEach(el => {
                const parent = el.parentNode;
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
            });
        }

        // Set page tracking
        setPage(result.page);



        // Note: We don't scroll here - attemptHighlight will scroll directly to the result


        // Wait for render/text layer to settle, then highlight with retry
        const attemptHighlight = (retryCount = 0) => {
            // NOTE: No guard needed - each navigation clears previous highlights at start,
            // so the last highlight to complete will naturally be the visible one.

            let container = null;

            if (viewMode === 'continuous') {
                container = pageRefs.current[result.page];
                // Validate page number using data-page (consistent with JSX rendering)
                if (container) {
                    const pageNum = parseInt(container.getAttribute('data-page'), 10);
                    if (isNaN(pageNum) || pageNum !== result.page) {
                        container = null;
                    }
                }
            } else {
                // Single page mode - the container has data-page attribute (not data-page-number)
                if (singlePageContainerRef.current) {
                    const tempContainer = singlePageContainerRef.current?.closest('.pdf-page-container');
                    if (tempContainer) {
                        // Single page uses data-page attribute
                        const pageAttr = tempContainer.getAttribute('data-page');
                        if (pageAttr !== null && parseInt(pageAttr, 10) === result.page) {
                            container = tempContainer;
                        }
                    }
                }
            }

            // Fallback to selector (with both attribute names)
            if (!container) {
                container = document.querySelector(`.pdf-page-container[data-page-number="${result.page}"]`) ||
                    document.querySelector(`.pdf-page-container[data-page="${result.page}"]`);
            }

            if (!container) {
                if (retryCount < 20) {
                    const delay = retryCount < 5 ? 50 : 150;
                    setTimeout(() => attemptHighlight(retryCount + 1), delay);
                }
                return;
            }

            const textLayer = container.querySelector('.textLayer');
            if (!textLayer) {
                if (retryCount < 20) {
                    const delay = retryCount < 5 ? 50 : 150;
                    setTimeout(() => attemptHighlight(retryCount + 1), delay);
                }
                return;
            }

            const spans = Array.from(textLayer.children);

            // If no spans yet, retry (text layer not rendered)
            if (spans.length === 0) {
                if (retryCount < 20) {
                    const delay = retryCount < 5 ? 50 : 150;
                    setTimeout(() => attemptHighlight(retryCount + 1), delay);
                }
                return;
            }

            // Use the query stored in the result object to avoid stale closures
            const queryClean = (result.query || query).toLowerCase().trim();

            // Use passed pageData or fall back to extractedText state
            const effectivePageData = pageData || extractedText?.pages?.find(p => p.pageNum === result.page);
            if (!effectivePageData || !effectivePageData.charMap) {
                return;
            }

            const targetPageText = effectivePageData.text;

            // Build domFullText directly from DOM spans (not from extracted text)
            // This ensures character positions match the actual DOM structure
            let domFullText = '';
            const domSpanMap = []; // Maps char index in domFullText to { spanIndex, offsetInSpan }

            for (let i = 0; i < spans.length; i++) {
                const spanText = spans[i].textContent || '';
                for (let j = 0; j < spanText.length; j++) {
                    domSpanMap.push({ spanIndex: i, offsetInSpan: j });
                }
                domFullText += spanText;
            }

            // CRITICAL: Verify DOM text layer is for the correct page
            // In single page mode, the container might have correct data-page attribute
            // but the text layer might still be showing old content during re-render

            // 1. Check explicit tag (most reliable)
            // Use textLayer.parentElement to ensure we check the actual rendered container, not a wrapper
            const renderedPageNum = parseInt(textLayer.parentElement.dataset.renderedPageNumber, 10);
            if (!isNaN(renderedPageNum) && renderedPageNum !== result.page) {
                if (retryCount < 20) { // Keep trying until the correct page renders
                    // Fast retry - we know it's the wrong page
                    const delay = retryCount < 5 ? 50 : 150;
                    setTimeout(() => attemptHighlight(retryCount + 1), delay);
                    return;
                }
            }

            // 2. Text comparison (Fallback)
            const normalize = (s) => s.replace(/\s+/g, '').toLowerCase();
            // Compare a smaller chunk to avoid issues with dynamic content further down
            const domFirst50 = normalize(domFullText.substring(0, 50));
            const extractFirst50 = normalize(targetPageText.substring(0, 50));

            // Fuzzy match: check if one contains the other (handles partial rendering or extra header text)
            // Or strict match of first 20 chars
            const domPrefix = domFirst50.substring(0, 20);
            const extractPrefix = extractFirst50.substring(0, 20);
            const isMatch = domFirst50.includes(extractPrefix) || extractFirst50.includes(domPrefix);

            if (!isMatch && domPrefix.length > 5 && extractPrefix.length > 5) {
                // Text layer is stale - still showing different page content
                if (retryCount < 5) {
                    // Reduce from 20 to 5 to avoid long delays on false positives
                    setTimeout(() => attemptHighlight(retryCount + 1), 50);
                    return;
                }
            }

            // --- STRATEGY EXECUTION ---
            // We use 3 cascading strategies to find the text match in the DOM.
            // This is necessary because PDF.js rendering often differs from extracted text (missing spaces, dropped chars).

            // Compare full texts to see if we can use the fast path
            const exactMatch = targetPageText === domFullText;




            const lowerDomText = domFullText.toLowerCase();
            const queryLower = queryClean.toLowerCase();
            const snippetLower = (result.snippet || '').toLowerCase().replace(/\s+/g, ' ').trim();

            let matchCharPos = -1;

            // STRATEGY 1: Direct Position (Best Case / Happy Path)
            // If the extracted text and DOM text are identical (or very close), we trust the `result.pos` index.
            // This is the fastest and most accurate method.
            const lengthsClose = Math.abs(targetPageText.length - domFullText.length) < 50;

            if (exactMatch || lengthsClose) {
                // Direct position from search - guaranteed accurate when texts match
                if (result.pos >= 0 && result.pos < domFullText.length) {
                    // Verify the query is actually at this position in DOM text
                    const foundQuery = lowerDomText.substring(result.pos, result.pos + queryLower.length);
                    if (foundQuery === queryLower) {
                        matchCharPos = result.pos;
                    }
                }
            }

            // STRATEGY 2: Anchor-based Snippet Matching (Robust Fallback)
            // If text layers differ (rendering artifacts, extra whitespace), absolute positions will be wrong.
            // We use unique phrases BEFORE and AFTER the match ("anchors") to locate the correct occurrence
            // within the dirty DOM text.
            if (matchCharPos === -1 && snippetLower.length > queryLower.length + 5) {
                const queryPosInSnippet = snippetLower.indexOf(queryLower);
                if (queryPosInSnippet !== -1) {
                    // Get unique anchor text: ~25 chars before query and ~25 chars after
                    const beforeAnchor = snippetLower.substring(Math.max(0, queryPosInSnippet - 25), queryPosInSnippet).trim();
                    const afterAnchor = snippetLower.substring(queryPosInSnippet + queryLower.length, queryPosInSnippet + queryLower.length + 25).trim();

                    // Normalize function - remove all whitespace for comparison
                    const normalize = (s) => s.replace(/\s+/g, '');


                    // Search DOM text for query occurrences and find the one with matching anchors
                    // Since anchors can be similar for close-together results, we use occurrence counting
                    // among the anchor-matched positions
                    let searchPos = 0;
                    let anchorMatchCount = 0;
                    const targetOccurrence = result.occurrenceOnPage || 0;

                    while (searchPos < lowerDomText.length) {
                        const pos = lowerDomText.indexOf(queryLower, searchPos);
                        if (pos === -1) break;

                        // Check surrounding text in DOM (wider context)
                        const domBefore = lowerDomText.substring(Math.max(0, pos - 35), pos);
                        const domAfter = lowerDomText.substring(pos + queryLower.length, pos + queryLower.length + 35);

                        // Normalize and compare - use longer matching strings for uniqueness
                        const normalizedBefore = normalize(beforeAnchor.slice(-15));
                        const normalizedAfter = normalize(afterAnchor.slice(0, 15));
                        const normalizedDomBefore = normalize(domBefore);
                        const normalizedDomAfter = normalize(domAfter);

                        // Flexible matching: check if normalized anchors appear in normalized DOM context
                        const beforeMatch = !beforeAnchor || beforeAnchor.length < 3 || normalizedDomBefore.includes(normalizedBefore);
                        const afterMatch = !afterAnchor || afterAnchor.length < 3 || normalizedDomAfter.includes(normalizedAfter);

                        if (beforeMatch && afterMatch) {
                            // This is an anchor match - check if it's the occurrence we want
                            if (anchorMatchCount === targetOccurrence) {
                                matchCharPos = pos;
                                break;
                            }
                            anchorMatchCount++;
                        }
                        searchPos = pos + 1;
                    }

                    if (matchCharPos === -1) {
                        // Fall through to Strategy 3
                    }
                }
            }

            // STRATEGY 3: Occurrence Counting (Last Resort)
            // If anchors fail (e.g. text is too short or repetitive), we fall back to simple counting.
            // If this is the 3rd "Review" in extracted text, we highlight the 3rd "Review" in DOM.
            if (matchCharPos === -1) {
                const targetOccurrence = result.occurrenceOnPage || 0;
                let foundCount = 0;
                let searchPos = 0;

                while (searchPos < lowerDomText.length) {
                    const pos = lowerDomText.indexOf(queryLower, searchPos);
                    if (pos === -1) break;
                    if (foundCount === targetOccurrence) {
                        matchCharPos = pos;
                        break;
                    }
                    foundCount++;
                    searchPos = pos + 1;
                }
            }

            // CRITICAL: Verify the query actually exists at the matched position
            // This prevents highlighting wrong text like "rev" when searching for "review"
            if (matchCharPos !== -1) {
                const atPosition = lowerDomText.substring(matchCharPos, matchCharPos + queryLower.length);
                if (atPosition !== queryLower) {
                    matchCharPos = -1; // Reset and try fallback
                }
            }

            if (matchCharPos === -1) {
                return;
            }

            // Now use domSpanMap instead of the old spanMap



            // Find all spans covered by this match using domSpanMap
            let currentSpanIdx = -1;
            let ranges = []; // { spanIndex, start, end }

            for (let i = 0; i < queryClean.length; i++) {
                const charPos = matchCharPos + i;
                // Skip if out of bounds
                if (charPos >= domSpanMap.length) continue;

                const info = domSpanMap[charPos];
                if (!info) continue;

                if (info.spanIndex !== currentSpanIdx) {
                    // New span started
                    ranges.push({
                        spanIndex: info.spanIndex,
                        start: info.offsetInSpan,
                        end: info.offsetInSpan + 1
                    });
                    currentSpanIdx = info.spanIndex;
                } else {
                    // Continue current span
                    ranges[ranges.length - 1].end = info.offsetInSpan + 1;
                }
            }

            // Apply highlights to all affected spans
            ranges.forEach((range, idx) => {
                const span = spans[range.spanIndex];
                if (!span) return;

                // If this span was already modified by a previous range in this loop (rare but possible with overlaps),
                // we might need to be careful. But for a single search result, ranges shouldn't overlap on the same span 
                // in a conflicting way (they are sequential).
                // HOWEVER: If we have multiple highlights on the same page, we need to handle that.
                // For now, we clear highlights at the start of navigateToResult, so we assume fresh spans.

                const txt = span.textContent;
                const before = txt.substring(0, range.start);
                const match = txt.substring(range.start, range.end);
                const after = txt.substring(range.end);

                const frag = document.createDocumentFragment();
                if (before) frag.appendChild(document.createTextNode(before));
                const mark = document.createElement('mark');
                mark.className = 'search-highlight';
                mark.style.cssText = 'background: rgba(0, 100, 255, 0.5); color: inherit; padding: 0; border-radius: 0;';
                mark.textContent = match;
                frag.appendChild(mark);
                if (after) frag.appendChild(document.createTextNode(after));

                span.replaceChildren(frag);

                // Scroll to the first span
                if (idx === 0) {
                    mark.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
                }
            });
        };

        // Start the highlight attempt after initial delay
        // Single page mode needs more time for page render after setPage
        // Start the highlight attempt fast!
        // Single page mode might need a moment for React/DOM to settle, but we want to catch it ASAP.
        // We'll use a fast initial poll.
        setTimeout(() => attemptHighlight(0), 10);
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Enter') {
            performSearch(searchQuery, true);
        } else if (e.key === 'Escape') {
            setShowSearch(false);
        }
    };

    useEffect(() => {
        if (showSearch && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [showSearch]);

    // Auto-scroll the current result into view in the search results list
    // Only triggers on explicit user navigation, not during batch loading
    useEffect(() => {
        if (userNavigatedRef.current && currentResultIndex >= 0 && searchResultRefs.current[currentResultIndex]) {
            searchResultRefs.current[currentResultIndex].scrollIntoView({
                behavior: 'auto',
                block: 'nearest'
            });
            userNavigatedRef.current = false; // Reset after scrolling
        }
    }, [currentResultIndex]);

    useEffect(() => {
        setExtractedText(null);
        setSearchResults([]);
        setCurrentResultIndex(-1);
        setShowSearch(false);
        setSearchQuery('');
    }, [pdf]);

    // Calculate default page height based on scale
    useEffect(() => {
        const calculateHeight = async () => {
            if (!pdf) return;
            try {
                const page1 = await pdf.doc.getPage(1);
                const viewport = page1.getViewport({ scale });
                setDefaultPageHeight(viewport.height);
            } catch (e) {
                console.error("Failed to calculate default page height", e);
            }
        };
        calculateHeight();
    }, [pdf, scale]);

    const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
    const lastMouseDownTime = useRef(0);

    const handleMouseDown = (e) => {
        lastMouseDownTime.current = Date.now();
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;

        // Dismiss selection if clicking on the background or pseudo-elements (flicker fix)
        // to restore natural browser behavior.
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
            selection.removeAllRanges();
            setSelectionBtn({ show: false, x: 0, y: 0 });
        }

        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            e.preventDefault();
            setIsDragging(true);
            const viewer = viewerRef.current;
            if (viewer) {
                dragStartRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    left: viewer.scrollLeft,
                    top: viewer.scrollTop
                };
            }
        }
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const viewer = viewerRef.current;
        if (!viewer) return;

        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;

        viewer.scrollLeft = dragStartRef.current.left - dx;
        viewer.scrollTop = dragStartRef.current.top - dy;
    };

    return (
        <div
            className={`flex flex-col h-full relative overflow-hidden ${isDragging ? 'cursor-grabbing' : ''} ${className || ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => setIsDragging(false)}
            data-pdf-viewer="true"
            data-side={side}
        >
            <div className="bg-gray-100 px-0 py-0 border-b border-gray-300">
                <div className="flex items-center w-full min-h-[22px] h-auto flex-wrap relative">
                    {/* Left section: Filename + Search + Prev + Input */}
                    <div className="flex-1 flex items-center min-w-0">
                        <div className="flex items-center px-2 min-w-0 flex-shrink">
                            {pdf ? (
                                pdf.sourceUrl ? (
                                    <a
                                        href={pdf.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-medium text-gray-700 hover:underline truncate cursor-pointer active:opacity-70"
                                        title={pdf.sourceUrl.startsWith('file:///') ? "Copy path" : "Open outside"}
                                        onClick={(e) => {
                                            if (pdf.sourceUrl.startsWith('file:///')) {
                                                e.preventDefault();
                                                const cleanPath = pdf.sourceUrl.replace('file:///', '');
                                                navigator.clipboard.writeText(cleanPath);
                                                setCopyFeedback("Path Copied!");
                                                setTimeout(() => setCopyFeedback(null), 2000);
                                            }
                                        }}
                                    >
                                        {copyFeedback || pdf.name}
                                    </a>
                                ) : (
                                    <span className="text-xs font-medium text-gray-700 truncate" title={pdf.name}>
                                        {pdf.name}
                                    </span>
                                )
                            ) : (
                                <span className="text-xs font-medium text-gray-400 truncate" title={`${side === 'left' ? 'Left' : 'Right'} PDF`}>
                                    {`${side === 'left' ? 'Left' : 'Right'} PDF`}
                                </span>
                            )}
                        </div>

                        {pdf && (
                            <div className="flex items-center ml-auto">
                                <button
                                    onClick={() => setShowSearch(!showSearch)}
                                    className={`h-[22px] w-[24px] flex items-center justify-center p-0 rounded-none transition-colors ${showSearch ? 'bg-blue-500 text-white' : 'bg-transparent hover:bg-gray-200'}`}
                                    title="Find"
                                >
                                    <Search className="w-4 h-4" />
                                </button>

                                <div className="w-6 h-[22px] flex items-center justify-center">
                                    <div className="w-px h-3.5 bg-gray-300" />
                                </div>
                                <button
                                    onClick={() => {
                                        const prev = Math.max(1, page - 1);
                                        if (viewMode === 'continuous') scrollToPage(prev);
                                        setPage(prev);
                                    }}
                                    disabled={page <= 1}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 disabled:opacity-50"
                                    title="Previous page"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <div className="flex items-center gap-0.5 mx-0">
                                    <input
                                        type="text"
                                        value={pageInputValue}
                                        onChange={(e) => setPageInputValue(e.target.value)}
                                        onBlur={handlePageInputBlur}
                                        onKeyDown={handlePageInputKeyDown}
                                        className="text-center text-xs bg-gray-200/50 border-none rounded-none p-0 h-[22px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        style={{ width: `${Math.max(2, numPages.toString().length) + 1}ch` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* The absolute center: The slash */}
                    {pdf && (
                        <div className="flex-none flex items-center">
                            <span className="text-xs text-gray-500 px-0.5">/</span>
                        </div>
                    )}

                    {/* Right section: TotalPages + Next + Zoom + Utilities */}
                    <div className="flex-1 flex items-center">
                        {pdf && (
                            <div className="flex items-center">
                                <span className="text-xs text-gray-500">{numPages}</span>
                                <button
                                    onClick={() => {
                                        const next = Math.min(numPages, page + 1);
                                        if (viewMode === 'continuous') scrollToPage(next);
                                        setPage(next);
                                    }}
                                    disabled={page >= numPages}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 disabled:opacity-50"
                                    title="Next page"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>

                                <div className="w-6 h-[22px] flex items-center justify-center">
                                    <div className="w-px h-3.5 bg-gray-300" />
                                </div>

                                <button
                                    onClick={() => setScale(Math.max(0.5, scale - 0.25))}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200"
                                    title="Zoom out"
                                >
                                    <ZoomOut className="w-4 h-4" />
                                </button>
                                <div className="flex items-center gap-0.5 mx-0">
                                    <input
                                        type="text"
                                        value={zoomInputValue}
                                        onChange={(e) => setZoomInputValue(e.target.value)}
                                        onBlur={handleZoomInputBlur}
                                        onKeyDown={handleZoomInputKeyDown}
                                        className="w-8 text-center text-xs bg-gray-200/50 border-none rounded-none p-0 h-[22px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <span className="text-xs text-gray-500 font-medium">%</span>
                                </div>
                                <button
                                    onClick={() => setScale(Math.min(3, scale + 0.25))}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200"
                                    title="Zoom in"
                                >
                                    <ZoomIn className="w-4 h-4" />
                                </button>

                                <div className="w-6 h-[22px] flex items-center justify-center">
                                    <div className="w-px h-3.5 bg-gray-300" />
                                </div>

                                <button
                                    onClick={() => handleFitToPage(false)}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 text-gray-500 hover:text-blue-600"
                                    title="Fit to page"
                                >
                                    <Maximize2 className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setScale(1.0)}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 text-gray-500 hover:text-blue-600"
                                    title="Reset zoom to 100%"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                            </div>
                        )}

                        <div className="flex items-center gap-0 ml-auto">
                            {/* Settings - always visible */}
                            {side === 'left' && (
                                <div className="relative">
                                    <button
                                        onClick={() => {
                                            if (!showSettings) setTempAuthorName(authorName);
                                            setShowSettings(!showSettings);
                                        }}
                                        className={`h-[22px] w-[24px] flex items-center justify-center p-0 rounded-none transition-colors ${showSettings ? 'bg-blue-500 text-white' : 'bg-transparent text-gray-600 hover:bg-gray-200'}`}
                                        title="Settings"
                                    >
                                        <Settings className="w-4 h-4" />
                                    </button>

                                    {showSettings && (
                                        <>
                                            <div
                                                className="fixed inset-0 z-[105]"
                                                onClick={() => setShowSettings(false)}
                                            />
                                            <div
                                                className="absolute top-full right-0 bg-white border border-gray-300 rounded-none z-[110] min-w-[180px] animate-in fade-in slide-in-from-top-1 duration-200"
                                                style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' }}
                                            >
                                                {setViewMode && (
                                                    <div className="p-1.5">
                                                        <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-tight">View</div>
                                                        <div className="flex border border-gray-200 bg-gray-50 p-0">
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
                                                    </div>
                                                )}

                                                <div className="p-1.5">
                                                    <div className="text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-tight">Annotator</div>
                                                    <input
                                                        type="text"
                                                        placeholder="Enter name..."
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
                                                        className="w-full text-xs border border-gray-200 rounded-none px-2 py-1.5 focus:outline-none focus:border-gray-400 font-normal bg-gray-50"
                                                    />
                                                </div>

                                                <div className="px-1.5 py-2 border-t border-gray-100 mt-1">
                                                    <div className="text-[9px] text-gray-400 font-normal leading-tight">
                                                        <span>© 2025 PlusKitty. Open source under AGPL3.0. </span>
                                                        <a
                                                            href="https://github.com/PlusKitty/PDFTwice"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="hover:text-gray-600 transition-colors inline-flex items-center gap-1.5"
                                                            title="View Source on GitHub"
                                                        >
                                                            <Github className="w-3 h-3" />
                                                        </a>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* PDF-dependent controls */}
                            {pdf && (
                                <>
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

                                    {hasComments && (
                                        <button
                                            onClick={onExport}
                                            className="h-[22px] w-[24px] flex items-center justify-center p-0 rounded-none bg-purple-500 text-white hover:bg-purple-600 transition-colors relative"
                                            title={`Export with comments${isDirty ? ' (Unsaved manual changes)' : ''}`}
                                        >
                                            <Download className="w-4 h-4" />
                                            {isDirty && (
                                                <div className="absolute -top-1 -right-1 bg-yellow-400 text-black rounded-full border border-[0.5px] border-white p-[1px]" title="Unsaved manual changes">
                                                    <AlertTriangle className="w-2 h-2" />
                                                </div>
                                            )}
                                        </button>
                                    )}

                                    <button
                                        onClick={onClose}
                                        className="h-[22px] w-[24px] flex items-center justify-center p-0 hover:bg-red-100 rounded-none text-gray-400 hover:text-red-500 transition-colors"
                                        title="Close"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {
                showSearch && (
                    <div className="bg-white border border-gray-300 px-2 py-1.5 relative z-10">
                        <div className="flex items-center gap-1.5">
                            <div className="relative flex-1">
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Find..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        const newQuery = e.target.value;
                                        setSearchQuery(newQuery);
                                        performSearch(newQuery, false);
                                    }}
                                    onKeyDown={handleSearchKeyDown}
                                    className="w-full text-xs border-0 rounded-none px-2 py-1 focus:outline-none pr-16 bg-white"
                                />
                                <div className="absolute right-2 top-1 flex items-center gap-1">
                                    {isSearching ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-gray-600" />
                                    ) : (
                                        <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                                            {searchResults.length > 0 ? `${currentResultIndex + 1} / ${searchResults.length}` : (searchQuery && !isSearching ? 'No results' : '')}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => setShowSearch(false)}
                                className="h-[22px] w-[22px] flex items-center justify-center hover:bg-gray-200 rounded-none text-gray-400 hover:text-gray-600 transition-colors"
                                title="Close search"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {searchResults.length > 0 && (
                            <div className="max-h-[200px] overflow-y-auto border border-gray-200 bg-white mt-1.5" style={{ overflowAnchor: 'auto' }}>
                                {searchResults.map((result, idx) => (
                                    <button
                                        key={`${result.page}-${result.pos}`}
                                        ref={el => searchResultRefs.current[idx] = el}
                                        onClick={() => {
                                            userNavigatedRef.current = true; // Mark as explicit navigation
                                            setCurrentResultIndex(idx);
                                            selectedResultIdRef.current = { page: result.page, pos: result.pos };
                                            const pageData = extractedText?.pages?.find(p => p.pageNum === result.page);
                                            navigateToResult(result, result.query, pageData);
                                        }}
                                        className={`w-full text-left px-2 py-1.5 border-b border-gray-100 flex justify-between items-start gap-2 transition-colors ${(selectedResultIdRef.current?.page === result.page && selectedResultIdRef.current?.pos === result.pos) ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'
                                            }`}
                                    >
                                        <span className="text-[11px] leading-relaxed flex-1 text-gray-600">
                                            {result.snippet.substring(0, result.queryStart)}
                                            <b className="text-blue-700 bg-blue-100/50 px-0.5">{result.snippet.substring(result.queryStart, result.queryEnd)}</b>
                                            {result.snippet.substring(result.queryEnd)}
                                        </span>
                                        <span className="text-[10px] font-bold text-gray-400">{result.page}</span>
                                    </button>
                                ))}
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
                        <>
                            <label className={`cursor-pointer flex flex-col items-center gap-3 p-8 border-2 border-dashed rounded-none transition-colors ${isLoading ? 'border-gray-200 bg-gray-50 cursor-wait' : 'border-gray-400 hover:border-blue-500 hover:bg-blue-50'}`}>
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

                            {(() => {
                                const allowRemote = import.meta.env.VITE_ENABLE_REMOTE_PDFS !== 'false';
                                const allowLocal = import.meta.env.VITE_ENABLE_LOCAL_BRIDGE !== 'false';

                                if (!allowRemote && !allowLocal) return null;

                                let placeholder = "";
                                if (allowRemote && allowLocal) placeholder = "https://... or folder/file.pdf";
                                else if (allowRemote) placeholder = "https://...";
                                else if (allowLocal) placeholder = "folder/file.pdf";

                                return (
                                    <>
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
                                                placeholder={placeholder}
                                                disabled={isLoading}
                                                className="flex-1 text-xs border border-gray-300 rounded-none px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                            />
                                            <button
                                                type="submit"
                                                disabled={isLoading}
                                                className="bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-none hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                                                {isLoading ? 'Loading...' : 'Load'}
                                            </button>
                                        </form>
                                    </>
                                );
                            })()}
                        </>
                    </div>
                ) : (
                    <div
                        ref={viewerRef}
                        tabIndex={0}
                        className={`flex-1 overflow-auto relative bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400/20 ${viewMode === 'single' ? 'p-0 flex' : 'py-4 px-0 flex flex-col items-center'}`}
                        onScroll={handleScrollInternal}
                        onMouseUp={handleMouseUp}
                        onKeyDown={(e) => {
                            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
                            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                                e.preventDefault();
                                const prev = Math.max(1, page - 1);
                                if (viewMode === 'continuous') scrollToPage(prev);
                                setPage(prev);
                            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                                e.preventDefault();
                                const next = Math.min(numPages, page + 1);
                                if (viewMode === 'continuous') scrollToPage(next);
                                setPage(next);
                            }
                        }}
                    >
                        {viewMode === 'single' ? (
                            <div
                                data-page={page}
                                className="pdf-page-container relative block m-auto bg-white shadow-lg w-fit"
                                onDoubleClick={(e) => {
                                    const selection = window.getSelection();
                                    const hasSelection = selection && !selection.isCollapsed;
                                    const isTextSpan = e.target.tagName === 'SPAN';

                                    // Ignore if there is a text selection (unless it's empty/collapsed)
                                    // AND also check if the user "held" the second click (long press) which implies selection intent
                                    const clickDuration = Date.now() - lastMouseDownTime.current;
                                    if ((hasSelection && isTextSpan) || clickDuration > 300) return;

                                    setSelectionBtn({ show: false, x: 0, y: 0 });

                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = ((e.clientX - rect.left) / rect.width) * 100;
                                    const y = ((e.clientY - rect.top) / rect.height) * 100;

                                    addComment(side, x, y);
                                    if (selection && !isTextSpan) {
                                        selection.removeAllRanges();
                                    }
                                }}
                            >
                                {/* Interaction Shield: Move inside relative container to cover full scrollable area */}
                                {activeComment && activeComment.side === side && commentText && commentText.trim() !== '' && (
                                    <div
                                        className="absolute inset-0 z-[69] cursor-default select-none bg-transparent"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setIsBlinking(true);
                                            setTimeout(() => setIsBlinking(false), 600);
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsBlinking(true);
                                            setTimeout(() => setIsBlinking(false), 600);
                                        }}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setIsBlinking(true);
                                            setTimeout(() => setIsBlinking(false), 600);
                                        }}
                                    />
                                )}
                                <div ref={singlePageContainerRef} style={{ position: 'relative' }} />
                                {renderOverlayItems(page, comments, side, activeComment, setActiveComment, setCommentText, deleteComment, saveComment, commentText, selectionBtn, setSelectionBtn, addComment, addHighlight, setHoveredCommentId, hoveredCommentId, activeCommentRef, isBlinking)}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4 items-center pb-[50vh] w-full relative">
                                {/* Interaction Shield: Move inside relative container to cover full scrollable area */}
                                {activeComment && activeComment.side === side && commentText && commentText.trim() !== '' && (
                                    <div
                                        className="absolute inset-0 z-[69] cursor-default select-none bg-transparent"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setIsBlinking(true);
                                            setTimeout(() => setIsBlinking(false), 600);
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsBlinking(true);
                                            setTimeout(() => setIsBlinking(false), 600);
                                        }}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setIsBlinking(true);
                                            setTimeout(() => setIsBlinking(false), 600);
                                        }}
                                    />
                                )}
                                {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                                    <div
                                        key={pageNum}
                                        className="pdf-page-container relative bg-white shadow-lg transition-shadow duration-300 mx-auto"
                                        style={{
                                            width: 'fit-content',
                                            minHeight: `${defaultPageHeight}px`,
                                        }}
                                        onDoubleClick={(e) => {
                                            const selection = window.getSelection();
                                            const hasSelection = selection && !selection.isCollapsed;
                                            const isTextSpan = e.target.tagName === 'SPAN';

                                            // Ignore if there is a text selection (unless it's empty/collapsed)
                                            // AND also check if the user "held" the second click (long press) which implies selection intent
                                            const clickDuration = Date.now() - lastMouseDownTime.current;
                                            if ((hasSelection && isTextSpan) || clickDuration > 300) return;

                                            setSelectionBtn({ show: false, x: 0, y: 0 });
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = ((e.clientX - rect.left) / rect.width) * 100;
                                            const y = ((e.clientY - rect.top) / rect.height) * 100;

                                            addComment(side, x, y);
                                            if (selection && !isTextSpan) {
                                                selection.removeAllRanges();
                                            }
                                        }}
                                    >
                                        <div
                                            ref={el => pageRefs.current[pageNum] = el}
                                            data-page={pageNum}
                                            style={{
                                                width: 'fit-content',
                                                height: visiblePages.current.has(pageNum) ? 'auto' : `${defaultPageHeight}px`,
                                                minHeight: `${defaultPageHeight}px`,
                                                overflow: 'hidden',
                                            }}
                                        />
                                        {renderOverlayItems(pageNum, comments, side, activeComment, setActiveComment, setCommentText, deleteComment, saveComment, commentText, selectionBtn, setSelectionBtn, addComment, addHighlight, setHoveredCommentId, hoveredCommentId, activeCommentRef, isBlinking)}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Active Comment Box - Rendered at viewer level to avoid page clipping */}
                        {activeComment && activeComment.side === side && (() => {
                            // Calculate position synchronously during render (no state/effect needed)
                            const viewerPanel = viewerRef.current;
                            if (!viewerPanel) return null;

                            let pageContainer;
                            if (viewMode === 'continuous') {
                                pageContainer = pageRefs.current[activeComment.page];
                            } else {
                                pageContainer = singlePageContainerRef.current?.closest('.pdf-page-container');
                            }
                            if (!pageContainer) return null;

                            const pageRect = pageContainer.getBoundingClientRect();
                            const viewerRect = viewerPanel.getBoundingClientRect();

                            // Calculate annotation position in SCREEN coordinates
                            const annotationScreenX = pageRect.left + (activeComment.x / 100) * pageRect.width;
                            const annotationScreenY = pageRect.top + (activeComment.y / 100) * pageRect.height;

                            // Comment box dimensions
                            const boxWidth = 250;
                            const boxHeight = 120;
                            const OFFSET = 14;
                            const PADDING = 10;

                            // Get precise layout metrics (excluding scrollbars and borders)
                            const clientLeft = viewerPanel.clientLeft || 0;
                            const clientTop = viewerPanel.clientTop || 0;

                            // Usable viewport area in SCREEN coordinates
                            const viewportTop = viewerRect.top + clientTop + PADDING;
                            const viewportLeft = viewerRect.left + clientLeft + PADDING;
                            const viewportBottom = viewerRect.top + clientTop + viewerPanel.clientHeight - PADDING;
                            const viewportRight = viewerRect.left + clientLeft + viewerPanel.clientWidth - PADDING;

                            // Calculate ideal position (centered below annotation)
                            let boxScreenTop = annotationScreenY + OFFSET;
                            let boxScreenLeft = annotationScreenX - boxWidth / 2;

                            // Flip to above if would overflow bottom
                            if (boxScreenTop + boxHeight > viewportBottom) {
                                boxScreenTop = annotationScreenY - boxHeight - OFFSET;
                            }

                            // Clamp to visible area
                            boxScreenTop = Math.max(viewportTop, Math.min(boxScreenTop, viewportBottom - boxHeight));
                            boxScreenLeft = Math.max(viewportLeft, Math.min(boxScreenLeft, viewportRight - boxWidth));

                            // Convert to content-relative coordinates for absolute positioning
                            const boxLeft = boxScreenLeft - (viewerRect.left + clientLeft) + viewerPanel.scrollLeft;
                            const boxTop = boxScreenTop - (viewerRect.top + clientTop) + viewerPanel.scrollTop;

                            const finalStyle = {
                                left: `${boxLeft}px`,
                                top: `${boxTop}px`,
                            };

                            return (
                                <div
                                    ref={activeCommentRef}
                                    className={`absolute bg-white rounded-none p-0 z-[80] min-w-[250px] border border-transparent ${isBlinking ? 'animate-border-blink' : ''}`}
                                    style={{
                                        ...finalStyle,
                                        boxShadow: '0 0 20px rgba(0, 0, 0, 0.15), 0 0 2px rgba(0, 0, 0, 0.05)'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                >
                                    <div className="relative">
                                        <button
                                            onClick={() => setActiveComment(null)}
                                            className="absolute top-0 right-0 h-[22px] w-[24px] flex items-center justify-center p-0 hover:bg-red-100 rounded-none text-gray-400 hover:text-red-500 transition-colors z-10 bg-white"
                                            title="Close (Esc)"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                        <textarea
                                            autoFocus
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.ctrlKey && e.key === 'Enter') {
                                                    e.preventDefault();
                                                    saveComment();
                                                } else if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    setActiveComment(null);
                                                } else if (e.ctrlKey && e.key === 'Delete') {
                                                    e.preventDefault();
                                                    deleteComment(activeComment.id);
                                                    setActiveComment(null);
                                                }
                                            }}
                                            placeholder="Add your comment..."
                                            className="w-full pl-2 pr-7 py-[5px] border-0 resize-none focus:outline-none focus:ring-0 text-[13px] leading-relaxed"
                                            rows={3}
                                        />
                                    </div>

                                    <div className="flex justify-between items-end -m-px">
                                        <button
                                            onClick={() => {
                                                deleteComment(activeComment.id);
                                                setActiveComment(null);
                                            }}
                                            className="flex items-center justify-center h-[24px] w-10 text-red-500 hover:bg-red-50 transition-colors rounded-none"
                                            title="Delete (Ctrl+Del)"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>

                                        <button
                                            onClick={saveComment}
                                            className="bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center justify-center h-[24px] w-20 rounded-none"
                                            title="Save (Ctrl+Enter)"
                                        >
                                            <Send className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
        </div>
    );
});

PDFViewer.displayName = 'PDFViewer';

function useClickOutside(ref, activeComment, commentText, setActiveComment, setIsBlinking, side) {
    useEffect(() => {
        if (!activeComment || activeComment.side !== side) return;

        const handleClickOutside = (event) => {
            // Clicked outside?
            if (ref.current && !ref.current.contains(event.target)) {
                // Ignore if clicking on the OTHER PDF viewer
                const otherViewer = event.target.closest('[data-pdf-viewer]');
                if (otherViewer && otherViewer.getAttribute('data-side') !== side) {
                    return;
                }

                if (!commentText || commentText.trim() === '') {
                    // Empty? Close it
                    setActiveComment(null);
                } else {
                    // Not empty? Blink it
                    setIsBlinking(true);
                    setTimeout(() => setIsBlinking(false), 600); // Match animation duration (0.2s * 3)
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [activeComment, commentText, ref, setActiveComment, setIsBlinking, side]);
}

const renderOverlayItems = (pageNum, comments, side, activeComment, setActiveComment, setCommentText, deleteComment, saveComment, commentText, selectionBtn, setSelectionBtn, addComment, addHighlight, setHoveredCommentId, hoveredCommentId, activeCommentRef, isBlinking, activeSearchResult) => {
    return (
        <>


            {selectionBtn.show && (selectionBtn.page === pageNum || (!selectionBtn.page && true)) && (
                <div
                    className="absolute bg-white border border-gray-200 shadow-xl rounded-none z-50 flex overflow-hidden transform -translate-x-1/2 mt-1"
                    style={{
                        left: `${selectionBtn.x}%`,
                        top: `${selectionBtn.y}%`,
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="px-3 py-1.5 hover:bg-yellow-50 text-yellow-700 transition-colors border-r border-gray-100 flex items-center justify-center"
                        onClick={(e) => {
                            e.stopPropagation();
                            addHighlight(side, selectionBtn.x, selectionBtn.y, selectionBtn.highlightRects || [selectionBtn.highlightRect], selectionBtn.selectedText, selectionBtn.page);
                            setSelectionBtn({ show: false, x: 0, y: 0, highlightRect: null, highlightRects: null, selectedText: '' });
                            window.getSelection()?.removeAllRanges();
                        }}
                        title="Highlight"
                    >
                        <Highlighter className="w-4 h-4" />
                    </button>
                    <button
                        className="px-3 py-1.5 hover:bg-blue-50 text-blue-600 text-xs font-medium flex items-center gap-1.5 transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            addComment(side, selectionBtn.x, selectionBtn.y, selectionBtn.highlightRects || [selectionBtn.highlightRect], selectionBtn.selectedText, selectionBtn.page);
                            setSelectionBtn({ show: false, x: 0, y: 0, highlightRect: null, highlightRects: null, selectedText: '' });
                            window.getSelection()?.removeAllRanges();
                        }}
                        title="Add comment"
                    >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Comment
                    </button>
                </div>
            )}

            {Object.values(comments)
                .filter(c => c.side === side && c.page === pageNum)
                .map(comment => (
                    <React.Fragment key={comment.id}>
                        {(comment.highlightRects && comment.highlightRects.length > 0) ? (
                            <div
                                className="absolute inset-0 pointer-events-none z-[20] opacity-40 hover:opacity-60 transition-opacity"
                                style={{ width: '100%', height: '100%' }}
                            >
                                {comment.highlightRects.map((rect, idx) => (
                                    <div
                                        key={`${comment.id}-${idx}`}
                                        className="absolute bg-yellow-400 cursor-pointer pointer-events-auto"
                                        style={{
                                            left: `${rect.left}%`,
                                            top: `${rect.top}%`,
                                            width: `${rect.width}%`,
                                            height: `${rect.height}%`,
                                        }}
                                        onMouseEnter={() => setHoveredCommentId(comment.id)}
                                        onMouseLeave={() => setHoveredCommentId(null)}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveComment(comment);
                                            setCommentText(comment.text);
                                        }}
                                    />
                                ))}
                            </div>
                        ) : comment.highlightRect ? (
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

                        {hoveredCommentId === comment.id && (!activeComment || activeComment.id !== comment.id) && (
                            <div
                                className="absolute bg-white border border-gray-300 rounded-none shadow-xl p-2 text-xs max-w-[200px] z-[60] pointer-events-none"
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


        </>
    );
};

export default PDFViewer;
