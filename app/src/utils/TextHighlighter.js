/**
 * TextHighlighter - Search result highlighting utility
 * 
 * Inspired by PDF.js text_highlighter.js
 * Provides methods for highlighting search results in the text layer.
 */

/**
 * TextHighlighter class for managing search highlights on a page
 */
export class TextHighlighter {
    constructor(options = {}) {
        this._container = options.container || null;
        this._highlightClass = options.highlightClass || 'search-highlight';
        this._currentClass = options.currentClass || 'search-highlight-current';
        this._textDivs = [];
        this._textContent = '';
        this._textPositions = []; // Map text positions to divs
        this._highlightElements = [];
    }

    /**
     * Set the text layer container
     */
    setContainer(container) {
        this._container = container;
        this._updateTextMapping();
    }

    /**
     * Build mapping between text content and DOM elements
     * Called after text layer is rendered
     */
    _updateTextMapping() {
        if (!this._container) return;

        this._textDivs = Array.from(this._container.querySelectorAll('span'));
        this._textContent = '';
        this._textPositions = [];

        let position = 0;
        for (const div of this._textDivs) {
            const text = div.textContent || '';
            this._textPositions.push({
                start: position,
                end: position + text.length,
                div
            });
            this._textContent += text;
            position += text.length;
        }
    }

    /**
     * Clear all highlights
     */
    clearHighlights() {
        for (const el of this._highlightElements) {
            el.remove();
        }
        this._highlightElements = [];
    }

    /**
     * Highlight search results
     * 
     * @param {Array<{start: number, end: number}>} matches - Match positions in text
     * @param {number} currentIndex - Index of current match to highlight differently
     */
    highlight(matches, currentIndex = -1) {
        this.clearHighlights();

        if (!this._container || !matches || matches.length === 0) return;

        // Refresh text mapping if needed
        if (this._textDivs.length === 0) {
            this._updateTextMapping();
        }

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const isCurrent = i === currentIndex;
            this._highlightMatch(match.start, match.end, isCurrent);
        }
    }

    /**
     * Highlight a single match
     */
    _highlightMatch(start, end, isCurrent = false) {
        // Find which divs contain this match
        const affectedDivs = this._textPositions.filter(
            pos => pos.start < end && pos.end > start
        );

        for (const divInfo of affectedDivs) {
            const { div, start: divStart, end: divEnd } = divInfo;

            // Calculate the portion of this div that should be highlighted
            const highlightStart = Math.max(0, start - divStart);
            const highlightEnd = Math.min(divEnd - divStart, end - divStart);

            if (highlightStart >= highlightEnd) continue;

            // Create highlight element using Range API or absolute positioning
            try {
                const highlight = this._createHighlightElement(div, highlightStart, highlightEnd, isCurrent);
                if (highlight) {
                    this._highlightElements.push(highlight);
                }
            } catch (error) {
                console.warn('Failed to create highlight:', error);
            }
        }
    }

    /**
     * Create a highlight element for a portion of text
     */
    _createHighlightElement(div, startOffset, endOffset, isCurrent) {
        const text = div.textContent || '';
        if (startOffset >= text.length) return null;

        // Method 1: Use Range API to get precise positioning
        const range = document.createRange();
        const textNode = div.firstChild;

        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
            // Fallback: create overlay based on div position
            return this._createOverlayHighlight(div, startOffset, endOffset, isCurrent);
        }

        try {
            range.setStart(textNode, startOffset);
            range.setEnd(textNode, Math.min(endOffset, text.length));

            const rects = range.getClientRects();
            if (rects.length === 0) return null;

            // Get container position for relative positioning
            const containerRect = this._container.getBoundingClientRect();

            // Create highlight for each rect (handles line wrapping)
            const fragment = document.createDocumentFragment();
            for (const rect of rects) {
                const highlight = document.createElement('div');
                highlight.className = `${this._highlightClass}${isCurrent ? ` ${this._currentClass}` : ''}`;
                highlight.style.cssText = `
                    position: absolute;
                    left: ${rect.left - containerRect.left}px;
                    top: ${rect.top - containerRect.top}px;
                    width: ${rect.width}px;
                    height: ${rect.height}px;
                    pointer-events: none;
                    z-index: 1;
                `;
                fragment.appendChild(highlight);
                this._highlightElements.push(highlight);
            }

            this._container.appendChild(fragment);
            return fragment;
        } catch {
            // Fallback on Range API failure
            return this._createOverlayHighlight(div, startOffset, endOffset, isCurrent);
        }
    }

    /**
     * Fallback: Create highlight overlay based on character estimation
     */
    _createOverlayHighlight(div, startOffset, endOffset, isCurrent) {
        const divRect = div.getBoundingClientRect();
        const containerRect = this._container.getBoundingClientRect();
        const text = div.textContent || '';

        // Estimate character width
        const charWidth = divRect.width / (text.length || 1);

        const highlight = document.createElement('div');
        highlight.className = `${this._highlightClass}${isCurrent ? ` ${this._currentClass}` : ''}`;
        highlight.style.cssText = `
            position: absolute;
            left: ${divRect.left - containerRect.left + startOffset * charWidth}px;
            top: ${divRect.top - containerRect.top}px;
            width: ${(endOffset - startOffset) * charWidth}px;
            height: ${divRect.height}px;
            pointer-events: none;
            z-index: 1;
        `;

        this._container.appendChild(highlight);
        return highlight;
    }

    /**
     * Scroll the current match into view
     */
    scrollToCurrentMatch(matchIndex) {
        if (matchIndex < 0) return;

        const currentHighlights = this._highlightElements.filter(
            el => el.classList && el.classList.contains(this._currentClass)
        );

        if (currentHighlights.length > 0) {
            currentHighlights[0].scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }

    /**
     * Get text content of the page
     */
    getTextContent() {
        return this._textContent;
    }

    /**
     * Cleanup
     */
    dispose() {
        this.clearHighlights();
        this._container = null;
        this._textDivs = [];
        this._textContent = '';
        this._textPositions = [];
    }
}

/**
 * Factory function to create a highlighter for a page
 */
export function createTextHighlighter(container, options = {}) {
    const highlighter = new TextHighlighter({
        container,
        ...options
    });
    return highlighter;
}

export default TextHighlighter;
