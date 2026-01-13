import * as pdfjsLib from 'pdfjs-dist';

// Helper: Matrix multiplication
function multiply(m1, m2) {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2
    ];
}

// Helper: Apply matrix to point
function applyTransform(p, m) {
    const [x, y] = p;
    const [a, b, c, d, e, f] = m;
    return [
        a * x + c * y + e,
        b * x + d * y + f
    ];
}

/**
 * Sort images by spatial reading order (Top-to-Bottom, Left-to-Right).
 * Uses row grouping based on vertical overlap to handle misaligned items.
 */
function sortImagesSpatially(images) {
    if (images.length === 0) return [];

    // 1. Initial Sort by Top Y (Descending - higher Y values first in PDF coords)
    const sorted = [...images].sort((a, b) => b.rect[3] - a.rect[3]);

    // 2. Group into rows based on vertical overlap
    const rows = [];
    let currentRow = [sorted[0]];
    let rowTop = sorted[0].rect[3];
    let rowBottom = sorted[0].rect[1];

    for (let i = 1; i < sorted.length; i++) {
        const img = sorted[i];
        const imgTop = img.rect[3];
        const imgBottom = img.rect[1];
        const imgHeight = imgTop - imgBottom;

        // Calculate overlap between current image and the row's bounding box
        const intersectionTop = Math.min(rowTop, imgTop);
        const intersectionBottom = Math.max(rowBottom, imgBottom);
        const intersectionHeight = Math.max(0, intersectionTop - intersectionBottom);

        // Significant Overlap Logic: > 50% of the shorter element
        const rowHeight = rowTop - rowBottom;
        const minHeight = Math.min(imgHeight, rowHeight);
        const isSignificantOverlap = intersectionHeight > (minHeight * 0.5);

        // Similar Height Logic: Prevent grouping vastly different height elements
        const maxHeight = Math.max(imgHeight, rowHeight);
        const isSimilarHeight = (minHeight > 0) && ((maxHeight / minHeight) < 2.0);

        if (isSignificantOverlap && isSimilarHeight) {
            currentRow.push(img);
            rowTop = Math.max(rowTop, imgTop);
            rowBottom = Math.min(rowBottom, imgBottom);
        } else {
            rows.push(currentRow);
            currentRow = [img];
            rowTop = imgTop;
            rowBottom = imgBottom;
        }
    }
    rows.push(currentRow);

    // 3. Sort each row Left-to-Right and flatten
    const result = [];
    rows.forEach(row => {
        row.sort((a, b) => a.rect[0] - b.rect[0]);
        result.push(...row);
    });

    return result;
}

/**
 * Extract image data (bounding box and alt text) from a PDF page.
 * Robust hybrid strategy:
 * 1. StructTree bbox (if available) - Most accurate
 * 2. MCID matching (if Marked Content available) - Direct link
 * 3. Fallback (Spatial or Draw Order) - Heuristic for untagged content
 * 
 * @param {PDFPage} page - The PDF.js page object
 * @param {object} options - Configuration options
 * @param {string} options.fallbackMode - 'spatial' (Top-to-Bottom, Left-to-Right) or 'draw' (content stream order)
 */

// Cache to avoid re-parsing pages (expensive getStructTree + getOperatorList calls)
// WeakMap keyed by page object allows garbage collection when page is released
const pageImageCache = new WeakMap();

