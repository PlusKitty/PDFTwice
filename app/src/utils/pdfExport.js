/**
 * PDF Export Utilities
 * 
 * Functions for exporting PDFs with annotations (comments, highlights, bookmarks)
 * using pdf-lib library.
 */

import { PDFDocument, PDFName, PDFArray, PDFString } from 'pdf-lib';

/**
 * Format a JavaScript Date to PDF date string format
 * @param {Date} date 
 * @returns {string} PDF date string (D:YYYYMMDDHHmmSS+ZZ'ZZ')
 */
export const formatPDFDate = (date) => {
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

/**
 * Add bookmarks (outline) to a PDF document
 * @param {PDFDocument} pdfDoc - The pdf-lib document
 * @param {Array} bookmarks - Array of bookmark objects { page, label }
 */
export const addBookmarksToDocument = (pdfDoc, bookmarks) => {
    if (!bookmarks || bookmarks.length === 0) return;

    const catalog = pdfDoc.catalog;
    const context = pdfDoc.context;

    const outlineItems = [];
    for (const bookmark of bookmarks) {
        const pageIndex = bookmark.page - 1;
        if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

        const pageRef = pdfDoc.getPages()[pageIndex].ref;
        const dest = context.obj([pageRef, PDFName.of('Fit')]);

        const outlineItem = context.obj({
            Title: PDFString.of(bookmark.label || `Page ${bookmark.page}`),
            Dest: dest,
        });

        outlineItems.push({ ref: context.register(outlineItem), obj: outlineItem, bookmark });
    }

    if (outlineItems.length === 0) return;

    // Link items together (Prev/Next)
    for (let i = 0; i < outlineItems.length; i++) {
        const item = outlineItems[i];
        if (i > 0) {
            item.obj.set(PDFName.of('Prev'), outlineItems[i - 1].ref);
        }
        if (i < outlineItems.length - 1) {
            item.obj.set(PDFName.of('Next'), outlineItems[i + 1].ref);
        }
    }

    // Create Outlines dictionary
    const outlines = context.obj({
        Type: PDFName.of('Outlines'),
        First: outlineItems[0].ref,
        Last: outlineItems[outlineItems.length - 1].ref,
        Count: outlineItems.length,
    });
    const outlinesRef = context.register(outlines);

    // Set Parent on each item
    for (const item of outlineItems) {
        item.obj.set(PDFName.of('Parent'), outlinesRef);
    }

    // Add Outlines to catalog
    catalog.set(PDFName.of('Outlines'), outlinesRef);
};

/**
 * Add a single annotation (comment or highlight) to a PDF page
 * @param {PDFDocument} pdfDoc - The pdf-lib document
 * @param {Object} comment - Comment object with properties
 * @param {Object} page - The PDF page object
 * @param {number} pageWidth - Page width
 * @param {number} pageHeight - Page height
 */
export const addAnnotationToPage = (pdfDoc, comment, page, pageWidth, pageHeight) => {
    const x = (comment.x / 100) * pageWidth;
    const y = pageHeight - ((comment.y / 100) * pageHeight);

    const commentDate = comment.timestamp ? new Date(comment.timestamp) : new Date();
    const highlightColor = [1, 1, 0]; // Yellow
    const annotId = `annot-${comment.id}-${Date.now()}`;

    let annot;
    let annotRect;

    if (comment.highlightRects || comment.highlightRect) {
        // Highlight annotation
        const rects = comment.highlightRects || [comment.highlightRect];
        const quadPoints = [];
        let minL = Infinity, minB = Infinity, maxR = -Infinity, maxT = -Infinity;

        for (const hr of rects) {
            const left = (hr.left / 100) * pageWidth;
            const right = (hr.right / 100) * pageWidth;
            const top = pageHeight - ((hr.top / 100) * pageHeight);
            const bottom = pageHeight - ((hr.bottom / 100) * pageHeight);

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
        // Text (sticky note) annotation
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

    // Add popup if there is text content
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
        // Just add the annotation without popup
        const existingAnnots = page.node.lookup(PDFName.of('Annots'));
        if (existingAnnots instanceof PDFArray) {
            existingAnnots.push(annotRef);
        } else {
            const newAnnots = pdfDoc.context.obj([annotRef]);
            page.node.set(PDFName.of('Annots'), newAnnots);
        }
    }
};

/**
 * Export a PDF with annotations and bookmarks
 * @param {ArrayBuffer} pdfData - Original PDF data
 * @param {Array} comments - Array of comment objects for this PDF
 * @param {Array} bookmarks - Array of bookmark objects for this PDF
 * @returns {Promise<Uint8Array>} Exported PDF bytes
 */
export const exportPDFWithAnnotations = async (pdfData, comments = [], bookmarks = []) => {
    const pdfDoc = await PDFDocument.load(pdfData);

    // Add bookmarks as PDF Outline
    addBookmarksToDocument(pdfDoc, bookmarks);

    // Add comments/highlights
    for (const comment of comments) {
        const pageIndex = comment.page - 1;
        if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

        const page = pdfDoc.getPage(pageIndex);
        const { width, height } = page.getSize();

        addAnnotationToPage(pdfDoc, comment, page, width, height);
    }

    return await pdfDoc.save();
};

/**
 * Download PDF bytes as a file
 * @param {Uint8Array} pdfBytes - PDF data
 * @param {string} filename - Filename for download
 */
export const downloadPDF = (pdfBytes, filename) => {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

/**
 * Generate export filename from original name
 * @param {string} originalName - Original PDF filename
 * @param {string} prefix - Prefix to add (default: '')
 * @param {string} suffix - Suffix to add (default: '_commented')
 * @returns {string} New filename
 */
export const generateExportFilename = (originalName, prefix = '', suffix = '_commented') => {
    const nameParts = originalName.split('.');
    const baseName = nameParts.length > 1 ? nameParts.slice(0, -1).join('.') : nameParts[0];
    return `${prefix}${baseName}${suffix}.pdf`;
};

/**
 * Save PDF bytes to a specific path (Tauri only)
 * This function only works when running inside the Tauri desktop app.
 * @param {Uint8Array} pdfBytes - PDF data
 * @param {string} outputPath - Full path to write to
 */
export const savePDFToPath = async (pdfBytes, outputPath) => {
    // Use global Tauri object (set by withGlobalTauri: true in tauri.conf.json)
    const tauri = window.__TAURI__;
    if (!tauri?.core?.invoke) {
        throw new Error('savePDFToPath is only available in Tauri desktop mode');
    }

    try {
        await tauri.core.invoke('write_pdf_file', {
            path: outputPath,
            data: Array.from(pdfBytes)
        });
    } catch (err) {
        console.error('Failed to save PDF via Tauri:', err);
        throw new Error('Failed to save PDF to path: ' + err.message);
    }
};
