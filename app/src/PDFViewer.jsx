import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { MessageSquare, X, ChevronLeft, ChevronRight, Settings, Trash2, Search, Send, PanelLeft } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
// Note: Using window.__TAURI__.opener.openUrl() for external links, window.__TAURI__.core.invoke() for other calls
import SidePanel from './components/SidePanel';
import BookmarksPanel from './components/BookmarksPanel';
import AnnotationsPanel from './components/AnnotationsPanel';
import useBookmarks from './hooks/useBookmarks';
import useClickOutside from './hooks/useClickOutside';

import TextLayerSelectionManager from './utils/TextLayerSelectionManager';
import SelectionPopover from './components/PDFViewer/SelectionPopover';
import AnnotationOverlay from './components/PDFViewer/AnnotationOverlay';
import SearchPanel from './components/PDFViewer/SearchPanel';
import UploadZone from './components/PDFViewer/UploadZone';
import {
    SettingsMenu,
    PanelsMenu,
    ZoomControls,
    PageNavigation,
    FileInfo,
    UtilityButtons
} from './components/PDFViewer/Toolbar';
import { getPageImages } from './utils/pdfImageAltText';

/**
 * SimpleLinkService - Minimal PDF.js link service for internal link navigation
 * Handles clicking internal PDF links (table of contents, cross-references, etc.)
 */

// Minimal stub for PDF.js AnnotationLayer (required interface, but we don't use downloads)
const downloadManager = {
    downloadUrl() { },
    downloadData() { },
    openOrDownloadData() { return false; },
    download() { }
};

class SimpleLinkService {
    constructor() {
        this.externalLinkRel = 'noopener noreferrer';
        this.pdfDoc = null;
        this.navigateToPage = null; // Callback set by PDFViewer
        this.onLinkHover = null;    // Callback for link hover
        this.isTauri = false;
    }

    setDocument(pdfDoc) { this.pdfDoc = pdfDoc; }
    get pagesCount() { return this.pdfDoc?.numPages || 0; }
    get externalLinkEnabled() { return true; }

    getDestinationHash(dest) {
        // External URLs pass through unchanged
        if (typeof dest === 'string' && /^(https?:|mailto:|\/\/)/.test(dest)) {
            return dest;
        }
        // Internal destinations: encode as JSON in hash
        return '#' + encodeURIComponent(JSON.stringify(dest));
    }

    getAnchorUrl(dest) { return this.getDestinationHash(dest); }
    setHash() { } // No-op
    executeNamedAction() { } // No-op (NextPage/PrevPage rarely used, requires page sync)
    executeSetOCGState() { } // No-op

    addLinkAttributes(link, url) {
        link.href = url;

        // Add hover handlers for preview
        if (this.onLinkHover) {
            link.onmouseenter = () => this.onLinkHover(url);
            link.onmouseleave = () => this.onLinkHover(null);
        }

        if (url?.startsWith('#') && url.length > 1) {
            // Internal link: handle click manually
            link.onclick = (e) => {
                e.preventDefault();
                try {
                    const dest = JSON.parse(decodeURIComponent(url.slice(1)));
                    this.navigateTo(dest);
                } catch { /* ignore malformed */ }
            };
        } else if (url && !url.startsWith('#')) {
            // External link
            link.target = '_blank';
            link.rel = this.externalLinkRel;

            // If in Tauri, use opener plugin to open in default browser
            if (this.isTauri) {
                link.onclick = (e) => {
                    e.preventDefault();
                    const opener = window.__TAURI__?.opener;
                    if (opener?.openUrl) {
                        opener.openUrl(url).catch(console.error);
                    }
                };
            }
        }
    }

    async goToDestination(dest) { await this.navigateTo(dest); }
    goToPage(val) { if (typeof val === 'number') this.navigateToPage?.(val); }

    async navigateTo(dest) {
        if (!this.pdfDoc || !this.navigateToPage) return;
        try {
            // Resolve named destinations
            const resolved = typeof dest === 'string'
                ? await this.pdfDoc.getDestination(dest)
                : dest;

            if (!resolved) {
                // Direct page number fallback
                if (typeof dest === 'number') this.navigateToPage(dest + 1);
                return;
            }

            // Extract page ref from destination array [Ref, Name, ...args]
            const ref = Array.isArray(resolved) ? resolved[0] : resolved;
            const pageIndex = await this.pdfDoc.getPageIndex(ref);
            if (pageIndex !== -1) this.navigateToPage(pageIndex + 1);
        } catch { /* ignore navigation errors */ }
    }

    // Stubs for PDF.js interface compatibility
    cachePageRef() { }
    isPageVisible() { return true; }
    isPageCached() { return true; }
}

