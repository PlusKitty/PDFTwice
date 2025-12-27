import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PDFDocument, PDFName, PDFArray, PDFString } from 'pdf-lib';
import { AlertTriangle, X } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import PDFViewer from './PDFViewer';

// Setup local worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url
).toString();

const fetchPDF = async (targetUrl, proxyType = null) => {
    const allowRemote = import.meta.env.VITE_ENABLE_REMOTE_PDFS !== 'false';
    const isRemoteUrl = /^(https?:\/\/)/i.test(targetUrl) && !targetUrl.includes('/api/pdf');

    if (isRemoteUrl && !allowRemote) {
        throw new Error("Direct remote fetch is disabled by security policy.");
    }

    let res;
    try {
        res = await fetch(targetUrl);
    } catch (e) {
        // TypeError: Failed to fetch (CORS block, DNS failure, etc.)
        const err = new Error("Network Error (Possibly CORS or DNS failure)");
        err.type = 'NETWORK_ERROR';
        throw err;
    }

    if (!res.ok) {
        let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
        try {
            const txt = await res.text();
            // Only append body if it provides specific info (e.g. security block or file type error)
            // and isn't just the generic "could not be fetched" fallback.
            if (txt && !txt.includes('could not be fetched')) {
                errorMsg += ` - ${txt.substring(0, 100)}`;
            }
        } catch (e) { }

        const err = new Error(errorMsg);
        err.type = 'HTTP_ERROR';
        err.status = res.status;
        throw err;
    }

    const cType = res.headers.get('content-type');
    if (cType && cType.includes('text/html') && !proxyType) {
        throw new Error("The URL returned a web page instead of a PDF.");
    }

    return res.arrayBuffer();
};

