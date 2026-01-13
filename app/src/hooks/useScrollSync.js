import { useRef, useCallback, useEffect } from 'react';

/**
 * useScrollSync - Hook for synchronizing scroll between two viewers
 * 
 * Provides:
 * - RAF-throttled scroll synchronization
 * - Page-relative sync for continuous mode
 * - Percentage-based sync for single page mode
 * - Infinite loop prevention with sync locks
 * - Horizontal scroll synchronization
 * 
 * @param {Object} options
 * @param {boolean} options.enabled - Whether sync is enabled
 * @param {string} options.viewMode - 'single' | 'continuous'
 * @param {number} options.syncOffset - Page offset between viewers
 */
function useScrollSync(options = {}) {
    const {
        enabled = true,
        viewMode = 'single',
        syncOffset = 0,
    } = options;

    // Refs for preventing infinite sync loops
    const isSyncingLeftRef = useRef(false);
    const isSyncingRightRef = useRef(false);
    const leftSyncTimeoutRef = useRef(null);
    const rightSyncTimeoutRef = useRef(null);

    // RAF throttling
    const syncRAFRef = useRef(null);
    const pendingSyncRef = useRef(null);

    // Cleanup timeouts on unmount
    useEffect(() => {
        return () => {
            if (leftSyncTimeoutRef.current) clearTimeout(leftSyncTimeoutRef.current);
            if (rightSyncTimeoutRef.current) clearTimeout(rightSyncTimeoutRef.current);
            if (syncRAFRef.current) cancelAnimationFrame(syncRAFRef.current);
        };
    }, []);

    // Set sync lock to prevent infinite loop
    const setSyncLock = useCallback((side) => {
        if (side === 'left') {
            isSyncingLeftRef.current = true;
            if (leftSyncTimeoutRef.current) clearTimeout(leftSyncTimeoutRef.current);
            leftSyncTimeoutRef.current = setTimeout(() => {
                isSyncingLeftRef.current = false;
            }, 100);
        } else {
            isSyncingRightRef.current = true;
            if (rightSyncTimeoutRef.current) clearTimeout(rightSyncTimeoutRef.current);
            rightSyncTimeoutRef.current = setTimeout(() => {
                isSyncingRightRef.current = false;
            }, 100);
        }
    }, []);

    // Check if sync is currently locked for a side
    const isSyncLocked = useCallback((side) => {
        return side === 'left' ? isSyncingLeftRef.current : isSyncingRightRef.current;
    }, []);

    // Acknowledge sync receipt (clear lock)
    const acknowledgeSyncReceipt = useCallback((side) => {
        if (side === 'left') {
            isSyncingLeftRef.current = false;
        } else {
            isSyncingRightRef.current = false;
        }
    }, []);

    // Calculate sync data from scroll event
    const calculateScrollData = useCallback((event) => {
        const target = event.target;
        return {
            scrollTop: target.scrollTop,
            scrollHeight: target.scrollHeight,
            clientHeight: target.clientHeight,
            scrollLeft: target.scrollLeft,
            scrollWidth: target.scrollWidth,
            clientWidth: target.clientWidth,
        };
    }, []);

    // Create scroll handler for a viewer
    const createScrollHandler = useCallback((
        source, // 'left' | 'right'
        targetViewerRef,
        targetComponentRef,
        getScrollInfo, // Optional: function to get page-relative scroll info
        targetNumPages
    ) => {
        return (event) => {
            if (!enabled) return;

            const scrollData = calculateScrollData(event);
            const scrollInfo = getScrollInfo ? getScrollInfo() : null;

            // Store for RAF processing
            pendingSyncRef.current = {
                ...scrollData,
                source,
                scrollInfo,
                targetViewerRef,
                targetComponentRef,
                targetNumPages,
            };

            // Skip if RAF already scheduled
            if (syncRAFRef.current) return;

            syncRAFRef.current = requestAnimationFrame(() => {
                syncRAFRef.current = null;
                const data = pendingSyncRef.current;
                if (!data) return;

                const { source, scrollInfo, targetViewerRef, targetComponentRef, targetNumPages } = data;

                // Check sync lock
                if (isSyncLocked(source)) {
                    acknowledgeSyncReceipt(source);
                    return;
                }

                // Continuous mode: page-relative sync
                if (viewMode === 'continuous' && scrollInfo && targetComponentRef?.current) {
                    const sourceGSP = (scrollInfo.page - 1) + scrollInfo.percent;
                    let targetGSP = source === 'left'
                        ? sourceGSP + syncOffset
                        : sourceGSP - syncOffset;

                    // Clamp to valid range
                    if (targetNumPages) {
                        targetGSP = Math.max(0, Math.min(targetGSP, targetNumPages));
                    }

                    // Check if target is already close enough
                    const currentTargetGSP = targetComponentRef.current.getGlobalScrollPosition?.() ?? 0;
                    const verticalDiff = Math.abs(currentTargetGSP - targetGSP);

                    // Calculate horizontal sync
                    const hasHorizontalScroll = data.scrollWidth > data.clientWidth;
                    let horizontalPercent = 0;
                    if (hasHorizontalScroll) {
                        horizontalPercent = data.scrollLeft / (data.scrollWidth - data.clientWidth);
                    }

                    // Check horizontal sync status
                    let horizontalSynced = true;
                    if (targetViewerRef?.current) {
                        const tMax = targetViewerRef.current.scrollWidth - targetViewerRef.current.clientWidth;
                        if (tMax > 0) {
                            const tCurrent = targetViewerRef.current.scrollLeft;
                            const tExpected = tMax * horizontalPercent;
                            if (Math.abs(tCurrent - tExpected) > 5) horizontalSynced = false;
                        }
                    }

                    // Skip if already synced
                    if (verticalDiff < 0.005 && horizontalSynced) return;

                    // Lock target and apply sync
                    setSyncLock(source === 'left' ? 'right' : 'left');

                    const targetPage = Math.floor(targetGSP) + 1;
                    const targetPercent = targetGSP % 1;

                    targetComponentRef.current.scrollToPagePercent?.(targetPage, targetPercent, horizontalPercent);
                }
                // Single/fallback mode: percentage-based sync
                else if (targetViewerRef?.current) {
                    setSyncLock(source === 'left' ? 'right' : 'left');

                    const scrollPercentage = data.scrollTop / (data.scrollHeight - data.clientHeight || 1);
                    const targetMaxScroll = targetViewerRef.current.scrollHeight - targetViewerRef.current.clientHeight;
                    targetViewerRef.current.scrollTop = scrollPercentage * targetMaxScroll;

                    const scrollLeftPercentage = data.scrollLeft / (data.scrollWidth - data.clientWidth || 1);
                    const targetMaxScrollLeft = targetViewerRef.current.scrollWidth - targetViewerRef.current.clientWidth;
                    targetViewerRef.current.scrollLeft = scrollLeftPercentage * targetMaxScrollLeft;
                }
            });
        };
    }, [enabled, viewMode, syncOffset, calculateScrollData, isSyncLocked, acknowledgeSyncReceipt, setSyncLock]);

    // Calculate sync offset when enabling sync
    const calculateSyncOffset = useCallback((leftComponentRef, rightComponentRef) => {
        if (!leftComponentRef?.current || !rightComponentRef?.current) return 0;

        const leftGSP = leftComponentRef.current.getGlobalScrollPosition?.() ?? 0;
        const rightGSP = rightComponentRef.current.getGlobalScrollPosition?.() ?? 0;

        return rightGSP - leftGSP;
    }, []);

    return {
        // State refs (for external read access)
        isSyncingLeftRef,
        isSyncingRightRef,

        // Actions
        setSyncLock,
        isSyncLocked,
        acknowledgeSyncReceipt,
        calculateSyncOffset,

        // Handlers
        createScrollHandler,
        calculateScrollData,
    };
}

export default useScrollSync;
