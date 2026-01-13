/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useReducer, useMemo } from 'react';
import { EventBus } from './EventBus';
import { ActionTypes } from './ActionTypes';

/**
 * PDFViewerContext - Shared state for PDF viewer components
 * 
 * Provides:
 * - PDF document state (doc, numPages, outline)
 * - Navigation state (page, scale, viewMode)
 * - Search state (query, results, currentIndex)
 * - EventBus instance for decoupled communication
 */

// Initial state
const initialState = {
    // Document
    pdf: null,
    numPages: 0,
    outline: [],

    // Navigation
    page: 1,
    scale: 1.0,
    viewMode: 'single', // 'single' | 'continuous'

    // Search
    searchQuery: '',
    searchResults: [],
    currentResultIndex: -1,
    isSearching: false,

    // UI
    showSearch: false,
    isLoading: false,
};

// Reducer
function viewerReducer(state, action) {
    switch (action.type) {
        case ActionTypes.SET_PDF:
            return {
                ...state,
                pdf: action.payload.pdf,
                numPages: action.payload.pdf?.numPages || 0,
                outline: action.payload.pdf?.outline || [],
                page: 1,
                // Reset search when PDF changes
                searchQuery: '',
                searchResults: [],
                currentResultIndex: -1,
            };

        case ActionTypes.SET_PAGE:
            return {
                ...state,
                page: Math.max(1, Math.min(action.payload, state.numPages || 1)),
            };

        case ActionTypes.SET_SCALE:
            return {
                ...state,
                scale: Math.max(0.1, Math.min(5.0, action.payload)),
            };

        case ActionTypes.SET_VIEW_MODE:
            return {
                ...state,
                viewMode: action.payload,
            };

        case ActionTypes.SET_SEARCH_QUERY:
            return {
                ...state,
                searchQuery: action.payload,
            };

        case ActionTypes.SET_SEARCH_RESULTS:
            return {
                ...state,
                searchResults: action.payload,
                currentResultIndex: action.payload.length > 0 ? 0 : -1,
            };

        case ActionTypes.SET_CURRENT_RESULT:
            return {
                ...state,
                currentResultIndex: action.payload,
            };

        case ActionTypes.SET_SEARCHING:
            return {
                ...state,
                isSearching: action.payload,
            };

        case ActionTypes.TOGGLE_SEARCH:
            return {
                ...state,
                showSearch: action.payload !== undefined ? action.payload : !state.showSearch,
            };

        case ActionTypes.SET_LOADING:
            return {
                ...state,
                isLoading: action.payload,
            };

        case ActionTypes.RESET:
            return initialState;

        default:
            return state;
    }
}

// Context
const PDFViewerContext = createContext(null);
const PDFViewerDispatchContext = createContext(null);
const EventBusContext = createContext(null);

/**
 * PDFViewerProvider - Wrap components that need access to viewer state
 */
export function PDFViewerProvider({ children, initialPdf = null }) {
    const [state, dispatch] = useReducer(viewerReducer, {
        ...initialState,
        pdf: initialPdf,
        numPages: initialPdf?.numPages || 0,
    });

    // Create a stable EventBus instance
    const eventBus = useMemo(() => new EventBus(), []);

    // Action creators
    const actions = useMemo(() => ({
        setPdf: (pdf) => {
            dispatch({ type: ActionTypes.SET_PDF, payload: { pdf } });
            eventBus.dispatch('pdfchange', { pdf });
        },
        setPage: (page) => {
            dispatch({ type: ActionTypes.SET_PAGE, payload: page });
            eventBus.dispatch('pagechange', { page });
        },
        setScale: (scale) => {
            dispatch({ type: ActionTypes.SET_SCALE, payload: scale });
            eventBus.dispatch('scalechange', { scale });
        },
        setViewMode: (mode) => {
            dispatch({ type: ActionTypes.SET_VIEW_MODE, payload: mode });
            eventBus.dispatch('viewmodechange', { mode });
        },
        setSearchQuery: (query) => {
            dispatch({ type: ActionTypes.SET_SEARCH_QUERY, payload: query });
        },
        setSearchResults: (results) => {
            dispatch({ type: ActionTypes.SET_SEARCH_RESULTS, payload: results });
            eventBus.dispatch('searchupdate', { results });
        },
        setCurrentResult: (index) => {
            dispatch({ type: ActionTypes.SET_CURRENT_RESULT, payload: index });
        },
        setSearching: (isSearching) => {
            dispatch({ type: ActionTypes.SET_SEARCHING, payload: isSearching });
        },
        toggleSearch: (show) => {
            dispatch({ type: ActionTypes.TOGGLE_SEARCH, payload: show });
        },
        setLoading: (isLoading) => {
            dispatch({ type: ActionTypes.SET_LOADING, payload: isLoading });
        },
        reset: () => {
            dispatch({ type: ActionTypes.RESET });
        },
    }), [eventBus]);

    return (
        <EventBusContext.Provider value={eventBus}>
            <PDFViewerContext.Provider value={state}>
                <PDFViewerDispatchContext.Provider value={actions}>
                    {children}
                </PDFViewerDispatchContext.Provider>
            </PDFViewerContext.Provider>
        </EventBusContext.Provider>
    );
}

/**
 * Hook to access viewer state
 */
export function usePDFViewerState() {
    const context = useContext(PDFViewerContext);
    if (context === null) {
        throw new Error('usePDFViewerState must be used within a PDFViewerProvider');
    }
    return context;
}

/**
 * Hook to access viewer actions
 */
export function usePDFViewerActions() {
    const context = useContext(PDFViewerDispatchContext);
    if (context === null) {
        throw new Error('usePDFViewerActions must be used within a PDFViewerProvider');
    }
    return context;
}

/**
 * Hook to access EventBus
 */
export function useEventBus() {
    const context = useContext(EventBusContext);
    if (context === null) {
        throw new Error('useEventBus must be used within a PDFViewerProvider');
    }
    return context;
}

/**
 * Combined hook for convenience
 */
export function usePDFViewer() {
    return {
        state: usePDFViewerState(),
        actions: usePDFViewerActions(),
        eventBus: useEventBus(),
    };
}

export { ActionTypes };
export default PDFViewerContext;
