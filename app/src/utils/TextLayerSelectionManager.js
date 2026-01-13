/**
 * TextLayerSelectionManager - Ported from PDF.js text_layer_builder.js
 * 
 * Handles Chrome-compatible text selection by dynamically moving endOfContent element
 * to prevent selection "jumping" when cursor moves into empty space.
 * Firefox handles selection natively, so we skip the Chrome-specific manipulation.
 * 
 * Usage:
 *   TextLayerSelectionManager.register(textLayerDiv, endOfContentDiv);
 *   TextLayerSelectionManager.unregister(textLayerDiv);
 */

const TextLayerSelectionManager = (() => {
    const textLayers = new Map(); // Map<textLayerDiv, endOfContentDiv>
    let selectionChangeAbortController = null;
    let prevRange = null;
    let isFirefox = null; // Lazily detected

    const reset = (endDiv, textLayerDiv) => {
        textLayerDiv.append(endDiv);
        endDiv.style.width = "";
        endDiv.style.height = "";
        textLayerDiv.classList.remove("selecting");
    };

    const enableGlobalListener = () => {
        if (selectionChangeAbortController) return; // Already enabled

        selectionChangeAbortController = new AbortController();
        const { signal } = selectionChangeAbortController;

        let isPointerDown = false;

        document.addEventListener("pointerdown", () => { isPointerDown = true; }, { signal });
        document.addEventListener("pointerup", () => {
            isPointerDown = false;
            textLayers.forEach(reset);
        }, { signal });
        window.addEventListener("blur", () => {
            isPointerDown = false;
            textLayers.forEach(reset);
        }, { signal });
        document.addEventListener("keyup", () => {
            if (!isPointerDown) textLayers.forEach(reset);
        }, { signal });

        document.addEventListener("selectionchange", () => {
            const selection = document.getSelection();
            if (selection.rangeCount === 0) {
                textLayers.forEach(reset);
                return;
            }

            // Find active text layers
            const activeTextLayers = new Set();
            for (let i = 0; i < selection.rangeCount; i++) {
                const range = selection.getRangeAt(i);
                for (const textLayerDiv of textLayers.keys()) {
                    if (!activeTextLayers.has(textLayerDiv) && range.intersectsNode(textLayerDiv)) {
                        activeTextLayers.add(textLayerDiv);
                    }
                }
            }

            for (const [textLayerDiv, endDiv] of textLayers) {
                if (activeTextLayers.has(textLayerDiv)) {
                    textLayerDiv.classList.add("selecting");
                } else {
                    reset(endDiv, textLayerDiv);
                }
            }

            // Firefox handles selection natively - skip Chrome-specific manipulation
            if (isFirefox === null) {
                // Detect Firefox using -moz-user-select CSS property (same as PDF.js)
                const firstTextLayer = textLayers.keys().next().value;
                if (firstTextLayer) {
                    isFirefox = getComputedStyle(firstTextLayer).getPropertyValue("-moz-user-select") !== "";
                }
            }
            if (isFirefox) return;

            // Chrome-specific: Move endOfContent to follow selection anchor
            // This prevents selection from jumping to cover all text
            const range = selection.getRangeAt(0);
            const modifyStart = prevRange && (
                range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
                range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0
            );

            let anchor = modifyStart ? range.startContainer : range.endContainer;
            if (anchor.nodeType === Node.TEXT_NODE) {
                anchor = anchor.parentNode;
            }

            if (!modifyStart && range.endOffset === 0) {
                try {
                    while (!anchor.previousSibling) {
                        anchor = anchor.parentNode;
                    }
                    anchor = anchor.previousSibling;
                    while (anchor.childNodes && anchor.childNodes.length) {
                        anchor = anchor.lastChild;
                    }
                } catch { /* ignore navigation errors */ }
            }

            const parentTextLayer = anchor?.parentElement?.closest(".textLayer");
            const endDiv = textLayers.get(parentTextLayer);
            if (endDiv && parentTextLayer) {
                endDiv.style.width = parentTextLayer.style.width;
                endDiv.style.height = parentTextLayer.style.height;
                endDiv.style.userSelect = "text";
                try {
                    anchor.parentElement?.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling);
                } catch { /* ignore DOM errors */ }
            }

            prevRange = range.cloneRange();
        }, { signal });
    };

    return {
        /**
         * Register a text layer for selection management
         * @param {HTMLElement} textLayerDiv - The .textLayer container
         * @param {HTMLElement} endOfContentDiv - The endOfContent element (div or br)
         */
        register(textLayerDiv, endOfContentDiv) {
            textLayers.set(textLayerDiv, endOfContentDiv);

            textLayerDiv.addEventListener("mousedown", () => {
                textLayerDiv.classList.add("selecting");
            });

            enableGlobalListener();
        },

        /**
         * Unregister a text layer (cleanup on unmount)
         * @param {HTMLElement} textLayerDiv - The .textLayer container to unregister
         */
        unregister(textLayerDiv) {
            textLayers.delete(textLayerDiv);
            if (textLayers.size === 0 && selectionChangeAbortController) {
                selectionChangeAbortController.abort();
                selectionChangeAbortController = null;
                prevRange = null;
                isFirefox = null; // Reset for next registration cycle
            }
        }
    };
})();

export default TextLayerSelectionManager;
