import { useEffect } from 'react';

/**
 * useClickOutside - Detects clicks outside a referenced element
 * 
 * Used for comment input boxes to handle click-away behavior:
 * - If comment is empty, closes it
 * - If comment has text, blinks to indicate unsaved changes
 * 
 * @param {React.RefObject} ref - Reference to the element to monitor
 * @param {Object} activeComment - Currently active comment object
 * @param {string} commentText - Current comment text
 * @param {Function} setActiveComment - Setter to clear active comment
 * @param {Function} setIsBlinking - Setter to trigger blink animation
 * @param {string} side - 'left' | 'right' - which PDF viewer this belongs to
 */
function useClickOutside(ref, activeComment, commentText, setActiveComment, setIsBlinking, side) {
    useEffect(() => {
        if (!activeComment || activeComment.side !== side) return;

        const handleClickOutside = (event) => {
            // Clicked outside?
            if (ref.current && !ref.current.contains(event.target)) {
                // Ignore if clicking on the OTHER PDF viewer
                const otherViewer = event.target.closest('[data-pdf-viewer]');
                if (otherViewer && otherViewer.getAttribute('data-side') !== side) {
                    return;
                }

                if (!commentText || commentText.trim() === '') {
                    // Empty? Close it
                    setActiveComment(null);
                } else {
                    // Not empty? Blink it
                    setIsBlinking(true);
                    setTimeout(() => setIsBlinking(false), 600); // Match animation duration (0.2s * 3)
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [activeComment, commentText, ref, setActiveComment, setIsBlinking, side]);
}

export default useClickOutside;
