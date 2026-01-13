import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

/**
 * useBookmarks - Custom hook for managing user bookmarks
 * 
 * Bookmarks are stored in localStorage keyed by a hash of the PDF name/data.
 * Each bookmark has: id, page, label, created timestamp
 * 
 * @param {string} pdfId - Unique identifier for the PDF (typically filename or hash)
 * @param {function} onBookmarksChange - Optional callback when bookmarks change (for export tracking)
 * @returns {Object} Bookmark state and operations
 */
function useBookmarks(pdfId, onBookmarksChange = null) {
    const storageKey = useMemo(() => pdfId ? `pdf_bookmarks_${pdfId}` : null, [pdfId]);
    const prevStorageKeyRef = useRef(storageKey);

    // Helper to load bookmarks from storage
    const loadBookmarks = useCallback((key) => {
        if (!key) return [];
        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed = JSON.parse(stored);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch {
            // Ignore errors during loading
        }
        return [];
    }, []);

    // Initialize bookmarks from localStorage
    const [bookmarks, setBookmarks] = useState(() => loadBookmarks(storageKey));

    // Reload bookmarks when pdfId changes (but not on initial mount)
    useEffect(() => {
        // Skip initial mount - already handled by useState initializer
        if (prevStorageKeyRef.current === storageKey) return;
        prevStorageKeyRef.current = storageKey;

        // Load new bookmarks for the new storageKey
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Syncing with localStorage external system
        setBookmarks(loadBookmarks(storageKey));
    }, [storageKey, loadBookmarks]);

    // Save bookmarks to localStorage whenever they change
    useEffect(() => {
        if (!storageKey) return;

        try {
            if (bookmarks.length > 0) {
                localStorage.setItem(storageKey, JSON.stringify(bookmarks));
            } else {
                localStorage.removeItem(storageKey);
            }
        } catch {
            // Ignore localStorage errors
        }

        // Notify parent of bookmark changes (for isDirty tracking)
        if (onBookmarksChange) {
            onBookmarksChange(bookmarks);
        }
    }, [bookmarks, storageKey, onBookmarksChange]);

    // Add a new bookmark for the given page
    const addBookmark = useCallback((page, label = null) => {
        const newBookmark = {
            id: `bm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            page,
            label: label || `Page ${page}`,
            created: new Date().toISOString(),
        };
        setBookmarks(prev => {
            // Check if page is already bookmarked
            const existing = prev.find(b => b.page === page);
            if (existing) return prev;
            return [...prev, newBookmark].sort((a, b) => a.page - b.page);
        });
        return newBookmark.id;
    }, []);

    // Remove a bookmark by ID
    const removeBookmark = useCallback((bookmarkId) => {
        setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
    }, []);

    // Rename a bookmark
    const renameBookmark = useCallback((bookmarkId, newLabel) => {
        setBookmarks(prev => prev.map(b =>
            b.id === bookmarkId ? { ...b, label: newLabel } : b
        ));
    }, []);

    // Check if a page is bookmarked
    const isPageBookmarked = useCallback((page) => {
        return bookmarks.some(b => b.page === page);
    }, [bookmarks]);

    // Toggle bookmark for a page
    const toggleBookmark = useCallback((page) => {
        const existing = bookmarks.find(b => b.page === page);
        if (existing) {
            removeBookmark(existing.id);
            return null;
        } else {
            return addBookmark(page);
        }
    }, [bookmarks, addBookmark, removeBookmark]);

    return {
        bookmarks,
        addBookmark,
        removeBookmark,
        renameBookmark,
        isPageBookmarked,
        toggleBookmark,
    };
}

export default useBookmarks;
