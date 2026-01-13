/**
 * RenderingQueue - Priority-based page rendering management
 * 
 * Inspired by PDF.js pdf_rendering_queue.js
 * Manages render state, priority ordering, and cancellation for efficient PDF rendering.
 */

/**
 * Rendering states for pages
 */
export const RenderingStates = {
    INITIAL: 0,
    RUNNING: 1,
    PAUSED: 2,
    FINISHED: 3,
    ERROR: 4
};

/**
 * RenderingQueue class for managing page render priority
 */
export class RenderingQueue {
    constructor(options = {}) {
        this._pageStates = new Map(); // Map<pageNum, RenderingState>
        this._pendingRenders = new Set(); // Pages waiting to render
        this._activeRenders = new Map(); // Map<pageNum, { task, controller }>
        this._visiblePages = new Set();
        this._scrollDirection = 1; // 1 = down, -1 = up

        // Options
        this._maxConcurrent = options.maxConcurrent || 2;
        this._preRenderAhead = options.preRenderAhead || 3;
        this._preRenderBehind = options.preRenderBehind || 2;
        this._cleanupTimeout = options.cleanupTimeout || 30000; // 30 seconds

        this._cleanupTimers = new Map(); // Timers for off-screen cleanup
        this._renderCallback = options.onRender || null;
        this._cleanupCallback = options.onCleanup || null;
    }

    /**
     * Set the total number of pages
     */
    setNumPages(numPages) {
        this._numPages = numPages;
        // Initialize all pages as INITIAL
        for (let i = 1; i <= numPages; i++) {
            if (!this._pageStates.has(i)) {
                this._pageStates.set(i, RenderingStates.INITIAL);
            }
        }
    }

    /**
     * Update visible pages (called on scroll)
     */
    setVisiblePages(visibleSet, scrollDirection = 1) {
        const prevVisible = this._visiblePages;
        this._visiblePages = new Set(visibleSet);
        this._scrollDirection = scrollDirection;

        // Cancel cleanup timers for newly visible pages
        for (const pageNum of visibleSet) {
            const timer = this._cleanupTimers.get(pageNum);
            if (timer) {
                clearTimeout(timer);
                this._cleanupTimers.delete(pageNum);
            }
        }

        // Schedule cleanup for pages that are no longer visible
        for (const pageNum of prevVisible) {
            if (!this._visiblePages.has(pageNum)) {
                this._scheduleCleanup(pageNum);
            }
        }

        // Trigger rendering of visible pages
        this._processQueue();
    }

    /**
     * Get the state of a page
     */
    getState(pageNum) {
        return this._pageStates.get(pageNum) || RenderingStates.INITIAL;
    }

    /**
     * Mark a page as needing render (e.g., after zoom)
     */
    invalidate(pageNum) {
        if (this._pageStates.get(pageNum) === RenderingStates.FINISHED) {
            this._pageStates.set(pageNum, RenderingStates.INITIAL);
            this._pendingRenders.add(pageNum);
        }
    }

    /**
     * Invalidate all pages (e.g., after scale change)
     */
    invalidateAll() {
        for (let i = 1; i <= this._numPages; i++) {
            this.invalidate(i);
        }
    }

    /**
     * Mark a page render as started
     */
    markRunning(pageNum, task = null, controller = null) {
        this._pageStates.set(pageNum, RenderingStates.RUNNING);
        this._pendingRenders.delete(pageNum);
        if (task || controller) {
            this._activeRenders.set(pageNum, { task, controller });
        }
    }

    /**
     * Mark a page render as complete
     */
    markFinished(pageNum) {
        this._pageStates.set(pageNum, RenderingStates.FINISHED);
        this._activeRenders.delete(pageNum);
        this._processQueue(); // Render next
    }

    /**
     * Mark a page render as failed
     */
    markError(pageNum) {
        this._pageStates.set(pageNum, RenderingStates.ERROR);
        this._activeRenders.delete(pageNum);
    }

