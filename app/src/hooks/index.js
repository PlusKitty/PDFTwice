/**
 * Hooks - Custom React hooks for PDF viewer functionality
 * 
 * Re-exports all hooks for convenient importing:
 *   import { useZoom, useTextSelection } from './hooks';
 */

// Existing hooks
export { default as useBookmarks } from './useBookmarks';

// Extracted hooks
export { default as useClickOutside } from './useClickOutside';

// New hooks
export { default as useZoom } from './useZoom';
export { default as useTextSelection } from './useTextSelection';
export { default as useScrollSync } from './useScrollSync';
export { default as useAnnotations } from './useAnnotations';