export default function SideBySidePDF() {
    const [leftPDF, setLeftPDF] = useState(null);
    const [rightPDF, setRightPDF] = useState(null);
    const [leftPage, setLeftPage] = useState(1);
    const [rightPage, setRightPage] = useState(1);
    const [leftScale, setLeftScale] = useState(1.0);
    const [rightScale, setRightScale] = useState(1.0);
    const [syncScroll, setSyncScroll] = useState(true);
    const [syncOffset, setSyncOffset] = useState(0);
    const [comments, setComments] = useState({});
    const [leftActiveComment, setLeftActiveComment] = useState(null);
    const [leftCommentText, setLeftCommentText] = useState('');
    const [rightActiveComment, setRightActiveComment] = useState(null);
    const [rightCommentText, setRightCommentText] = useState('');
    const [authorName, setAuthorName] = useState(() => localStorage.getItem('pdf_author_name') || 'User');
    const [isDirty, setIsDirty] = useState(false);
    const [loadingError, setLoadingError] = useState(null);
    const [isUrlLoading, setIsUrlLoading] = useState({ left: false, right: false });

    const [viewMode, setViewMode] = useState(() => localStorage.getItem('pdf_view_mode') || 'single');

    const handleSetViewMode = (mode) => {
        setViewMode(mode);
        localStorage.setItem('pdf_view_mode', mode);
    };

    // DOM Refs for direct access (legacy sync + bounding box)
    const leftViewerRef = useRef(null);
    const rightViewerRef = useRef(null);

    // Component Refs for API access (new sync)
    const leftComponentRef = useRef(null);
    const rightComponentRef = useRef(null);

    const isSyncingLeft = useRef(false);
    const isSyncingRight = useRef(false);
    const leftSyncTimeoutRef = useRef(null);
    const rightSyncTimeoutRef = useRef(null);

    // RAF throttling for smooth scroll sync
    const syncRAFRef = useRef(null);
    const pendingSyncRef = useRef(null);

    // Update URL without reloading
    const updateUrlParams = (side, url) => {
        const urlObj = new URL(window.location);
        const paramKey = side === 'left' ? 'a' : 'b';
        if (url) {
            urlObj.searchParams.set(paramKey, url);
        } else {
            urlObj.searchParams.delete(paramKey);
        }
        window.history.pushState({}, '', urlObj);
    };

    const loadPDFFromURL = useCallback(async (originalUrl, side) => {
        if (!originalUrl) return;

        const url = originalUrl.trim();
        const allowRemote = import.meta.env.VITE_ENABLE_REMOTE_PDFS !== 'false';
        const allowLocal = import.meta.env.VITE_ENABLE_LOCAL_BRIDGE !== 'false';
        const endsWithPdf = url.toLowerCase().endsWith('.pdf');

        // Strict protocol detection (filenames can contain 'http')
        const isRemoteCandidate = url.startsWith('http://') || url.startsWith('https://');
        const isLocalCandidate = !isRemoteCandidate;

        if (isRemoteCandidate && !allowRemote) {
            setLoadingError({
                side,
                url,
                message: "Remote PDF loading is disabled by configuration. Please upload the file manually or use a local path."
            });
            return;
        }

        if (isLocalCandidate) {
            if (!allowLocal) {
                setLoadingError({
                    side,
                    url,
                    message: "Local file bridge is disabled by configuration. Please upload the file manually."
                });
                return;
            }

            // Local files must end in .pdf
            if (!endsWithPdf) {
                setLoadingError({
                    side,
                    url,
                    message: "Invalid local path. Local files must end in .pdf to be loaded."
                });
                return;
            }
        }

        setIsUrlLoading(prev => ({ ...prev, [side]: true }));

        try {
            let fetchUrl = url;

            // Route logic
            if (isRemoteCandidate) {
                if (import.meta.env.DEV) {
                    fetchUrl = `/api/pdf?path=${encodeURIComponent(url)}`;
                }
                // In PROD, we might use SideBySidePDF's fetchPDF logic which handles direct/proxy
            } else {
                fetchUrl = `/api/pdf?path=${encodeURIComponent(url)}`;
            }


            let arrayBuffer;
            let lastErr;

            // Proxy Fallback Chain: Direct -> AllOrigins -> CORS.lol -> corsproxy.io
            const attemptLoad = async () => {
                // 1. Try Direct (or Vite Bridge)
                try {
                    return await fetchPDF(fetchUrl, null);
                } catch (err) {
                    console.warn("Direct load failed:", err.message);
                    lastErr = err;

                    // Only fallback on NETWORK_ERROR (CORS, DNS, connection reset)
                    if (err.type === 'HTTP_ERROR') {
                        console.warn(`Bridge/Server reported status ${err.status}. CORS was not the blocker, so proxies were skipped.`);
                        throw err;
                    }

                    if (!isRemoteCandidate) {
                        throw new Error(`Local file load failed: ${err.message}`);
                    }

                    if (!allowRemote) {
                        throw new Error("Remote load blocked by secondary failsafe (policy disabled).");
                    }
                }

                // If it's a remote URL, try fallbacks
                if (isRemoteCandidate) {
                    const getProxyUrl = (target, type) => {
                        if (type === 'allorigins') return `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
                        if (type === 'cors.lol') return `https://cors.lol/${target}`;
                        if (type === 'corsproxy.io') return `https://corsproxy.io/?url=${encodeURIComponent(target)}`;
                        return target;
                    };

                    // 2. AllOrigins
                    try {
                        return await fetchPDF(getProxyUrl(url, 'allorigins'), 'allorigins');
                    } catch (err) {
                        console.warn("AllOrigins failed:", err.message);
                        lastErr = err;
                    }

                    // 3. CORS.lol
                    try {
                        return await fetchPDF(getProxyUrl(url, 'cors.lol'), 'cors.lol');
                    } catch (err) {
                        console.warn("CORS.lol failed:", err.message);
                        lastErr = err;
                    }

                    // 4. corsproxy.io
                    try {
                        return await fetchPDF(getProxyUrl(url, 'corsproxy.io'), 'corsproxy.io');
                    } catch (err) {
                        console.warn("corsproxy.io failed:", err.message);
                        lastErr = err;
                    }

                    throw new Error(`Failed to load remote PDF after multiple proxy attempts: ${lastErr?.message || 'Unknown error'}`);
                }

                throw lastErr || new Error("Unknown loading error.");
            };

            arrayBuffer = await attemptLoad();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

            let sourceUrl = null;
            if (/^https?:\/\//i.test(url)) {
                sourceUrl = url;
            } else if (typeof __REVEAL_ABSOLUTE_PATH__ !== 'undefined' && __REVEAL_ABSOLUTE_PATH__) {
                // Reconstruct absolute path for local files if allowed
                // __PDF_SAMPLES_ROOT__ is injected by Vite define
                const normalizedRoot = __PDF_SAMPLES_ROOT__.replace(/\\/g, '/');
                sourceUrl = `file:///${normalizedRoot}/${url}`;
            }

            const pdfData = {
                doc: pdfDoc,
                name: url.split(/[\\/]/).pop().split('?')[0] || 'Remote PDF',
                numPages: pdfDoc.numPages,
                data: arrayBuffer,
                sourceUrl: sourceUrl // Store formatted URL for "Open outside"
            };

            if (side === 'left') {
                setLeftPDF(pdfData);
                setLeftPage(1);
            } else {
                setRightPDF(pdfData);
                setRightPage(1);
            }
            updateUrlParams(side, url);
        } catch (err) {
            console.error(`Error loading ${side} PDF from URL:`, err);
            setLoadingError({
                side,
                url,
                message: err.message
            });
        } finally {
            setIsUrlLoading(prev => ({ ...prev, [side]: false }));
        }
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const leftUrl = params.get('a');
        const rightUrl = params.get('b');
        if (leftUrl) loadPDFFromURL(leftUrl, 'left');
        if (rightUrl) loadPDFFromURL(rightUrl, 'right');
    }, [loadPDFFromURL]);

    useEffect(() => {
        localStorage.setItem('pdf_author_name', authorName);
    }, [authorName]);

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

    useEffect(() => {
        if (Object.keys(comments).length > 0) {
            localStorage.setItem('pdf_comments_backup', JSON.stringify(comments));
        } else {
            localStorage.removeItem('pdf_comments_backup');
        }
    }, [comments]);

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

    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = `
      .textLayer {
        pointer-events: auto;
      }
      .textLayer > span {
        pointer-events: auto;
      }
      .textLayer ::selection {
        background: rgba(0, 100, 255, 0.5);
      }
      .pdf-page-canvas {
        display: block;
      }
    `;
        document.head.appendChild(style);

        return () => {
            if (document.head.contains(style)) document.head.removeChild(style);
        };
    }, []);

    const handleToggleSync = () => {
        if (!syncScroll) {
            // Turning ON
            // Calculate current offset
            if (viewMode === 'continuous' && leftComponentRef.current && rightComponentRef.current) {
                const leftGSP = leftComponentRef.current.getGlobalScrollPosition();
                const rightGSP = rightComponentRef.current.getGlobalScrollPosition();
                setSyncOffset(rightGSP - leftGSP);
            } else {
                setSyncOffset(0);
            }
            setSyncScroll(true);
        } else {
            // Turning OFF
            setSyncScroll(false);
        }
    };

    const handleScaleChange = (newScale, source, shouldSync = true) => {
        if (source === 'left') {
            setLeftScale(newScale);
            if (syncScroll && shouldSync) setRightScale(newScale);
        } else {
            setRightScale(newScale);
            if (syncScroll && shouldSync) setLeftScale(newScale);
        }
    };

    const handleFitToPageSync = (sourceSide) => {
        if (!syncScroll) return;
        const targetComponent = sourceSide === 'left' ? rightComponentRef : leftComponentRef;
        if (targetComponent.current) {
            targetComponent.current.triggerFitToPage();
        }
    };

    const handleFileUpload = async (e, side) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUrlLoading(prev => ({ ...prev, [side]: true }));

        if (!pdfjsLib) {
            console.error('PDF.js lib not loaded');
            alert('PDF engine is not ready. Please refresh the page.');
            setIsUrlLoading(prev => ({ ...prev, [side]: false }));
            return;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

            const pdfData = {
                doc: pdfDoc,
                name: file.name,
                numPages: pdfDoc.numPages,
                data: arrayBuffer,
                sourceUrl: URL.createObjectURL(file)
            };

            const extractedComments = {};
            try {
                const pdfLibDoc = await PDFDocument.load(arrayBuffer);
                const pages = pdfLibDoc.getPages();

                const getText = (obj) => {
                    if (!obj) return null;
                    try {
                        if (typeof obj.decodeText === 'function') return obj.decodeText();
                        if (typeof obj.asString === 'function') return obj.asString();
                        const str = obj.toString();
                        return str.replace(/^\/|^\(|\)$/g, '');
                    } catch {
                        return null;
                    }
                };

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
        } finally {
            setIsUrlLoading(prev => ({ ...prev, [side]: false }));
        }
    };

    const handleScroll = (e, source, scrollInfo = null) => {
        if (!syncScroll) return;

        // Store the latest scroll data for RAF processing
        pendingSyncRef.current = {
            scrollTop: e.target.scrollTop,
            scrollHeight: e.target.scrollHeight,
            clientHeight: e.target.clientHeight,
            scrollLeft: e.target.scrollLeft,
            scrollWidth: e.target.scrollWidth,
            clientWidth: e.target.clientWidth,
            source,
            scrollInfo
        };

        // Skip if RAF already scheduled
        if (syncRAFRef.current) return;

        syncRAFRef.current = requestAnimationFrame(() => {
            syncRAFRef.current = null;
            const data = pendingSyncRef.current;
            if (!data) return;

            const { source, scrollInfo } = data;
            const targetViewer = source === 'left' ? rightViewerRef : leftViewerRef;
            const targetComponent = source === 'left' ? rightComponentRef : leftComponentRef;

            // Prevent infinite loop
            const setSyncLock = (side) => {
                if (side === 'left') {
                    isSyncingLeft.current = true;
                    // Safety timeout
                    if (leftSyncTimeoutRef.current) clearTimeout(leftSyncTimeoutRef.current);
                    leftSyncTimeoutRef.current = setTimeout(() => isSyncingLeft.current = false, 100);
                } else {
                    isSyncingRight.current = true;
                    // Safety timeout
                    if (rightSyncTimeoutRef.current) clearTimeout(rightSyncTimeoutRef.current);
                    rightSyncTimeoutRef.current = setTimeout(() => isSyncingRight.current = false, 100);
                }
            };

            if (source === 'left') {
                if (isSyncingLeft.current) {
                    isSyncingLeft.current = false; // Acknowledge receipt
                    return;
                }
            } else {
                if (isSyncingRight.current) {
                    isSyncingRight.current = false; // Acknowledge receipt
                    return;
                }
            }

            // Page-Relative Sync Logic for Continuous Mode (Restored)
            if (viewMode === 'continuous' && scrollInfo && targetComponent.current) {
                const sourceGSP = (scrollInfo.page - 1) + scrollInfo.percent;
                let targetGSP;
                if (source === 'left') {
                    targetGSP = sourceGSP + syncOffset;
                } else {
                    targetGSP = sourceGSP - syncOffset;
                }

                const targetNumPages = source === 'left' ? rightPDF?.numPages : leftPDF?.numPages;
                if (targetNumPages) {
                    targetGSP = Math.max(0, Math.min(targetGSP, targetNumPages));
                }

                // Variance Check: Is target already close enough?
                const currentTargetGSP = targetComponent.current.getGlobalScrollPosition();
                const verticalDiff = Math.abs(currentTargetGSP - targetGSP);

                // Horizontal Calculation
                const hasHorizontalScroll = data.scrollWidth > data.clientWidth;
                let horizontalPercent = 0;
                if (hasHorizontalScroll) {
                    horizontalPercent = data.scrollLeft / (data.scrollWidth - data.clientWidth);
                }

                let horizontalSynced = true;
                if (targetViewer.current) {
                    const tMax = targetViewer.current.scrollWidth - targetViewer.current.clientWidth;
                    if (tMax > 0) {
                        const tCurrent = targetViewer.current.scrollLeft;
                        const tExpected = tMax * horizontalPercent;
                        if (Math.abs(tCurrent - tExpected) > 5) horizontalSynced = false;
                    }
                }

                // Only skip if BOTH are synced
                if (verticalDiff < 0.005 && horizontalSynced) return;

                // Lock Target
                setSyncLock(source === 'left' ? 'right' : 'left');

                const targetPage = Math.floor(targetGSP) + 1;
                const targetPercent = targetGSP % 1;

                targetComponent.current.scrollToPagePercent(targetPage, targetPercent, horizontalPercent);
            }
            else if (targetViewer.current) {
                setSyncLock(source === 'left' ? 'right' : 'left');

                const scrollPercentage = data.scrollTop / (data.scrollHeight - data.clientHeight || 1);
                const targetMaxScroll = targetViewer.current.scrollHeight - targetViewer.current.clientHeight;
                targetViewer.current.scrollTop = scrollPercentage * targetMaxScroll;

                const scrollLeftPercentage = data.scrollLeft / (data.scrollWidth - data.clientWidth || 1);
                const targetMaxScrollLeft = targetViewer.current.scrollWidth - targetViewer.current.clientWidth;
                targetViewer.current.scrollLeft = scrollLeftPercentage * targetMaxScrollLeft;
            }
        });
    };

    // Cleanup Timeouts
    useEffect(() => {
        return () => {
            if (leftSyncTimeoutRef.current) clearTimeout(leftSyncTimeoutRef.current);
            if (rightSyncTimeoutRef.current) clearTimeout(rightSyncTimeoutRef.current);
        };
    }, []);

    const handlePageChange = (newPage, side) => {
        const oldPage = side === 'left' ? leftPage : rightPage;
        const delta = newPage - oldPage;

        if (side === 'left') {
            setLeftPage(newPage);
            // Scroll sync handles alignment in continuous mode
            if (syncScroll && rightPDF && viewMode !== 'continuous') {
                setRightPage(prev => Math.min(Math.max(1, prev + delta), rightPDF.numPages));
            }
        } else {
            setRightPage(newPage);
            if (syncScroll && leftPDF && viewMode !== 'continuous') {
                setLeftPage(prev => Math.min(Math.max(1, prev + delta), leftPDF.numPages));
            }
        }
    };

    const addComment = (side, x, y, highlightRects = null, selectedText = '', pageNum = null) => {
        const id = `${side}-${Date.now()}`;
        // Use the explicitly passed page number, or fall back to current page state
        const targetPage = pageNum ?? (side === 'left' ? leftPage : rightPage);
        const newComment = {
            id,
            side,
            x,
            y,
            text: '',
            highlightRects,
            selectedText,
            page: targetPage
        };

        if (side === 'left') {
            setLeftActiveComment(newComment);
            setLeftCommentText('');
        } else {
            setRightActiveComment(newComment);
            setRightCommentText('');
        }
        setIsDirty(true);
    };

    const addHighlight = (side, x, y, highlightRects, selectedText, pageNum = null) => {
        const id = `${side}-highlight-${Date.now()}`;
        // Use the explicitly passed page number, or fall back to current page state
        const targetPage = pageNum ?? (side === 'left' ? leftPage : rightPage);
        setComments(prev => ({
            ...prev,
            [id]: {
                id,
                side,
                x,
                y,
                text: '', // Empty text for pure highlight
                highlightRects,
                selectedText,
                page: targetPage,
                timestamp: new Date().toISOString(),
                author: authorName
            }
        }));
        setIsDirty(true);
    };

    const saveComment = (side) => {
        const active = side === 'left' ? leftActiveComment : rightActiveComment;
        const text = side === 'left' ? leftCommentText : rightCommentText;

        if (active && text.trim()) {
            setComments(prev => ({
                ...prev,
                [active.id]: {
                    ...active,
                    text: text,
                    author: authorName,
                    page: active.page || (side === 'left' ? leftPage : rightPage),
                    timestamp: new Date().toISOString()
                }
            }));

            if (side === 'left') {
                setLeftActiveComment(null);
                setLeftCommentText('');
            } else {
                setRightActiveComment(null);
                setRightCommentText('');
            }
            setIsDirty(true);
        }
    };

    const deleteComment = (id) => {
        setComments(prev => {
            const newComments = { ...prev };
            delete newComments[id];
            // Set isDirty based on whether there are still comments remaining
            setIsDirty(Object.keys(newComments).length > 0);
            return newComments;
        });
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

            for (const comment of sideComments) {
                const pageIndex = comment.page - 1;
                if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

                const page = pdfDoc.getPage(pageIndex);
                const { width, height } = page.getSize();

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
                const highlightColor = [1, 1, 0];
                const annotId = `annot-${comment.id}-${Date.now()}`;

                let annot;
                let annotRect;

                if (comment.highlightRects || comment.highlightRect) {
                    const rects = comment.highlightRects || [comment.highlightRect];
                    const quadPoints = [];
                    let minL = Infinity, minB = Infinity, maxR = -Infinity, maxT = -Infinity;

                    for (const hr of rects) {
                        const left = (hr.left / 100) * width;
                        const right = (hr.right / 100) * width;
                        const top = height - ((hr.top / 100) * height);
                        const bottom = height - ((hr.bottom / 100) * height);

                        quadPoints.push(left, top, right, top, left, bottom, right, bottom);

                        minL = Math.min(minL, left);
                        minB = Math.min(minB, bottom);
                        maxR = Math.max(maxR, right);
                        maxT = Math.max(maxT, top);
                    }

                    annotRect = [minL, minB, maxR, maxT];

                    annot = pdfDoc.context.obj({
                        Type: PDFName.of('Annot'),
                        Subtype: PDFName.of('Highlight'),
                        NM: PDFString.of(annotId),
                        Rect: annotRect,
                        QuadPoints: quadPoints,
                        Contents: PDFString.of(comment.text || ''),
                        C: highlightColor,
                        CA: 0.4,
                        F: 4,
                        T: PDFString.of(comment.author || 'Author'),
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
                        Contents: PDFString.of(comment.text || ''),
                        C: highlightColor,
                        Name: PDFName.of('Comment'),
                        Open: false,
                        F: 4,
                        T: PDFString.of(comment.author || 'Author'),
                        M: PDFString.of(formatPDFDate(commentDate)),
                        CreationDate: PDFString.of(formatPDFDate(commentDate)),
                    });
                }

                const annotRef = pdfDoc.context.register(annot);

                // Only add popup if there is text content
                if (comment.text && comment.text.trim()) {
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
                } else {
                    // Just add the annotation
                    const existingAnnots = page.node.lookup(PDFName.of('Annots'));
                    if (existingAnnots instanceof PDFArray) {
                        existingAnnots.push(annotRef);
                    } else {
                        const newAnnots = pdfDoc.context.obj([annotRef]);
                        page.node.set(PDFName.of('Annots'), newAnnots);
                    }
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

            setIsDirty(false);
            localStorage.removeItem('pdf_comments_backup');
        } catch (err) {
            console.error(`Error exporting ${side} PDF:`, err);
            alert(`Failed to export ${side} PDF.`);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">


            {loadingError && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-top fade-in duration-300 w-full max-w-2xl px-4">
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-none shadow-lg flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm">Error Loading PDF</p>
                            <p className="text-sm mt-1 opacity-90 whitespace-normal break-words leading-relaxed">{loadingError.message}</p>
                            <p className="text-xs mt-2 font-mono bg-red-100 px-2 py-1 rounded-none break-words whitespace-normal">{loadingError.url}</p>
                        </div>
                        <button onClick={() => setLoadingError(null)} className="ml-2 text-red-400 hover:text-red-700">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            <main className="flex-1 flex overflow-hidden">
                <PDFViewer
                    className="flex-1 border-r border-gray-300 relative"
                    ref={leftComponentRef} // Use Component Ref
                    viewerRef={leftViewerRef} // Legacy dom ref
                    pdf={leftPDF}
                    side="left"
                    page={leftPage}
                    setPage={(p) => handlePageChange(p, 'left')}
                    scale={leftScale}
                    setScale={(s, sync) => handleScaleChange(s, 'left', sync)}
                    viewMode={viewMode}
                    setViewMode={handleSetViewMode}
                    onScroll={(e, _side, info) => handleScroll(e, 'left', info)}
                    onUpload={(e) => handleFileUpload(e, 'left')}
                    onExport={() => processPDFAndDownload('left')}
                    comments={comments}
                    deleteComment={deleteComment}
                    activeComment={leftActiveComment}
                    setActiveComment={setLeftActiveComment}
                    commentText={leftCommentText}
                    setCommentText={setLeftCommentText}
                    saveComment={() => saveComment('left')}
                    addComment={addComment}
                    addHighlight={addHighlight}
                    syncScroll={syncScroll}
                    setSyncScroll={handleToggleSync}
                    hasComments={Object.values(comments).some(c => c.side === 'left')}
                    isDirty={isDirty}
                    authorName={authorName}
                    setAuthorName={setAuthorName}
                    onClose={() => setLeftPDF(null)}
                    onLoadFromUrl={(url) => loadPDFFromURL(url, 'left')}
                    onFitToPage={() => handleFitToPageSync('left')}
                    isLoading={isUrlLoading.left}
                />
                <PDFViewer
                    className="flex-1 relative"
                    ref={rightComponentRef} // Use Component Ref
                    viewerRef={rightViewerRef} // Legacy dom ref
                    pdf={rightPDF}
                    side="right"
                    page={rightPage}
                    setPage={(p) => handlePageChange(p, 'right')}
                    scale={rightScale}
                    setScale={(s, sync) => handleScaleChange(s, 'right', sync)}
                    viewMode={viewMode}
                    setViewMode={handleSetViewMode}
                    onScroll={(e, _side, info) => handleScroll(e, 'right', info)}
                    onUpload={(e) => handleFileUpload(e, 'right')}
                    onExport={() => processPDFAndDownload('right')}
                    comments={comments}
                    deleteComment={deleteComment}
                    activeComment={rightActiveComment}
                    setActiveComment={setRightActiveComment}
                    commentText={rightCommentText}
                    setCommentText={setRightCommentText}
                    saveComment={() => saveComment('right')}
                    addComment={addComment}
                    addHighlight={addHighlight}
                    syncScroll={syncScroll}
                    setSyncScroll={handleToggleSync}
                    hasComments={Object.values(comments).some(c => c.side === 'right')}
                    isDirty={isDirty}
                    authorName={authorName}
                    setAuthorName={setAuthorName}
                    onClose={() => setRightPDF(null)}
                    onLoadFromUrl={(url) => loadPDFFromURL(url, 'right')}
                    onFitToPage={() => handleFitToPageSync('right')}
                    isLoading={isUrlLoading.right}
                />
            </main>
        </div>
    );
}
