/* global __REVEAL_ABSOLUTE_PATH__, __PDF_SAMPLES_ROOT__ */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AlertTriangle, X, Check } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import PDFViewer from './PDFViewer';
import { exportPDFWithAnnotations, downloadPDF, generateExportFilename, savePDFToPath } from './utils/pdfExport';
import { PDFDocument, PDFName, PDFArray, PDFNumber } from 'pdf-lib';
import useAnnotations from './hooks/useAnnotations';

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
    } catch {
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
        } catch { /* ignore text extraction errors */ }

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
    const [authorName, setAuthorName] = useState(() => localStorage.getItem('pdf_author_name') || 'User');

    // Detect if running in Tauri
    const isTauri = '__TAURI__' in window;

    // Export settings (Tauri mode)
    const [exportSettings, setExportSettings] = useState(() => {
        const saved = localStorage.getItem('pdftwice_export_settings');
        return saved ? JSON.parse(saved) : {
            autoSaveToSource: false,
            filenamePrefix: '',
            filenameSuffix: '_commented'
        };
    });

    // Annotations (comments/highlights) from hook
    const {
        comments,
        setComments,
        leftActiveComment,
        rightActiveComment,
        leftCommentText,
        rightCommentText,
        leftDirty,
        rightDirty,
        setLeftActiveComment,
        setRightActiveComment,
        setLeftCommentText,
        setRightCommentText,
        setLeftDirty,
        setRightDirty,
        addComment,
        addHighlight,
        saveComment,
        deleteComment,
    } = useAnnotations({ authorName });
    const [leftBookmarks, setLeftBookmarks] = useState([]);
    const [rightBookmarks, setRightBookmarks] = useState([]);
    const lastExportedLeftBookmarks = useRef(null); // Track last exported bookmark count
    const lastExportedRightBookmarks = useRef(null);
    const [loadingError, setLoadingError] = useState(null);
    const [isUrlLoading, setIsUrlLoading] = useState({ left: false, right: false });
    const [toast, setToast] = useState({ visible: false, message: '' });

    // Drag & Drop State
    const [dragTarget, setDragTarget] = useState('none'); // 'none', 'left', 'right'


    useEffect(() => {
        if (toast.visible) {
            const timer = setTimeout(() => {
                setToast(prev => ({ ...prev, visible: false }));
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [toast.visible]);

    // Hide inline splash screen once React mounts (works for both web and Tauri)
    useEffect(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            // Add hidden class for fade-out transition
            splash.classList.add('hidden');
            // Remove from DOM after transition
            setTimeout(() => splash.remove(), 300);
        }
    }, []);

    // F11 fullscreen toggle (Tauri only)
    useEffect(() => {
        if (!isTauri) return;

        const handleKeyDown = async (e) => {
            if (e.key === 'F11') {
                e.preventDefault();
                try {
                    const win = window.__TAURI__?.window?.getCurrentWindow?.();
                    if (win) {
                        const isFullscreen = await win.isFullscreen();
                        await win.setFullscreen(!isFullscreen);
                    }
                } catch (err) {
                    console.warn('Failed to toggle fullscreen:', err);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isTauri]);

    // Drag & Drop logic moved to after loadPdfFromPath definition to avoid ReferenceError

    const [viewMode, setViewMode] = useState(() => localStorage.getItem('pdf_view_mode') || 'single');

    // Default Zoom Settings
    const [scaleMode, setScaleMode] = useState(() => localStorage.getItem('pdf_scale_mode') || 'fit'); // 'fit' | 'level'
    const [defaultScaleLevel, setDefaultScaleLevel] = useState(() => parseInt(localStorage.getItem('pdf_default_scale_level'), 10) || 100);

    // Alt Text Settings (Advanced)
    const [altTextSettings, setAltTextSettings] = useState(() => {
        const saved = localStorage.getItem('pdf_alttext_settings');
        return saved ? JSON.parse(saved) : {
            showIndicator: true,
            fallbackMode: 'spatial' // 'spatial' | 'draw'
        };
    });

    const handleSetScaleMode = (mode) => {
        setScaleMode(mode);
        localStorage.setItem('pdf_scale_mode', mode);
    };

    const handleSetDefaultScaleLevel = (level) => {
        setDefaultScaleLevel(level);
        localStorage.setItem('pdf_default_scale_level', level);
    };

    const handleSetAltTextSettings = (updater) => {
        setAltTextSettings(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            localStorage.setItem('pdf_alttext_settings', JSON.stringify(next));
            return next;
        });
    };

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

    // Apply default zoom when PDF loads
    // Calculate fit scale BEFORE first render to avoid wasteful scale=1 render
    useEffect(() => {
        if (leftPDF) {
            if (scaleMode === 'fit') {
                // Calculate fit scale synchronously using RAF for DOM readiness
                requestAnimationFrame(async () => {
                    try {
                        const pageObj = await leftPDF.doc.getPage(1);
                        const viewport = pageObj.getViewport({ scale: 1.0 });
                        const viewer = leftViewerRef.current;
                        if (viewer) {
                            const buffer = 4;
                            const fitScale = Math.min(
                                (viewer.clientWidth - buffer) / viewport.width,
                                (viewer.clientHeight - buffer) / viewport.height
                            );
                            setLeftScale(Math.min(Math.max(0.25, fitScale), 3));
                        }
                    } catch (e) {
                        console.warn('Failed to calculate fit scale for left PDF:', e);
                        setLeftScale(1.0); // Fallback
                    }
                });
            } else {
                setLeftScale(defaultScaleLevel / 100);
            }
        }
    }, [leftPDF, scaleMode, defaultScaleLevel]);

    useEffect(() => {
        if (rightPDF) {
            if (scaleMode === 'fit') {
                requestAnimationFrame(async () => {
                    try {
                        const pageObj = await rightPDF.doc.getPage(1);
                        const viewport = pageObj.getViewport({ scale: 1.0 });
                        const viewer = rightViewerRef.current;
                        if (viewer) {
                            const buffer = 4;
                            const fitScale = Math.min(
                                (viewer.clientWidth - buffer) / viewport.width,
                                (viewer.clientHeight - buffer) / viewport.height
                            );
                            setRightScale(Math.min(Math.max(0.25, fitScale), 3));
                        }
                    } catch (e) {
                        console.warn('Failed to calculate fit scale for right PDF:', e);
                        setRightScale(1.0); // Fallback
                    }
                });
            } else {
                setRightScale(defaultScaleLevel / 100);
            }
        }
    }, [rightPDF, scaleMode, defaultScaleLevel]);

    const isSyncingLeft = useRef(false);
    const isSyncingRight = useRef(false);
    const leftSyncTimeoutRef = useRef(null);
    const rightSyncTimeoutRef = useRef(null);

    // RAF throttling for smooth scroll sync
    const syncRAFRef = useRef(null);
    const pendingSyncRef = useRef(null);

    const handleLeftBookmarksChange = useCallback((bm) => {
        setLeftBookmarks(bm);
        if (lastExportedLeftBookmarks.current !== null && bm.length !== lastExportedLeftBookmarks.current) {
            setLeftDirty(true);
        } else if (lastExportedLeftBookmarks.current === null && bm.length > 0) {
            setLeftDirty(true);
        }
    }, [setLeftDirty]);

    const handleRightBookmarksChange = useCallback((bm) => {
        setRightBookmarks(bm);
        if (lastExportedRightBookmarks.current !== null && bm.length !== lastExportedRightBookmarks.current) {
            setRightDirty(true);
        } else if (lastExportedRightBookmarks.current === null && bm.length > 0) {
            setRightDirty(true);
        }
    }, [setRightDirty]);

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

            // Make a copy for storage - PDF.js may detach the original buffer
            const storedData = arrayBuffer.slice(0);
            const dataForPdfJs = arrayBuffer.slice(0);

            const pdfDoc = await pdfjsLib.getDocument({ data: dataForPdfJs, isEvalSupported: false, verbosity: 0 }).promise;

            // Extract PDF outline (table of contents)
            let outline = [];
            try {
                outline = await pdfDoc.getOutline() || [];
            } catch (e) {
                console.warn('Failed to extract PDF outline:', e);
            }

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
                data: storedData, // Use the preserved copy
                sourceUrl: sourceUrl, // Store formatted URL for "Open outside"
                outline: outline // PDF table of contents
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

    // Load PDF from local file path (Tauri only)
    const loadPdfFromPath = useCallback(async (filePath, side) => {
        const tauri = window.__TAURI__;
        if (!tauri?.core?.invoke) return;

        try {
            setIsUrlLoading(prev => ({ ...prev, [side]: true }));

            // Use global Tauri object
            const pdfBytes = await tauri.core.invoke('read_pdf_file', { path: filePath });


            // Convert to Uint8Array and make a COPY for storage
            // PDF.js may transfer buffer ownership to its worker, detaching the original
            const originalData = new Uint8Array(pdfBytes);
            const dataForPdfJs = originalData.slice(); // Copy for PDF.js to consume

            // Load with pdf.js (may detach the buffer)
            const loadingTask = pdfjsLib.getDocument({ data: dataForPdfJs, isEvalSupported: false, verbosity: 0 });
            const doc = await loadingTask.promise;

            // Extract filename from path
            const fileName = filePath.split('\\').pop() || filePath.split('/').pop() || 'document.pdf';

            // Get outline (bookmarks) if available
            let outline = [];
            try {
                outline = await doc.getOutline() || [];
            } catch { /* ignore outline errors */ }

            const pdfData = {
                doc,
                data: originalData, // Use the preserved copy
                numPages: doc.numPages,
                name: fileName,
                url: `file:///${filePath}`, // Kept for legacy compatibility if needed
                sourceUrl: `file:///${filePath}`, // Required for FileInfo link and "Show in folder"
                sourcePath: filePath, // Store original path for auto-save feature
                outline,
            };

            if (side === 'left') {
                setLeftPDF(pdfData);
                setLeftPage(1);
            } else {
                setRightPDF(pdfData);
                setRightPage(1);
            }
        } catch (err) {
            console.error(`Failed to load PDF from path ${filePath}:`, err);
            setLoadingError({
                side,
                url: filePath,
                message: `Failed to load file: ${err.message || err}`
            });
        } finally {
            setIsUrlLoading(prev => ({ ...prev, [side]: false }));
        }
    }, []);

    // Native Drag & Drop using Tauri v2 API
    // Uses getCurrentWebview().onDragDropEvent() instead of legacy tauri://file-drop events
    useEffect(() => {
        if (!isTauri) return;

        const tauriWebview = window.__TAURI__?.webview;
        if (!tauriWebview?.getCurrentWebview) return;

        let unlisten = null;
        let dragTimeout;

        const setup = async () => {
            try {
                const webview = tauriWebview.getCurrentWebview();
                unlisten = await webview.onDragDropEvent((event) => {
                    const { type, paths, position } = event.payload;

                    if (type === 'enter' || type === 'over') {
                        // Determine which side based on position
                        const width = window.innerWidth;
                        const side = position.x < width / 2 ? 'left' : 'right';
                        setDragTarget(side);

                        // Debounce/Timeout to clear if drag leaves
                        clearTimeout(dragTimeout);
                        dragTimeout = setTimeout(() => {
                            setDragTarget('none');
                        }, 500);
                    } else if (type === 'drop') {
                        // Load the dropped file
                        if (Array.isArray(paths) && paths.length > 0) {
                            const width = window.innerWidth;
                            const side = position.x < width / 2 ? 'left' : 'right';
                            const pdfPath = paths.find(p => p.toLowerCase().endsWith('.pdf'));
                            if (pdfPath) {
                                loadPdfFromPath(pdfPath, side);
                            }
                        }
                        setDragTarget('none');
                        clearTimeout(dragTimeout);
                    } else if (type === 'leave') {
                        setDragTarget('none');
                        clearTimeout(dragTimeout);
                    }
                });
            } catch (err) {
                console.warn('Failed to setup drag/drop listener:', err);
            }
        };

        setup();

        return () => {
            clearTimeout(dragTimeout);
            if (unlisten) unlisten();
        };
    }, [isTauri, loadPdfFromPath]);


    // Load CLI argument PDFs on mount (Tauri only - fails gracefully in web mode)
    useEffect(() => {
        const loadCliArgs = async () => {
            try {
                // Use global Tauri object (set by withGlobalTauri: true)
                const tauri = window.__TAURI__;
                if (!tauri?.core?.invoke) return;

                const paths = await tauri.core.invoke('get_cli_pdf_paths');

                if (Array.isArray(paths) && paths.length > 0) {
                    // Load first PDF on left
                    loadPdfFromPath(paths[0], 'left');
                    // Load second PDF on right (if provided)
                    if (paths.length > 1) {
                        loadPdfFromPath(paths[1], 'right');
                    }
                }
            } catch (err) {
                // Fails silently in web mode or if Tauri is not ready
                console.error('Failed to load CLI args:', err);
            }
        };

        loadCliArgs();
    }, [loadPdfFromPath]);

    useEffect(() => {
        localStorage.setItem('pdf_author_name', authorName);
    }, [authorName]);

    // Persist export settings
    useEffect(() => {
        localStorage.setItem('pdftwice_export_settings', JSON.stringify(exportSettings));
    }, [exportSettings]);

    useEffect(() => {
        const savedComments = localStorage.getItem('pdf_comments_backup');
        if (savedComments) {
            try {
                const parsed = JSON.parse(savedComments);
                if (Object.keys(parsed).length > 0) {
                    const confirmRestore = window.confirm("You have unsaved comments from a previous session. Would you like to restore them?");
                    if (confirmRestore) {
                        setComments(parsed);
                        setComments(parsed);
                        // Start clean after restore until change? Or dirty? 
                        // Usually restore means we have unsaved work.
                        // We'll mark both as dirty if there are any comments for that side.
                        const hasLeft = Object.values(parsed).some(c => c.side === 'left');
                        const hasRight = Object.values(parsed).some(c => c.side === 'right');
                        if (hasLeft) setLeftDirty(true);
                        if (hasRight) setRightDirty(true);
                    } else {
                        localStorage.removeItem('pdf_comments_backup');
                    }
                }
            } catch (e) {
                console.error("Failed to parse saved comments", e);
            }
        }
    }, [setComments, setLeftDirty, setRightDirty]);

    useEffect(() => {
        if (Object.keys(comments).length > 0) {
            localStorage.setItem('pdf_comments_backup', JSON.stringify(comments));
        } else {
            localStorage.removeItem('pdf_comments_backup');
        }
    }, [comments]);

    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (leftDirty || rightDirty) {
                const msg = "You have unsaved changes. Are you sure you want to leave?";
                e.returnValue = msg;
                return msg;
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [leftDirty, rightDirty]);

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

            // Make a copy for storage - PDF.js may detach the original buffer
            const storedData = arrayBuffer.slice(0);
            const dataForPdfJs = arrayBuffer.slice(0);

            const pdfDoc = await pdfjsLib.getDocument({ data: dataForPdfJs, isEvalSupported: false, verbosity: 0 }).promise;

            // Extract PDF outline (table of contents)
            let outline = [];
            try {
                outline = await pdfDoc.getOutline() || [];
            } catch (e) {
                console.warn('Failed to extract PDF outline:', e);
            }

            const pdfData = {
                doc: pdfDoc,
                name: file.name,
                numPages: pdfDoc.numPages,
                data: storedData, // Use the preserved copy
                sourceUrl: file.path ? `file:///${file.path}` : URL.createObjectURL(file), // Use native path if available (Tauri), else blob URL
                sourcePath: file.path || null, // Capture native path if available
                outline: outline // PDF table of contents
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

    // Note: addComment, addHighlight, saveComment, deleteComment are now provided by useAnnotations hook

    const processPDFAndDownload = async (side) => {
        const pdfData = side === 'left' ? leftPDF : rightPDF;
        if (!pdfData) {
            console.error(`No PDF loaded on ${side} side`);
            return;
        }

        if (!pdfData.data) return;

        const sideComments = Object.values(comments).filter(c => c.side === side);
        const sideBookmarks = side === 'left' ? leftBookmarks : rightBookmarks;

        // Allow export if we have comments OR bookmarks
        if (sideComments.length === 0 && sideBookmarks.length === 0) {
            alert(`No comments or bookmarks to export for the ${side} PDF.`);
            return;
        }

        try {
            // Use pdfExport utility for the heavy lifting
            const pdfBytes = await exportPDFWithAnnotations(
                pdfData.data,
                sideComments,
                sideBookmarks
            );

            // Generate filename with prefix/suffix from settings
            const filename = generateExportFilename(
                pdfData.name,
                exportSettings.filenamePrefix,
                exportSettings.filenameSuffix
            );

            // Tauri auto-save mode: write directly to source folder
            if (isTauri && exportSettings.autoSaveToSource && pdfData.sourcePath) {
                const dir = pdfData.sourcePath.substring(0, pdfData.sourcePath.lastIndexOf('\\'));
                const outputPath = `${dir}\\${filename}`;
                await savePDFToPath(pdfBytes, outputPath);
                setToast({ visible: true, message: `Saved as ${filename}` });
            } else {
                // Standard browser download
                downloadPDF(pdfBytes, filename);
            }

            // Mark bookmarks as exported (saved)
            if (side === 'left') {
                lastExportedLeftBookmarks.current = leftBookmarks.length;
                setLeftDirty(false);
            } else {
                lastExportedRightBookmarks.current = rightBookmarks.length;
                setRightDirty(false);
            }
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

            <main className="flex-1 flex overflow-hidden relative">
                {/* Drag Overlay - positioned relative to main content area */}
                {dragTarget !== 'none' && (
                    <div className="absolute inset-0 z-50 pointer-events-none flex">
                        {/* Left Overlay */}
                        <div
                            className={`flex-1 transition-all duration-200 border-4 border-dashed rounded-lg mx-4 mb-4 mt-8 flex items-center justify-center
                                ${dragTarget === 'left'
                                    ? 'border-blue-500 bg-blue-50/90'
                                    : 'border-transparent bg-transparent'
                                }`}
                        />

                        {/* Right Overlay */}
                        <div
                            className={`flex-1 transition-all duration-200 border-4 border-dashed rounded-lg mx-4 mb-4 mt-8 flex items-center justify-center
                                ${dragTarget === 'right'
                                    ? 'border-blue-500 bg-blue-50/90'
                                    : 'border-transparent bg-transparent'
                                }`}
                        />
                    </div>
                )}

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
                    hasBookmarks={leftBookmarks.length > 0}
                    onBookmarksChange={handleLeftBookmarksChange}
                    isDirty={leftDirty}
                    authorName={authorName}
                    setAuthorName={setAuthorName}
                    onClose={() => setLeftPDF(null)}
                    onLoadFromUrl={(url) => {
                        // Strip surrounding quotes only if both present (Windows 11 "Copy as path" adds them)
                        let cleanUrl = url.trim();
                        if (cleanUrl.startsWith('"') && cleanUrl.endsWith('"')) {
                            cleanUrl = cleanUrl.slice(1, -1);
                        }
                        const isRemote = cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://');
                        if (isTauri && !isRemote) {
                            loadPdfFromPath(cleanUrl, 'left');
                        } else {
                            loadPDFFromURL(cleanUrl, 'left');
                        }
                    }}
                    onFitToPage={() => handleFitToPageSync('left')}
                    isLoading={isUrlLoading.left}
                    exportSettings={exportSettings}
                    setExportSettings={setExportSettings}
                    isTauri={isTauri}
                    // Scale Settings
                    scaleMode={scaleMode}
                    setScaleMode={handleSetScaleMode}
                    defaultScaleLevel={defaultScaleLevel}
                    setDefaultScaleLevel={handleSetDefaultScaleLevel}
                    // Alt Text Settings
                    altTextSettings={altTextSettings}
                    setAltTextSettings={handleSetAltTextSettings}
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
                    hasBookmarks={rightBookmarks.length > 0}
                    onBookmarksChange={handleRightBookmarksChange}
                    isDirty={rightDirty}
                    authorName={authorName}
                    setAuthorName={setAuthorName}
                    onClose={() => setRightPDF(null)}
                    onLoadFromUrl={(url) => {
                        // Strip surrounding quotes only if both present (Windows 11 "Copy as path" adds them)
                        let cleanUrl = url.trim();
                        if (cleanUrl.startsWith('"') && cleanUrl.endsWith('"')) {
                            cleanUrl = cleanUrl.slice(1, -1);
                        }
                        const isRemote = cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://');
                        if (isTauri && !isRemote) {
                            loadPdfFromPath(cleanUrl, 'right');
                        } else {
                            loadPDFFromURL(cleanUrl, 'right');
                        }
                    }}
                    onFitToPage={() => handleFitToPageSync('right')}
                    isLoading={isUrlLoading.right}
                    // Scale Settings (passed but only Left side triggers settings menu changes usually, but good for consistency)
                    scaleMode={scaleMode}
                    setScaleMode={handleSetScaleMode}
                    defaultScaleLevel={defaultScaleLevel}
                    setDefaultScaleLevel={handleSetDefaultScaleLevel}
                    // Alt Text Settings
                    altTextSettings={altTextSettings}
                    setAltTextSettings={handleSetAltTextSettings}
                />
            </main>

            {toast.visible && (
                <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-right fade-in duration-300">
                    <div className="bg-blue-600 text-white px-4 py-3 rounded-none shadow-2xl flex items-center gap-3 min-w-[300px] border-l-4 border-blue-400">
                        <div className="bg-white/20 p-1 rounded-none">
                            <Check className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-medium leading-tight">{toast.message}</p>
                        </div>
                        <button
                            onClick={() => setToast(prev => ({ ...prev, visible: false }))}
                            className="text-white/70 hover:text-white transition-colors ml-2"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
