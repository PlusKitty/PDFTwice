import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { PDFDocument, StandardFonts, PDFName, PDFArray, PDFNumber, PDFString, PDFHexString } from 'pdf-lib';
import PDFViewer from './PDFViewer';

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
    const [closeConfirmSide, setCloseConfirmSide] = useState(null);
    const [isUrlLoading, setIsUrlLoading] = useState({ left: false, right: false });

    // Update URL without reloading
    const updateUrlParams = (side, url) => {
        const urlObj = new URL(window.location);
        if (url) {
            urlObj.searchParams.set(side, url);
        } else {
            urlObj.searchParams.delete(side);
        }
        window.history.pushState({}, '', urlObj);
    };

    // URL Loading Logic
    const loadPDFFromURL = useCallback(async (url, side) => {
        if (!url || !pdfjsLoaded) return;
        setIsUrlLoading(prev => ({ ...prev, [side]: true }));

        try {
            let fetchUrl = url;
            // Validate input
            if (!url || typeof url !== 'string') return;

            // Detect if it's a likely URL or local path
            const isUrl = /^(https?:\/\/)/i.test(url);
            const isLocalPath = /^[a-zA-Z]:\\/.test(url) || url.startsWith('\\\\') || url.startsWith('/');

            if (!isUrl && !isLocalPath) {
                // If it's just a random string like "d" and not a path/url, probably garbage input
                throw new Error("Invalid URL or file path. Please enter a valid http/https URL or local file path.");
            }

            if (isLocalPath && !url.startsWith('http')) {
                fetchUrl = `/api/pdf?path=${encodeURIComponent(url)}`;
            } else if (import.meta.env.DEV && isUrl) {
                // In local development, use our own Vite proxy to bypass CORS
                console.log("Using local Vite proxy for:", url);
                fetchUrl = `/api/pdf?path=${encodeURIComponent(url)}`;
            }

            const fetchPDF = async (targetUrl, useProxy = false) => {
                const finalUrl = useProxy
                    ? `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
                    : targetUrl;

                const res = await fetch(finalUrl);
                const cType = res.headers.get('content-type');

                if (!res.ok) {
                    // If it's a 404/local error, don't retry with proxy
                    if (res.status === 404 || res.status === 403) {
                        const txt = await res.text();
                        throw new Error(`HTTP ${res.status}: ${txt ? txt.substring(0, 50) : res.statusText}`);
                    }
                    throw new Error('Network response not ok');
                }

                if (cType && cType.includes('text/html')) {
                    throw new Error("The URL returned a web page instead of a PDF.");
                }

                return res.arrayBuffer();
            }

            let arrayBuffer;
            try {
                arrayBuffer = await fetchPDF(fetchUrl, false);
            } catch (initialErr) {
                // If it's a URL (not local path) and network error, try proxy
                if (isUrl && !fetchUrl.includes('api/pdf')) {
                    try {
                        console.log("Direct fetch failed, trying CORS proxy...");
                        arrayBuffer = await fetchPDF(fetchUrl, true);
                    } catch (proxyErr) {
                        throw new Error(`Failed to load PDF. Possible CORS restriction. Try downloading the file and uploading it manually. (${initialErr.message})`);
                    }
                } else {
                    throw initialErr;
                }
            }
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
        const file = e.target.files[0];
        if (!file) return;
        setIsUrlLoading(prev => ({ ...prev, [side]: true }));

        if (!pdfjsLoaded || !window.pdfjsLib) {
            console.error('PDF.js lib not loaded');
            alert('PDF engine is not ready yet. Please wait a moment.');
            setIsUrlLoading(prev => ({ ...prev, [side]: false }));
            return;
        }

        if (file.type !== 'application/pdf') {
            console.warn('File type is not application/pdf:', file.type);
            // Proceed cautiously
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            // We need to keep the buffer for export. 
            // pdfjsLib.getDocument might transfer the buffer if it was a worker, but we are in main thread or using workerSrc.
            // Let's copy it or pass it. 
            const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

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
        } finally {
            setIsUrlLoading(prev => ({ ...prev, [side]: false }));
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

    const forceClosePDF = (side) => {
        if (side === 'left') {
            setLeftPDF(null);
            setLeftPage(1);
            setLeftScale(1.0);
        } else {
            setRightPDF(null);
            setRightPage(1);
            setRightScale(1.0);
        }

        // Remove comments for this side
        setComments(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
                if (next[key].side === side) delete next[key];
            });
            return next;
        });

        // Update URL and clear dirty if needed
        updateUrlParams(side, null);
        setCloseConfirmSide(null);

        // Check if any comments remain for the OTHER side
        const otherSide = side === 'left' ? 'right' : 'left';
        const hasOtherComments = Object.values(comments).some(c => c.side === otherSide);
        if (!hasOtherComments) setIsDirty(false);
    };

    const handleCloseRequest = (side) => {
        const hasSideComments = Object.values(comments).some(c => c.side === side);
        if (hasSideComments) {
            setCloseConfirmSide(side);
        } else {
            forceClosePDF(side);
        }
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
                    onClose={() => handleCloseRequest('left')}
                    onLoadFromUrl={(url) => loadPDFFromURL(url, 'left')}
                    isLoading={isUrlLoading.left}
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
                    onClose={() => handleCloseRequest('right')}
                    onLoadFromUrl={(url) => loadPDFFromURL(url, 'right')}
                    isLoading={isUrlLoading.right}
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

            {/* Close Confirmation Modal */}
            {closeConfirmSide && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 border border-gray-100 transform animate-in slide-in-from-bottom-4 duration-300">
                        <h2 className="text-lg font-bold text-gray-900 mb-2">Unsaved Changes</h2>
                        <p className="text-sm text-gray-600 mb-6">
                            You have unsaved comments on the {closeConfirmSide} PDF. Closing it will discard them.
                        </p>
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={async () => {
                                    await exportSinglePDF(closeConfirmSide);
                                    forceClosePDF(closeConfirmSide);
                                }}
                                className="w-full bg-purple-600 text-white rounded-lg py-2 font-medium hover:bg-purple-700 transition-colors"
                            >
                                Save & Close
                            </button>
                            <button
                                onClick={() => forceClosePDF(closeConfirmSide)}
                                className="w-full bg-white border border-red-200 text-red-600 rounded-lg py-2 font-medium hover:bg-red-50 transition-colors"
                            >
                                Close without Saving
                            </button>
                            <button
                                onClick={() => setCloseConfirmSide(null)}
                                className="w-full bg-gray-100 text-gray-700 rounded-lg py-2 font-medium hover:bg-gray-200 transition-colors mt-2"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

}
