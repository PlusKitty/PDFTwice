/**
 * textNormalization - Unicode normalization for search
 * 
 * Ported from PDF.js pdf_find_controller.js
 * Handles diacritics, ligatures, and special characters for accurate search matching.
 */

/**
 * Characters to normalize for search matching
 * Maps special Unicode characters to their ASCII equivalents
 */
const CHARACTERS_TO_NORMALIZE = {
    // Hyphens and dashes
    '\u2010': '-', // Hyphen
    '\u2011': '-', // Non-breaking hyphen
    '\u2012': '-', // Figure dash
    '\u2013': '-', // En dash
    '\u2014': '-', // Em dash
    '\u2015': '-', // Horizontal bar

    // Quotes
    '\u2018': "'", // Left single quote
    '\u2019': "'", // Right single quote
    '\u201A': "'", // Single low quote
    '\u201B': "'", // Single high-reversed quote
    '\u201C': '"', // Left double quote
    '\u201D': '"', // Right double quote
    '\u201E': '"', // Double low quote
    '\u201F': '"', // Double high-reversed quote

    // Spaces
    '\u00A0': ' ', // Non-breaking space
    '\u2000': ' ', // En quad
    '\u2001': ' ', // Em quad
    '\u2002': ' ', // En space
    '\u2003': ' ', // Em space
    '\u2004': ' ', // Three-per-em space
    '\u2005': ' ', // Four-per-em space
    '\u2006': ' ', // Six-per-em space
    '\u2007': ' ', // Figure space
    '\u2008': ' ', // Punctuation space
    '\u2009': ' ', // Thin space
    '\u200A': ' ', // Hair space
    '\u202F': ' ', // Narrow no-break space
    '\u205F': ' ', // Medium mathematical space
    '\u3000': ' ', // Ideographic space

    // Ligatures (common)
    '\uFB00': 'ff', // ff ligature
    '\uFB01': 'fi', // fi ligature
    '\uFB02': 'fl', // fl ligature
    '\uFB03': 'ffi', // ffi ligature
    '\uFB04': 'ffl', // ffl ligature
    '\uFB05': 'st', // ſt ligature (long s + t)
    '\uFB06': 'st', // st ligature

    // Other common replacements
    '\u00B7': '.', // Middle dot
    '\u2022': '*', // Bullet
    '\u2026': '...', // Ellipsis
    '\u2212': '-', // Minus sign
    '\u00D7': 'x', // Multiplication sign
    '\u00F7': '/', // Division sign
};

/**
 * Build regex for character normalization
 */
const NORMALIZE_REGEX = new RegExp(
    '[' + Object.keys(CHARACTERS_TO_NORMALIZE).join('') + ']',
    'g'
);

/**
 * Normalize text for search matching
 * Converts special characters to ASCII equivalents and optionally removes diacritics
 * 
 * @param {string} text - Input text to normalize
 * @param {Object} options - Normalization options
 * @param {boolean} options.caseSensitive - If false, converts to lowercase
 * @param {boolean} options.removeDiacritics - If true, removes accent marks
 * @returns {Object} { normalized: string, diffs: Array } - diffs track position changes
 */
export function normalizeText(text, options = {}) {
    const { caseSensitive = false, removeDiacritics = true } = options;

    if (!text) return { normalized: '', diffs: [] };

    const diffs = []; // Track position differences for highlight mapping
    let result = text;
    let offset = 0;

    // Replace special characters
    result = result.replace(NORMALIZE_REGEX, (match, index) => {
        const replacement = CHARACTERS_TO_NORMALIZE[match];
        const diff = replacement.length - match.length;
        if (diff !== 0) {
            diffs.push({ index: index + offset, diff });
            offset += diff;
        }
        return replacement;
    });

    // Remove diacritics (accents) using Unicode normalization
    if (removeDiacritics) {
        // NFD decomposes characters, then we remove combining diacritical marks
        const beforeLength = result.length;
        result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Track overall length change (simplified - doesn't track per-character)
        if (result.length !== beforeLength) {
            // For simplicity, we note that diacritics were removed
            // Full implementation would track each removal position
        }
    }

    // Case normalization
    if (!caseSensitive) {
        result = result.toLowerCase();
    }

    return { normalized: result, diffs };
}

/**
 * Map a position in normalized text back to original text position
 * 
 * @param {Array} diffs - Diff array from normalizeText
 * @param {number} normalizedPos - Position in normalized text
 * @returns {number} Position in original text
 */
export function getOriginalPosition(diffs, normalizedPos) {
    let originalPos = normalizedPos;

    for (const { index, diff } of diffs) {
        if (index < normalizedPos) {
            originalPos -= diff;
        }
    }

    return originalPos;
}

/**
 * Simple text normalization (just lowercase and basic whitespace)
 * Use this for quick comparisons where full normalization isn't needed
 * 
 * @param {string} text - Input text
 * @returns {string} Normalized text
 */
export function normalizeSimple(text) {
    if (!text) return '';
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Check if two strings match after normalization
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @param {Object} options - Normalization options
 * @returns {boolean} True if strings match after normalization
 */
export function normalizedMatch(a, b, options = {}) {
    const normA = normalizeText(a, options).normalized;
    const normB = normalizeText(b, options).normalized;
    return normA === normB;
}

/**
 * Find all occurrences of a query in text (with normalization)
 * 
 * @param {string} text - Text to search in
 * @param {string} query - Query to find
 * @param {Object} options - Search options
 * @param {boolean} options.caseSensitive - Case-sensitive search
 * @param {boolean} options.wholeWord - Match whole words only
 * @returns {Array<{start: number, end: number}>} Array of match positions in original text
 */
export function findMatches(text, query, options = {}) {
    const { caseSensitive = false, wholeWord = false } = options;

    if (!text || !query) return [];

    const { normalized: normText, diffs: textDiffs } = normalizeText(text, { caseSensitive });
    const { normalized: normQuery } = normalizeText(query, { caseSensitive });

    if (!normQuery) return [];

    const matches = [];
    let searchPos = 0;

    while (searchPos < normText.length) {
        const foundPos = normText.indexOf(normQuery, searchPos);
        if (foundPos === -1) break;

        const endPos = foundPos + normQuery.length;

        // Whole word check
        if (wholeWord) {
            const charBefore = foundPos > 0 ? normText[foundPos - 1] : ' ';
            const charAfter = endPos < normText.length ? normText[endPos] : ' ';
            const isWordBoundaryBefore = /\s|[^\w]/.test(charBefore);
            const isWordBoundaryAfter = /\s|[^\w]/.test(charAfter);

            if (!isWordBoundaryBefore || !isWordBoundaryAfter) {
                searchPos = foundPos + 1;
                continue;
            }
        }

        // Map back to original positions
        const originalStart = getOriginalPosition(textDiffs, foundPos);
        const originalEnd = getOriginalPosition(textDiffs, endPos);

        matches.push({ start: originalStart, end: originalEnd });
        searchPos = foundPos + 1; // Allow overlapping matches
    }

    return matches;
}

export default {
    normalizeText,
    getOriginalPosition,
    normalizeSimple,
    normalizedMatch,
    findMatches,
    CHARACTERS_TO_NORMALIZE
};
