/**
 * Utils - Utility modules for PDF viewer functionality
 * 
 * Re-exports all utilities for convenient importing:
 *   import { RenderingQueue, TextHighlighter } from './utils';
 */

// Core utilities
export { default as RenderingQueue, RenderingStates } from './RenderingQueue';
export { default as TextHighlighter, createTextHighlighter } from './TextHighlighter';
export { default as TextLayerSelectionManager } from './TextLayerSelectionManager';

// Search utilities
export {
    normalizeText,
    normalizeSimple,
    normalizedMatch,
    findMatches,
    getOriginalPosition,
    CHARACTERS_TO_NORMALIZE
} from './textNormalization';

// Scroll utilities
export {
    binarySearchFirstVisible,
    getVisibleElements,
    getGlobalScrollPosition,
    scrollToPagePosition,
    createScrollHandler
} from './scrollUtils';

// PDF export utilities
export {
    formatPDFDate,
    addBookmarksToDocument,
    addAnnotationToPage,
    exportPDFWithAnnotations,
    downloadPDF,
    generateExportFilename
} from './pdfExport';

// Version
export const UTILS_VERSION = '1.0.0';