export async function getPageImages(page, options = {}) {
    const { fallbackMode = 'spatial' } = options;

    // Check cache first (key includes fallbackMode since results differ)
    const cacheKey = `${fallbackMode}`;
    if (pageImageCache.has(page)) {
        const cached = pageImageCache.get(page);
        if (cached[cacheKey]) {
            return cached[cacheKey];
        }
    }

    const structTree = await page.getStructTree().catch(() => null);
    if (!structTree) {
        // Cache empty result to avoid re-checking
        pageImageCache.set(page, { ...pageImageCache.get(page), [cacheKey]: [] });
        return [];
    }

    const results = [];
    const altTextsInOrder = [];
    const mcidToAlt = new Map();

    // 1. Traverse Structure Tree
    // Collects:
    // - Specific nodes with bbox (Direct Result)
    // - MCID mappings (for MCID match)
    // - Ordered Alt Texts (for Fallback match)
    let hasStructTreeBBox = false;

    function traverse(node) {
        if (!node) return;

        if (node.role === 'Figure') {
            // A. Check for direct BBox (Best)
            let bbox = node.bbox;
            if (!bbox && node.children) {
                // Check children for bbox
                for (const child of node.children) {
                    if (child.bbox && Array.isArray(child.bbox) && child.bbox.length === 4) {
                        bbox = child.bbox;
                        break;
                    }
                }
            }

            if (bbox && Array.isArray(bbox) && bbox.length === 4 && node.alt) {
                hasStructTreeBBox = true;
                results.push({
                    id: `fig_bbox_${results.length}`,
                    rect: bbox,
                    alt: node.alt
                });
                return; // Done for this node
            }

            // B. Prepare for MCID/Fallback
            // Crucial: We add even if alt is missing (as null) to maintain the "sequence count"
            // This allows us to match [Img1, Img2] to [Alt1, null] correctly.
            altTextsInOrder.push(node.alt || null);

            // Extract MCIDs from this Figure node
            const stack = [node];
            while (stack.length > 0) {
                const curr = stack.pop();
                if (curr.children) {
                    for (const child of curr.children) {
                        let mcid = null;
                        if (typeof child === 'number') {
                            mcid = child;
                        } else if (typeof child === 'object') {
                            if (typeof child.id === 'number') {
                                mcid = child.id;
                            } else if (typeof child.id === 'string') {
                                const match = child.id.match(/mc(\d+)/);
                                if (match) {
                                    mcid = parseInt(match[1], 10);
                                }
                            }
                        }
                        if (mcid !== null) {
                            if (node.alt) {
                                mcidToAlt.set(mcid, node.alt);
                            }
                        } else if (typeof child === 'object') {
                            stack.push(child);
                        }
                    }
                }
            }
        }

        if (node.children) {
            for (const child of node.children) {
                if (typeof child === 'object') {
                    traverse(child);
                }
            }
        }
    }
    traverse(structTree);

    // If we found everything via BBox, return immediately
    if (hasStructTreeBBox && results.length > 0) {
        pageImageCache.set(page, { ...pageImageCache.get(page), [cacheKey]: results });
        return results;
    }
    if (altTextsInOrder.length === 0) {
        pageImageCache.set(page, { ...pageImageCache.get(page), [cacheKey]: [] });
        return [];
    }

    // 2. Scan Operator List (MCID & Image Collection)
    const opList = await page.getOperatorList();
    const { fnArray, argsArray } = opList;
    const OPS = pdfjsLib.OPS;

    const allImages = [];
    const ctmStack = [[1, 0, 0, 1, 0, 0]];
    let ctm = ctmStack[0];

    // Track marked content: { mcid: number|null, tag: string|null, isArtifact: boolean }
    const mcStack = [];

    const getCurrentMcid = () => {
        for (let j = mcStack.length - 1; j >= 0; j--) {
            if (mcStack[j].mcid !== null) return mcStack[j].mcid;
        }
        return null;
    };

    const isInsideArtifact = () => {
        return mcStack.some(mc => mc.isArtifact);
    };

    const isInsideAnyMarkedContent = () => {
        return mcStack.length > 0;
    };

    for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];

        if (fn === OPS.save) {
            ctmStack.push([...ctm]);
        } else if (fn === OPS.restore) {
            if (ctmStack.length > 1) ctmStack.pop();
            ctm = ctmStack[ctmStack.length - 1];
        } else if (fn === OPS.transform) {
            ctm = multiply(args, ctm);
        } else if (fn === OPS.beginMarkedContentProps) {
            const tag = args[0];
            const props = args[1];

            let mcid = null;
            if (typeof props === 'number') {
                mcid = props;
            } else if (props && typeof props.mcid === 'number') {
                mcid = props.mcid;
            }

            const isArtifact = (tag === 'Artifact') || (props && typeof props === 'object' && props.Type === 'Artifact');
            mcStack.push({ mcid, tag, isArtifact });
        } else if (fn === OPS.beginMarkedContent) {
            const tag = args[0];
            const isArtifact = (tag === 'Artifact');
            mcStack.push({ mcid: null, tag, isArtifact });
        } else if (fn === OPS.endMarkedContent) {
            mcStack.pop();
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
            // Calculate BBox
            const p1 = applyTransform([0, 0], ctm);
            const p2 = applyTransform([1, 0], ctm);
            const p3 = applyTransform([1, 1], ctm);
            const p4 = applyTransform([0, 1], ctm);
            const xs = [p1[0], p2[0], p3[0], p4[0]];
            const ys = [p1[1], p2[1], p3[1], p4[1]];
            const x = Math.min(...xs);
            const y = Math.min(...ys);
            const w = Math.max(...xs) - x;
            const h = Math.max(...ys) - y;
            const rect = [x, y, x + w, y + h];

            const activeMcid = getCurrentMcid();
            const inArtifact = isInsideArtifact();
            const inMarkedContent = isInsideAnyMarkedContent();

            // Skip images that are explicitly marked as Artifacts (decorative)
            if (inArtifact) {
                continue;
            }

            // MCID Match (Primary - Most Accurate)
            // If this image has an MCID that maps to an alt text, use it immediately
            if (activeMcid !== null && mcidToAlt.has(activeMcid)) {
                results.push({
                    id: `img_mcid_${activeMcid}_${i}`,
                    rect,
                    alt: mcidToAlt.get(activeMcid)
                });
                // Remove from mcidToAlt to avoid double-matching
                mcidToAlt.delete(activeMcid);
                continue; // Don't add to allImages for fallback
            }

            // Store for fallback (only non-artifact, non-MCID-matched images)
            allImages.push({
                id: `img_op_${i}`,
                rect,
                mcid: activeMcid,
                inMarkedContent,
                y: y + h
            });
        }
    }

    // If all images matched via MCID, we're done
    if (results.length > 0 && allImages.length === 0) {
        pageImageCache.set(page, { ...pageImageCache.get(page), [cacheKey]: results });
        return results;
    }

    // 3. Fallback: Match remaining images to remaining alt texts
    // Filter images: prefer those inside marked content (more likely to be Figures)
    const markedImages = allImages.filter(img => img.inMarkedContent);
    let imagesToMatch = markedImages.length > 0 ? markedImages : allImages;

    // Apply fallback ordering
    if (fallbackMode === 'spatial') {
        imagesToMatch = sortImagesSpatially(imagesToMatch);
    }
    // else 'draw' - keep in content stream order (already in allImages order)

    // Only match if count aligns (use altTextsInOrder which includes nulls for sequence alignment)
    if (imagesToMatch.length !== altTextsInOrder.length) {
        // Count mismatch - try single alt text to largest image as last resort
        const validAlts = altTextsInOrder.filter(a => a !== null);
        if (validAlts.length === 1 && imagesToMatch.length >= 1) {
            const largest = imagesToMatch.reduce((max, img) => {
                const area = (img.rect[2] - img.rect[0]) * (img.rect[3] - img.rect[1]);
                const maxArea = (max.rect[2] - max.rect[0]) * (max.rect[3] - max.rect[1]);
                return area > maxArea ? img : max;
            });
            results.push({
                id: largest.id,
                rect: largest.rect,
                alt: validAlts[0]
            });
        }
        pageImageCache.set(page, { ...pageImageCache.get(page), [cacheKey]: results });
        return results;
    }

    // Match by fallback order (counts are equal)
    // Skip null placeholders when assigning
    for (let i = 0; i < imagesToMatch.length; i++) {
        if (altTextsInOrder[i] !== null) {
            results.push({
                id: imagesToMatch[i].id,
                rect: imagesToMatch[i].rect,
                alt: altTextsInOrder[i]
            });
        }
    }

    pageImageCache.set(page, { ...pageImageCache.get(page), [cacheKey]: results });
    return results;
}
