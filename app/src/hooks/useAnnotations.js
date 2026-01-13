import { useState, useCallback } from 'react';

/**
 * useAnnotations - Hook for managing PDF annotations (comments and highlights)
 * 
 * Provides CRUD operations for dual-viewer annotations with:
 * - Comments with text and positioning
 * - Highlights with rectangular regions
 * - Per-side active comment state
 * - Dirty tracking for unsaved changes
 * 
 * @param {Object} options
 * @param {string} options.authorName - Default author for new comments
 * @returns {Object} Annotation state and handlers
 */
const useAnnotations = ({ authorName = 'Author' } = {}) => {
    // Core annotations state
    const [comments, setComments] = useState({});

    // Per-side active comment state (when creating/editing)
    const [leftActiveComment, setLeftActiveComment] = useState(null);
    const [rightActiveComment, setRightActiveComment] = useState(null);
    const [leftCommentText, setLeftCommentText] = useState('');
    const [rightCommentText, setRightCommentText] = useState('');

    // Dirty flags for unsaved changes
    const [leftDirty, setLeftDirty] = useState(false);
    const [rightDirty, setRightDirty] = useState(false);

    /**
     * Add a new comment (starts editing mode)
     */
    const addComment = useCallback((side, x, y, highlightRects = null, selectedText = '', pageNum) => {
        const id = `${side}-${Date.now()}`;
        const newComment = {
            id,
            side,
            x,
            y,
            text: '',
            highlightRects,
            selectedText,
            page: pageNum
        };

        if (side === 'left') {
            setLeftActiveComment(newComment);
            setLeftCommentText('');
            setLeftDirty(true);
        } else {
            setRightActiveComment(newComment);
            setRightCommentText('');
            setRightDirty(true);
        }
    }, []);

    /**
     * Add a highlight without text (immediate save)
     */
    const addHighlight = useCallback((side, x, y, highlightRects, selectedText, pageNum) => {
        const id = `${side}-highlight-${Date.now()}`;
        setComments(prev => ({
            ...prev,
            [id]: {
                id,
                side,
                x,
                y,
                page: pageNum,
                text: '', // Empty text for pure highlight
                highlightRects,
                author: authorName,
                timestamp: new Date().toISOString()
            }
        }));
        if (side === 'left') setLeftDirty(true);
        else setRightDirty(true);
    }, [authorName]);

    /**
     * Save the active comment with text
     */
    const saveComment = useCallback((side, currentAuthorName) => {
        const active = side === 'left' ? leftActiveComment : rightActiveComment;
        const text = side === 'left' ? leftCommentText : rightCommentText;

        if (active && text.trim()) {
            setComments(prev => ({
                ...prev,
                [active.id]: {
                    ...active,
                    text: text,
                    author: currentAuthorName || authorName,
                    page: active.page,
                    timestamp: new Date().toISOString()
                }
            }));

            if (side === 'left') {
                setLeftActiveComment(null);
                setLeftCommentText('');
                setLeftDirty(true);
            } else {
                setRightActiveComment(null);
                setRightCommentText('');
                setRightDirty(true);
            }
        }
    }, [leftActiveComment, rightActiveComment, leftCommentText, rightCommentText, authorName]);

    /**
     * Delete a comment by ID
     */
    const deleteComment = useCallback((id) => {
        setComments(prev => {
            const comment = prev[id];
            if (comment) {
                if (comment.side === 'left') setLeftDirty(true);
                else setRightDirty(true);
            }
            const newComments = { ...prev };
            delete newComments[id];
            return newComments;
        });
    }, []);

    /**
     * Cancel active comment editing
     */
    const cancelComment = useCallback((side) => {
        if (side === 'left') {
            setLeftActiveComment(null);
            setLeftCommentText('');
        } else {
            setRightActiveComment(null);
            setRightCommentText('');
        }
    }, []);

    /**
     * Clear dirty flag for a side (after export)
     */
    const clearDirty = useCallback((side) => {
        if (side === 'left') setLeftDirty(false);
        else setRightDirty(false);
    }, []);

    /**
     * Get comments filtered by side
     */
    const getCommentsForSide = useCallback((side) => {
        return Object.values(comments).filter(c => c.side === side);
    }, [comments]);

    /**
     * Load comments (for restoration from backup)
     */
    const loadComments = useCallback((data) => {
        setComments(data || {});
    }, []);

    return {
        // State
        comments,
        setComments,
        leftActiveComment,
        rightActiveComment,
        leftCommentText,
        rightCommentText,
        leftDirty,
        rightDirty,

        // State setters
        setLeftActiveComment,
        setRightActiveComment,
        setLeftCommentText,
        setRightCommentText,
        setLeftDirty,
        setRightDirty,

        // Actions
        addComment,
        addHighlight,
        saveComment,
        deleteComment,
        cancelComment,
        clearDirty,
        getCommentsForSide,
        loadComments,
    };
};

export default useAnnotations;