    /**
     * Cancel a specific page render
     */
    cancel(pageNum) {
        const active = this._activeRenders.get(pageNum);
        if (active) {
            try {
                if (active.controller) {
                    active.controller.abort();
                }
                if (active.task && active.task.cancel) {
                    active.task.cancel();
                }
            } catch {
                // Ignore cancellation errors
            }
            this._activeRenders.delete(pageNum);
        }
        this._pageStates.set(pageNum, RenderingStates.INITIAL);
    }

    /**
     * Cancel all pending and running renders
     */
    cancelAll() {
        for (const [pageNum] of this._activeRenders) {
            this.cancel(pageNum);
        }
        this._pendingRenders.clear();
    }

    /**
     * Get highest priority page to render next
     */
    getHighestPriority() {
        // 1. Visible pages first
        for (const pageNum of this._visiblePages) {
            if (this.getState(pageNum) === RenderingStates.INITIAL) {
                return pageNum;
            }
        }

        // 2. Pre-render pages based on scroll direction
        const visibleArray = Array.from(this._visiblePages).sort((a, b) => a - b);
        const centerPage = visibleArray.length > 0
            ? visibleArray[Math.floor(visibleArray.length / 2)]
            : 1;

        // Build priority list: ahead pages first (in scroll direction)
        const priorityList = [];
        for (let offset = 1; offset <= this._preRenderAhead; offset++) {
            const ahead = this._scrollDirection > 0
                ? centerPage + offset
                : centerPage - offset;
            if (ahead >= 1 && ahead <= this._numPages) {
                priorityList.push(ahead);
            }
        }
        for (let offset = 1; offset <= this._preRenderBehind; offset++) {
            const behind = this._scrollDirection > 0
                ? centerPage - offset
                : centerPage + offset;
            if (behind >= 1 && behind <= this._numPages) {
                priorityList.push(behind);
            }
        }

        for (const pageNum of priorityList) {
            if (this.getState(pageNum) === RenderingStates.INITIAL) {
                return pageNum;
            }
        }

        return null;
    }

    /**
     * Process the render queue
     */
    _processQueue() {
        // Check if we can start more renders
        while (this._activeRenders.size < this._maxConcurrent) {
            const nextPage = this.getHighestPriority();
            if (nextPage === null) break;

            if (this._renderCallback) {
                this._renderCallback(nextPage);
            } else {
                // No callback, just mark as pending
                this._pendingRenders.add(nextPage);
                break; // Prevent infinite loop
            }
        }
    }

    /**
     * Schedule cleanup of an off-screen page
     */
    _scheduleCleanup(pageNum) {
        if (this._cleanupTimers.has(pageNum)) return;

        const timer = setTimeout(() => {
            this._cleanupTimers.delete(pageNum);

            // Only cleanup if still not visible
            if (!this._visiblePages.has(pageNum)) {
                this._pageStates.set(pageNum, RenderingStates.INITIAL);

                if (this._cleanupCallback) {
                    this._cleanupCallback(pageNum);
                }
            }
        }, this._cleanupTimeout);

        this._cleanupTimers.set(pageNum, timer);
    }

    /**
     * Clear all cleanup timers
     */
    clearCleanupTimers() {
        for (const timer of this._cleanupTimers.values()) {
            clearTimeout(timer);
        }
        this._cleanupTimers.clear();
    }

    /**
     * Reset the queue (e.g., when loading a new document)
     */
    reset() {
        this.cancelAll();
        this.clearCleanupTimers();
        this._pageStates.clear();
        this._visiblePages.clear();
    }

    /**
     * Get statistics about current queue state
     */
    getStats() {
        let initial = 0, running = 0, finished = 0, error = 0;

        for (const state of this._pageStates.values()) {
            switch (state) {
                case RenderingStates.INITIAL: initial++; break;
                case RenderingStates.RUNNING: running++; break;
                case RenderingStates.FINISHED: finished++; break;
                case RenderingStates.ERROR: error++; break;
            }
        }

        return {
            total: this._numPages,
            initial,
            running,
            finished,
            error,
            visible: this._visiblePages.size,
            activeRenders: this._activeRenders.size
        };
    }
}

export default RenderingQueue;
