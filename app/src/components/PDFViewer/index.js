/**
 * PDFViewer Components
 * 
 * Modular components extracted from the main PDFViewer.jsx
 * These can be composed together or used individually.
 */

// Main viewer - re-export for backward compatibility
export { default } from '../PDFViewer.jsx';

// Overlay components
export { default as SelectionPopover } from './SelectionPopover';
export { default as AnnotationOverlay } from './AnnotationOverlay';
export { default as SearchPanel } from './SearchPanel';
export { default as UploadZone } from './UploadZone';

// Toolbar sub-components
export * from './Toolbar';

