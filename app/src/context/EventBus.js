/**
 * EventBus - Pub/Sub pattern for decoupled component communication
 * 
 * Inspired by PDF.js event_utils.js
 * 
 * Events:
 * - pagechange: { page, source }
 * - scalechange: { scale, source }
 * - searchupdate: { query, results, currentIndex }
 * - annotationchange: { type, annotation, source }
 * - renderstart: { pageNum }
 * - rendercomplete: { pageNum }
 * - scrollsync: { position, source }
 */

class EventBus {
    constructor() {
        this._listeners = new Map();
        this._sequenceId = 0;
    }

    /**
     * Subscribe to an event
     * @param {string} eventName - Name of the event
     * @param {Function} listener - Callback function
     * @param {Object} options - Optional { signal: AbortSignal, once: boolean }
     * @returns {Function} Unsubscribe function
     */
    on(eventName, listener, options = {}) {
        if (!this._listeners.has(eventName)) {
            this._listeners.set(eventName, new Set());
        }

        const wrappedListener = options.once
            ? (...args) => {
                this.off(eventName, wrappedListener);
                listener(...args);
            }
            : listener;

        this._listeners.get(eventName).add(wrappedListener);

        // Support AbortController for cleanup
        if (options.signal) {
            options.signal.addEventListener('abort', () => {
                this.off(eventName, wrappedListener);
            }, { once: true });
        }

        // Return unsubscribe function
        return () => this.off(eventName, wrappedListener);
    }

    /**
     * Subscribe to an event (fires only once)
     */
    once(eventName, listener, options = {}) {
        return this.on(eventName, listener, { ...options, once: true });
    }

    /**
     * Unsubscribe from an event
     */
    off(eventName, listener) {
        const listeners = this._listeners.get(eventName);
        if (listeners) {
            listeners.delete(listener);
        }
    }

    /**
     * Dispatch an event to all listeners
     * @param {string} eventName - Name of the event
     * @param {Object} data - Event payload
     * @returns {number} Sequence ID for this dispatch
     */
    dispatch(eventName, data = {}) {
        const sequenceId = ++this._sequenceId;
        const listeners = this._listeners.get(eventName);

        if (listeners && listeners.size > 0) {
            const eventData = {
                ...data,
                type: eventName,
                sequenceId,
                timestamp: Date.now()
            };

            // Call listeners synchronously (like PDF.js)
            for (const listener of listeners) {
                try {
                    listener(eventData);
                } catch (error) {
                    console.error(`EventBus: Error in listener for "${eventName}":`, error);
                }
            }
        }

        return sequenceId;
    }

    /**
     * Remove all listeners for an event (or all events)
     */
    clear(eventName = null) {
        if (eventName) {
            this._listeners.delete(eventName);
        } else {
            this._listeners.clear();
        }
    }

    /**
     * Get current sequence ID (useful for sync race condition prevention)
     */
    getSequenceId() {
        return this._sequenceId;
    }
}

// Singleton instance for global use
const globalEventBus = new EventBus();

export { EventBus, globalEventBus };
export default EventBus;