// Create a singleton link service instance for internal link handling
const linkService = new SimpleLinkService();

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
    hasBookmarks: hasBookmarksProp, // From parent - for export button visibility
    isDirty,
    authorName,
    setAuthorName,
    onClose,
    onLoadFromUrl,
    onLoadFromPath, // Tauri: load from file path (native dialog)
    onFitToPage,
    isLoading = false,
    viewMode = 'single', // 'single' | 'continuous'
    setViewMode,
    className,
    onBookmarksChange, // Callback when bookmarks change
    exportSettings,     // Export settings (Tauri mode)
    setExportSettings,  // Setter for export settings
    isTauri = false,    // Whether running in Tauri
    scaleMode,          // 'fit' | 'level'
    setScaleMode,
    defaultScaleLevel,
    setDefaultScaleLevel,
    altTextSettings,    // { showIndicator, fallbackMode }
    setAltTextSettings,
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

    // Panel visibility state
    const [showBookmarks, setShowBookmarks] = useState(false);
    const [showAnnotations, setShowAnnotations] = useState(false);
    const [leftPanelWidth, setLeftPanelWidth] = useState(168);
    const [rightPanelWidth, setRightPanelWidth] = useState(168);
    const [showPanelsMenu, setShowPanelsMenu] = useState(false);

    // Bookmarks hook (user-defined bookmarks)
    const pdfId = pdf?.name ? pdf.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() : null;
    const { bookmarks, addBookmark, removeBookmark, renameBookmark } = useBookmarks(pdfId, onBookmarksChange);

    const [hoveredLink, setHoveredLink] = useState(null);

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

    // Render Queue (prevents overwhelming main thread on fast scroll)
    const renderingPages = useRef(new Set()); // Currently rendering
    const renderQueue = useRef([]); // Pending render requests
    const renderTasksRef = useRef(new Map()); // Track render tasks per page for cancellation
    const MAX_CONCURRENT_RENDERS = 1; // Serialize renders for WebView2 stability

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

                            if (rect.top <= viewerRect.top) {
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

    // Configure linkService for internal PDF link navigation
    useEffect(() => {
        if (pdf?.doc) {
            linkService.setDocument(pdf.doc);
            linkService.navigateToPage = (pageNumber) => {
                if (viewMode === 'continuous' && pageRefs.current[pageNumber]) {
                    pageRefs.current[pageNumber].scrollIntoView({ behavior: 'auto', block: 'start' });
                } else if (viewerRef.current) {
                    viewerRef.current.scrollTop = 0;
                }
                setPage(pageNumber);
            };
        }

        // Update linkService configuration
        linkService.isTauri = isTauri;
        linkService.onLinkHover = (url) => setHoveredLink(url);

        return () => {
            linkService.navigateToPage = null;
            linkService.onLinkHover = null;
        };
    }, [pdf, viewMode, setPage, viewerRef, isTauri]);

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

            // Render alt text layer for cached page (cache doesn't store it)
            try {
                const pageObj = await pdfDoc.getPage(pageNum);
                const viewport = pageObj.getViewport({ scale: currentScale });
                const images = await getPageImages(pageObj, {
                    fallbackMode: altTextSettings?.fallbackMode || 'spatial'
                });
                if (images && images.length > 0) {
                    const altLayer = document.createElement('div');
                    altLayer.className = 'altTextLayer';
                    altLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:var(--z-annotation-base);';

                    for (const img of images) {
                        const [x, y, x2, y2] = img.rect;
                        const [vx, vy, vx2, vy2] = viewport.convertToViewportRectangle([x, y, x2, y2]);
                        const left = Math.min(vx, vx2);
                        const top = Math.min(vy, vy2);
                        const width = Math.abs(vx2 - vx);
                        const height = Math.abs(vy2 - vy);

                        const overlay = document.createElement('div');
                        overlay.className = 'image-alt-overlay';
                        overlay.style.left = `${left}px`;
                        overlay.style.top = `${top}px`;
                        overlay.style.width = `${width}px`;
                        overlay.style.height = `${height}px`;
                        overlay.title = img.alt;

                        if (altTextSettings?.showIndicator !== false) {
                            const badge = document.createElement('div');
                            badge.className = 'alt-badge';
                            badge.textContent = 'ALT';
                            overlay.appendChild(badge);
                        }
                        altLayer.appendChild(overlay);
                    }
                    container.appendChild(altLayer);
                }
            } catch (e) {
                console.warn('Failed to render alt text for cached page:', e);
            }

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

                // Add endOfContent element to prevent selection flicker (PDF.js approach)
                const endOfContent = document.createElement('br');
                endOfContent.className = 'endOfContent';
                newTextLayer.appendChild(endOfContent);

                if (cacheRef) cacheRef.current = { page: pageNum, scale: currentScale, content: [newCanvas, newTextLayer] };
                return true;
            }

            // Overlay strategy for smooth swap
            container.style.position = 'relative';
            newCanvas.style.position = 'absolute';
            newCanvas.style.top = '0';
            newCanvas.style.left = '0';
            newCanvas.style.zIndex = 'var(--z-pdf-canvas)'; // New on top

            newTextLayer.style.position = 'absolute';
            newTextLayer.style.top = '0';
            newTextLayer.style.left = '0';
            newTextLayer.style.zIndex = 'var(--z-text-layer)';

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

            // YIELD: Give Tauri event loop a chance to process after heavy render
            await new Promise(r => setTimeout(r, 0));

            if (pdfjsLib.TextLayer) {
                await new pdfjsLib.TextLayer({ textContentSource: textContent, container: newTextLayer, viewport }).render();
            } else {
                const tTask = pdfjsLib.renderTextLayer({ textContent, container: newTextLayer, viewport, textDivs: [] });
                if (tTask.promise) await tTask.promise;
            }

            // YIELD: Give Tauri event loop a chance after text layer
            await new Promise(r => setTimeout(r, 0));

            // Add endOfContent element to prevent selection flicker (PDF.js approach)
            const endOfContent = document.createElement('div');
            endOfContent.className = 'endOfContent';
            newTextLayer.appendChild(endOfContent);

            // Register with selection manager for Chrome-compatible selection handling
            TextLayerSelectionManager.register(newTextLayer, endOfContent);

            // Render annotation layer for internal PDF links
            let newAnnotationLayer = null;
            try {
                const annotations = await pageObj.getAnnotations({ intent: 'display' });

                // Only create annotation layer if there are link annotations
                const hasLinks = annotations.some(a => a.subtype === 'Link');
                if (hasLinks && pdfjsLib.AnnotationLayer) {
                    newAnnotationLayer = document.createElement('div');
                    newAnnotationLayer.className = 'annotationLayer';
                    newAnnotationLayer.style.left = '0';
                    newAnnotationLayer.style.top = '0';
                    newAnnotationLayer.style.width = '100%';
                    newAnnotationLayer.style.height = '100%';
                    newAnnotationLayer.style.position = 'absolute';
                    newAnnotationLayer.style.visibility = 'hidden';

                    // PDF.js v3.11 uses class instantiation, but linkService is passed to render()
                    const annotationLayer = new pdfjsLib.AnnotationLayer({
                        div: newAnnotationLayer,
                        accessibilityManager: null, // Optional for basic functionality
                        annotationCanvasMap: null,
                        l10n: null, // Optional
                        page: pageObj,
                        viewport: viewport.clone({ dontFlip: true }),
                    });

                    await annotationLayer.render({
                        viewport: viewport.clone({ dontFlip: true }),
                        div: newAnnotationLayer,
                        annotations,
                        page: pageObj,
                        linkService,
                        downloadManager, // Required for file attachments/some links
                        renderForms: false,
                        imageResourcesPath: '',
                        annotationStorage: pdfjsLib.AnnotationStorage ? new pdfjsLib.AnnotationStorage() : null,
                    });
                }
            } catch (annotationError) {
                console.warn('Failed to render annotation layer:', annotationError);
            }

            // Render Alt Text Layer (DEFERRED - skip if no longer visible to prevent blocking)
            // Alt text is expensive (getStructTree + getOperatorList), defer to idle time
            let newAltTextLayer = null;
            try {
                // Skip alt text extraction during fast scrolling
                // The page must still be "wanted" - check if container is still in DOM and visible
                if (!container.isConnected) {
                    // Page was scrolled away during render, skip alt text
                } else {
                    const images = await getPageImages(pageObj, {
                        fallbackMode: altTextSettings?.fallbackMode || 'spatial'
                    });
                    if (images && images.length > 0) {
                        newAltTextLayer = document.createElement('div');
                        newAltTextLayer.className = 'altTextLayer';
                        newAltTextLayer.style.position = 'absolute';
                        newAltTextLayer.style.top = '0';
                        newAltTextLayer.style.left = '0';
                        newAltTextLayer.style.width = '100%';
                        newAltTextLayer.style.height = '100%';
                        newAltTextLayer.style.zIndex = 'var(--z-annotation-base)'; // Use existing z-index var or 25 defined in css
                        newAltTextLayer.style.visibility = 'hidden';

                        for (const img of images) {
                            const [x, y, x2, y2] = img.rect;
                            // Convert PDF coords to viewport coords
                            // rect is [x, y, x2, y2] in PDF user space
                            // viewport.convertToViewportRectangle stores [xMin, yMin, xMax, yMax]
                            const [vx, vy, vx2, vy2] = viewport.convertToViewportRectangle([x, y, x2, y2]);

                            // Calculate CSS values (left, top, width, height)
                            // PDF coords: Y grows up. Viewport: Y grows down?
                            // convertToViewportRectangle handles coordinate transformation (flipping Y)

                            // Normalize min/max because rotation/flip might swap order
                            const left = Math.min(vx, vx2);
                            const top = Math.min(vy, vy2);
                            const width = Math.abs(vx2 - vx);
                            const height = Math.abs(vy2 - vy);

                            const overlay = document.createElement('div');
                            overlay.className = 'image-alt-overlay';
                            overlay.style.left = `${left}px`;
                            overlay.style.top = `${top}px`;
                            overlay.style.width = `${width}px`;
                            overlay.style.height = `${height}px`;
                            overlay.title = img.alt; // Native tooltip

                            // Conditionally show ALT badge based on setting
                            if (altTextSettings?.showIndicator !== false) {
                                const badge = document.createElement('div');
                                badge.className = 'alt-badge';
                                badge.textContent = 'ALT';
                                overlay.appendChild(badge);
                            }

                            newAltTextLayer.appendChild(overlay);
                        }
                    }
                }
            } catch (altError) {
                console.warn('Failed to render alt text layer:', altError);
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

                    // Unregister old text layer before replacing (fixes Firefox/Chrome selection flicker)
                    const oldTextLayer = container.querySelector('.textLayer');
                    if (oldTextLayer) {
                        TextLayerSelectionManager.unregister(oldTextLayer);
                    }

                    if (newAnnotationLayer) {
                        container.replaceChildren(newCanvas, newTextLayer, newAnnotationLayer);
                    } else {
                        container.replaceChildren(newCanvas, newTextLayer);
                    }

                    if (newAltTextLayer) {
                        container.appendChild(newAltTextLayer);
                    }

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

                    if (newAnnotationLayer) {
                        newAnnotationLayer.style.visibility = '';
                    }
                    if (newAltTextLayer) {
                        newAltTextLayer.style.visibility = '';
                    }

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, pdf, page, numPages, altTextSettings]); // Remove scale - handled by transform effect below; altTextSettings for alt layer

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

        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // --- Continuous Mode Rendering with Priority Queue ---
    // Use ref to avoid circular dependency
    const processRenderQueueRef = useRef(null);

    // Execute actual page render
    const executePageRender = useCallback(async (pageNum) => {
        const container = pageRefs.current[pageNum];
        if (!container || !pdf) {
            processRenderQueueRef.current?.(); // Move to next
            return;
        }

        const needsRerender = container.dataset.targetScale !== undefined;
        if (container.hasChildNodes() && !needsRerender) {
            renderingPages.current.delete(pageNum);
            processRenderQueueRef.current?.(); // Move to next
            return;
        }

        renderingPages.current.add(pageNum);

        // Create taskRef and store in global map for cancellation
        const taskRef = { current: null };

        try {
            // We need to track when taskRef gets set and store it
            const renderPromise = renderPDFPage(pdf.doc, pageNum, container, scale, taskRef);

            // Store task reference for cancellation (taskRef.current is set inside renderPDFPage)
            // Check periodically until it's set or render completes
            const checkTaskInterval = setInterval(() => {
                if (taskRef.current) {
                    renderTasksRef.current.set(pageNum, taskRef.current);
                    clearInterval(checkTaskInterval);
                }
            }, 10);

            const success = await renderPromise;
            clearInterval(checkTaskInterval);
            renderTasksRef.current.delete(pageNum);

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
        } finally {
            renderingPages.current.delete(pageNum);
            preRenderingPages.current.delete(pageNum);
            processRenderQueueRef.current?.(); // Process next based on visibility
        }
    }, [pdf, scale]);

    // Get highest priority page to render (PDF.js approach)
    // Priority: 1) Visible pages, 2) Adjacent to visible
    const getHighestPriorityPage = useCallback(() => {
        // First: check visible pages that need rendering
        for (const pageNum of visiblePages.current) {
            if (renderingPages.current.has(pageNum)) continue;

            const container = pageRefs.current[pageNum];
            if (!container) continue;

            const needsRerender = container.dataset.targetScale !== undefined;
            if (!container.hasChildNodes() || needsRerender) {
                return pageNum;
            }
        }

        // Second: check queue items that are still in/near visible area
        for (let i = 0; i < renderQueue.current.length; i++) {
            const pageNum = renderQueue.current[i];
            if (renderingPages.current.has(pageNum)) continue;

            // Only process if page is visible or adjacent to visible
            const isNearVisible = visiblePages.current.has(pageNum) ||
                visiblePages.current.has(pageNum - 1) ||
                visiblePages.current.has(pageNum + 1);

            if (isNearVisible) {
                renderQueue.current.splice(i, 1); // Remove from queue
                return pageNum;
            }
        }

        // Clear stale queue items (pages that scrolled out of view)
        renderQueue.current = renderQueue.current.filter(p =>
            visiblePages.current.has(p) ||
            visiblePages.current.has(p - 1) ||
            visiblePages.current.has(p + 1)
        );

        return null;
    }, []);

    // Process next highest priority page
    const processRenderQueue = useCallback(() => {
        if (renderingPages.current.size >= MAX_CONCURRENT_RENDERS) return;

        const nextPage = getHighestPriorityPage();
        if (nextPage !== null) {
            executePageRender(nextPage);
        }
    }, [executePageRender, getHighestPriorityPage]);

    // Keep ref updated
    processRenderQueueRef.current = processRenderQueue;

    // Public function to request a page render
    const renderPageInContinuous = useCallback((pageNum) => {
        // Skip if already rendering
        if (renderingPages.current.has(pageNum)) return;

        const container = pageRefs.current[pageNum];
        if (!container || !pdf) return;

        const needsRerender = container.dataset.targetScale !== undefined;
        if (container.hasChildNodes() && !needsRerender) return;

        // Add to queue (deduped) and trigger processing
        if (!renderQueue.current.includes(pageNum)) {
            renderQueue.current.push(pageNum);
        }
        processRenderQueue();
    }, [pdf, processRenderQueue]);

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
                    // Only pre-render during idle (not every intersection)
                } else {
                    visiblePages.current.delete(pageNum);

                    // CRITICAL: Cancel any in-progress render for this page
                    const renderTask = renderTasksRef.current.get(pageNum);
                    if (renderTask) {
                        renderTask.cancel();
                        renderTasksRef.current.delete(pageNum);
                        renderingPages.current.delete(pageNum);
                    }

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
            rootMargin: '50% 0px 50% 0px', // Reduced from 200% for better fast-scroll performance
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        } else if (viewerRef.current) {
            // In single page mode, scroll to top of page
            viewerRef.current.scrollTop = 0;
        }
        setPage(targetPage);
    };

    const handleZoomInputBlur = () => {
        const val = parseInt(zoomInputValue, 10);
        if (isNaN(val)) {
            setZoomInputValue(Math.round(scale * 100).toString());
        } else {
            // Clamp between 20% and 300%
            const clamped = Math.max(20, Math.min(val, 300));
            if (clamped !== val) {
                setZoomInputValue(clamped.toString());
            }
            setScale(clamped / 100);
        }
    };

    const handleZoomInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            const val = parseInt(zoomInputValue, 10);
            if (!isNaN(val)) {
                const clamped = Math.max(20, Math.min(val, 300));
                if (clamped !== val) {
                    setZoomInputValue(clamped.toString());
                }
                setScale(clamped / 100);
            }
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
            else if (viewerRef.current) viewerRef.current.scrollTop = 0;
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
        ++activeNavigationRef.current;

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

        // Start the highlight attempt fast!
        // Single page mode might need a moment for React/DOM to settle, but we want to catch it ASAP.
        // We'll use a fast initial poll.
        setTimeout(() => attemptHighlight(0), 10);
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
            {/* Link Preview Overlay */}
            {hoveredLink && (
                <div className="fixed bottom-0 left-0 m-0 z-[200] bg-gray-100 border-t border-r border-gray-300 px-2 py-1 text-xs text-gray-700 font-mono shadow-sm pointer-events-none max-w-[500px] truncate">
                    {hoveredLink}
                </div>
            )}

            {/* ===== TOOLBAR START ===== */}
            <div className="bg-gray-100 px-0 py-0 border-b border-gray-300">
                <div className="flex items-center w-full min-h-[22px] h-auto flex-wrap relative">
                    {/* Left section: Filename + Search + Page Input */}
                    <div className="flex-1 flex items-center min-w-0">
                        <div className="flex items-center px-2 min-w-0 flex-shrink">
                            <FileInfo
                                pdf={pdf}
                                side={side}
                                copyFeedback={copyFeedback}
                                onCopyPath={(url) => {
                                    const cleanPath = url.replace('file:///', '');
                                    navigator.clipboard.writeText(cleanPath);
                                    setCopyFeedback("Path Copied!");
                                    setTimeout(() => setCopyFeedback(null), 2000);
                                }}
                            />
                        </div>

                        {pdf && (
                            <div className="flex items-center ml-auto">
                                {/* Search toggle */}
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

                                {/* Page navigation (left part: prev + input) */}
                                <button
                                    onClick={() => {
                                        const prev = Math.max(1, page - 1);
                                        if (viewMode === 'continuous') scrollToPage(prev);
                                        else if (viewerRef.current) viewerRef.current.scrollTop = 0;
                                        setPage(prev);
                                    }}
                                    disabled={page <= 1}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 disabled:opacity-50"
                                    title="Previous page (Alt+←)"
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

                    {/* Center: Slash divider */}
                    {pdf && (
                        <div className="flex-none flex items-center">
                            <span className="text-xs text-gray-500 px-0.5">/</span>
                        </div>
                    )}

                    {/* Right section: Total + Next + Zoom + Utilities */}
                    <div className="flex-1 flex items-center">
                        {pdf && (
                            <div className="flex items-center">
                                <span className="text-xs text-gray-500">{numPages}</span>
                                <button
                                    onClick={() => {
                                        const next = Math.min(numPages, page + 1);
                                        if (viewMode === 'continuous') scrollToPage(next);
                                        else if (viewerRef.current) viewerRef.current.scrollTop = 0;
                                        setPage(next);
                                    }}
                                    disabled={page >= numPages}
                                    className="h-[22px] w-[24px] flex items-center justify-center p-0 bg-transparent rounded-none hover:bg-gray-200 disabled:opacity-50"
                                    title="Next page (Alt+→)"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>

                                <div className="w-6 h-[22px] flex items-center justify-center">
                                    <div className="w-px h-3.5 bg-gray-300" />
                                </div>

                                <ZoomControls
                                    scale={scale}
                                    setScale={setScale}
                                    zoomInputValue={zoomInputValue}
                                    setZoomInputValue={setZoomInputValue}
                                    onZoomBlur={handleZoomInputBlur}
                                    onZoomKeyDown={handleZoomInputKeyDown}
                                    onFitToPage={handleFitToPage}
                                />
                            </div>
                        )}

                        <div className="flex items-center gap-0 ml-auto">
                            {/* Panels dropdown */}
                            {pdf && (
                                <div className="relative">
                                    <button
                                        onClick={() => setShowPanelsMenu(!showPanelsMenu)}
                                        className={`h-[22px] w-[24px] flex items-center justify-center p-0 rounded-none transition-colors ${showPanelsMenu || showBookmarks || showAnnotations ? 'bg-blue-500 text-white' : 'bg-transparent text-gray-600 hover:bg-gray-200'}`}
                                        title="Toggle panels"
                                    >
                                        <PanelLeft className="w-4 h-4" />
                                    </button>
                                    <PanelsMenu
                                        show={showPanelsMenu}
                                        onClose={() => setShowPanelsMenu(false)}
                                        showBookmarks={showBookmarks}
                                        setShowBookmarks={setShowBookmarks}
                                        showAnnotations={showAnnotations}
                                        setShowAnnotations={setShowAnnotations}
                                    />
                                </div>
                            )}

                            {/* Settings - left panel only */}
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
                                    <SettingsMenu
                                        show={showSettings}
                                        onClose={() => setShowSettings(false)}
                                        viewMode={viewMode}
                                        setViewMode={setViewMode}
                                        authorName={authorName}
                                        tempAuthorName={tempAuthorName}
                                        setTempAuthorName={setTempAuthorName}
                                        onSaveAuthor={setAuthorName}
                                        exportSettings={exportSettings}
                                        setExportSettings={setExportSettings}
                                        isTauri={isTauri}
                                        onLinkHover={setHoveredLink}
                                        scaleMode={scaleMode}
                                        setScaleMode={setScaleMode}
                                        defaultScaleLevel={defaultScaleLevel}
                                        setDefaultScaleLevel={setDefaultScaleLevel}
                                        altTextSettings={altTextSettings}
                                        setAltTextSettings={setAltTextSettings}
                                    />
                                </div>
                            )}

                            {/* Utility buttons */}
                            {pdf && (
                                <UtilityButtons
                                    side={side}
                                    syncScroll={syncScroll}
                                    setSyncScroll={setSyncScroll}
                                    hasComments={hasComments}
                                    hasBookmarks={hasBookmarksProp}
                                    isDirty={isDirty}
                                    onExport={onExport}
                                    onClose={onClose}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {/* ===== TOOLBAR END ===== */}

            <SearchPanel
                show={showSearch}
                query={searchQuery}
                setQuery={setSearchQuery}
                results={searchResults}
                currentIndex={currentResultIndex}
                isSearching={isSearching}
                extractedText={extractedText}
                onSearch={performSearch}
                onNavigate={(dir) => {
                    if (dir === 'next') {
                        const nextIdx = (currentResultIndex + 1) % searchResults.length;
                        userNavigatedRef.current = true;
                        setCurrentResultIndex(nextIdx);
                        const result = searchResultsRef.current[nextIdx];
                        if (result) {
                            selectedResultIdRef.current = { page: result.page, pos: result.pos };
                            const pageData = extractedText?.pages?.find(p => p.pageNum === result.page);
                            navigateToResult(result, result.query, pageData);
                        }
                    } else {
                        const prevIdx = currentResultIndex === 0 ? searchResults.length - 1 : currentResultIndex - 1;
                        userNavigatedRef.current = true;
                        setCurrentResultIndex(prevIdx);
                        const result = searchResultsRef.current[prevIdx];
                        if (result) {
                            selectedResultIdRef.current = { page: result.page, pos: result.pos };
                            const pageData = extractedText?.pages?.find(p => p.pageNum === result.page);
                            navigateToResult(result, result.query, pageData);
                        }
                    }
                }}
                onClose={() => setShowSearch(false)}
                onResultClick={(result, idx) => {
                    userNavigatedRef.current = true;
                    setCurrentResultIndex(idx);
                    selectedResultIdRef.current = { page: result.page, pos: result.pos };
                    const pageData = extractedText?.pages?.find(p => p.pageNum === result.page);
                    navigateToResult(result, result.query, pageData);
                }}
            />

            {
                !pdf ? (
                    <UploadZone
                        onUpload={onUpload}
                        onLoadFromPath={onLoadFromPath}
                        onLoadFromUrl={onLoadFromUrl}
                        isLoading={isLoading}
                        isDragging={isDragging}
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
                    />
                ) : (
                    <div className="flex-1 relative overflow-hidden">
                        {/* Bookmarks Panel (Left) - Fixed, outside scroll */}
                        <SidePanel
                            position="left"
                            isOpen={showBookmarks}
                            onClose={() => setShowBookmarks(false)}
                            title="Bookmarks"
                            width={leftPanelWidth}
                            onResize={setLeftPanelWidth}
                        >
                            <BookmarksPanel
                                outline={pdf?.outline || []}
                                bookmarks={bookmarks}
                                onNavigate={async (pageOrDest) => {
                                    let targetPage;

                                    if (typeof pageOrDest === 'number') {
                                        // Simple page number
                                        targetPage = pageOrDest;
                                    } else if (pageOrDest && pdf?.doc) {
                                        // PDF destination object - need to resolve to page number
                                        try {
                                            let destArray = pageOrDest;
                                            // If it's a string (named destination), look it up
                                            if (typeof pageOrDest === 'string') {
                                                destArray = await pdf.doc.getDestination(pageOrDest);
                                            }

                                            if (Array.isArray(destArray) && destArray[0]) {
                                                const ref = destArray[0];
                                                if (typeof ref === 'object' && ref !== null) {
                                                    // Page reference object
                                                    const pageIndex = await pdf.doc.getPageIndex(ref);
                                                    targetPage = pageIndex + 1; // Convert to 1-indexed
                                                } else if (typeof ref === 'number') {
                                                    targetPage = ref + 1;
                                                }
                                            }
                                        } catch (error) {
                                            console.warn('Failed to resolve destination:', error);
                                        }
                                    }

                                    if (targetPage && targetPage >= 1 && targetPage <= numPages) {
                                        if (viewMode === 'continuous') scrollToPage(targetPage);
                                        else if (viewerRef.current) viewerRef.current.scrollTop = 0;
                                        setPage(targetPage);
                                    }
                                }}
                                onAddBookmark={addBookmark}
                                onRemoveBookmark={removeBookmark}
                                onRenameBookmark={renameBookmark}
                                currentPage={page}
                                numPages={numPages}
                            />
                        </SidePanel>

                        {/* Annotations Panel (Right) - Fixed, outside scroll */}
                        <SidePanel
                            position="right"
                            isOpen={showAnnotations}
                            onClose={() => setShowAnnotations(false)}
                            title="Annotations"
                            width={rightPanelWidth}
                            onResize={setRightPanelWidth}
                        >
                            <AnnotationsPanel
                                annotations={comments}
                                side={side}
                                onNavigate={(targetPage) => {
                                    setPage(targetPage);
                                    if (viewMode === 'continuous') scrollToPage(targetPage);
                                }}
                                onDelete={(id) => deleteComment?.(id)}
                                onEdit={(id) => {
                                    const comment = comments[id];
                                    if (comment) {
                                        setPage(comment.page);
                                        if (viewMode === 'continuous') scrollToPage(comment.page);
                                        setCommentText(comment.text || '');
                                        setActiveComment(comment);
                                    }
                                }}
                            />
                        </SidePanel>

                        {/* Scrollable PDF Viewer */}
                        <div
                            ref={viewerRef}
                            tabIndex={0}
                            className={`h-full overflow-auto relative bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400/20 ${viewMode === 'single' ? 'p-0 flex' : 'py-4 px-0 flex flex-col items-center'}`}
                            style={{
                                marginLeft: showBookmarks ? `${leftPanelWidth}px` : 0,
                                marginRight: showAnnotations ? `${rightPanelWidth}px` : 0,
                                transition: 'margin 0.05s ease',
                            }}
                            onScroll={handleScrollInternal}
                            onMouseUp={handleMouseUp}
                            onKeyDown={(e) => {
                                if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
                                // Page navigation: Alt+Left/Right arrows only
                                if (e.altKey && e.key === 'ArrowLeft') {
                                    e.preventDefault();
                                    const prev = Math.max(1, page - 1);
                                    if (viewMode === 'continuous') scrollToPage(prev);
                                    else if (viewerRef.current) viewerRef.current.scrollTop = 0;
                                    setPage(prev);
                                } else if (e.altKey && e.key === 'ArrowRight') {
                                    e.preventDefault();
                                    const next = Math.min(numPages, page + 1);
                                    if (viewMode === 'continuous') scrollToPage(next);
                                    else if (viewerRef.current) viewerRef.current.scrollTop = 0;
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

                                        // Pass page number explicitly to the hook function
                                        addComment(side, x, y, null, '', page);
                                        if (selection && !isTextSpan) {
                                            selection.removeAllRanges();
                                        }
                                    }}
                                >
                                    {/* Interaction Shield: Move inside relative container to cover full scrollable area */}
                                    {activeComment && activeComment.side === side && commentText && commentText.trim() !== '' && (
                                        <div
                                            className="absolute inset-0 z-active-comment-shield cursor-default select-none bg-transparent"
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
                                    <SelectionPopover
                                        show={selectionBtn.show && (selectionBtn.page === page || !selectionBtn.page)}
                                        x={selectionBtn.x}
                                        y={selectionBtn.y}
                                        pageNum={page}
                                        highlightRect={selectionBtn.highlightRect}
                                        highlightRects={selectionBtn.highlightRects}
                                        selectedText={selectionBtn.selectedText}
                                        side={side}
                                        onHighlight={addHighlight}
                                        onComment={addComment}
                                        onClose={() => setSelectionBtn({ show: false, x: 0, y: 0, highlightRect: null, highlightRects: null, selectedText: '' })}
                                    />
                                    <AnnotationOverlay
                                        pageNum={page}
                                        comments={comments}
                                        side={side}
                                        hoveredCommentId={hoveredCommentId}
                                        activeComment={activeComment}
                                        onHoverComment={setHoveredCommentId}
                                        onLeaveComment={() => setHoveredCommentId(null)}
                                        onClickComment={(comment) => {
                                            setActiveComment(comment);
                                            setCommentText(comment.text);
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4 items-center pb-[50vh] w-full relative">
                                    {/* Note: Interaction shield removed from continuous mode - it was covering all pages */}
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

                                                // Pass pageNum explicitly
                                                addComment(side, x, y, null, '', pageNum);
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
                                            <SelectionPopover
                                                show={selectionBtn.show && (selectionBtn.page === pageNum || !selectionBtn.page)}
                                                x={selectionBtn.x}
                                                y={selectionBtn.y}
                                                pageNum={pageNum}
                                                highlightRect={selectionBtn.highlightRect}
                                                highlightRects={selectionBtn.highlightRects}
                                                selectedText={selectionBtn.selectedText}
                                                side={side}
                                                onHighlight={addHighlight}
                                                onComment={addComment}
                                                onClose={() => setSelectionBtn({ show: false, x: 0, y: 0, highlightRect: null, highlightRects: null, selectedText: '' })}
                                            />
                                            <AnnotationOverlay
                                                pageNum={pageNum}
                                                comments={comments}
                                                side={side}
                                                hoveredCommentId={hoveredCommentId}
                                                activeComment={activeComment}
                                                onHoverComment={setHoveredCommentId}
                                                onLeaveComment={() => setHoveredCommentId(null)}
                                                onClickComment={(comment) => {
                                                    setActiveComment(comment);
                                                    setCommentText(comment.text);
                                                }}
                                            />
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
                                        className={`absolute bg-white rounded-none p-0 z-active-comment-box min-w-[250px] border border-transparent ${isBlinking ? 'animate-border-blink' : ''}`}
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
                    </div>
                )}
        </div>
    );
});

PDFViewer.displayName = 'PDFViewer';



export default PDFViewer;
