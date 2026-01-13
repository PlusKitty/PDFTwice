import React, { useRef, useEffect } from 'react';
import { Search, X, Loader2, ChevronUp, ChevronDown } from 'lucide-react';

/**
 * SearchPanel - Search UI for PDF text search
 * 
 * Features:
 * - Search input with live results count
 * - Loading indicator during search
 * - Scrollable results list with highlighted snippets
 * - Keyboard navigation (Enter, Shift+Enter, Escape)
 */
const SearchPanel = ({
    show,
    query,
    setQuery,
    results,
    currentIndex,
    isSearching,
    onSearch,
    onNavigate,
    onClose,
    onResultClick,
}) => {
    const inputRef = useRef(null);
    const resultRefs = useRef({});

    // Focus input when panel opens
    useEffect(() => {
        if (show && inputRef.current) {
            inputRef.current.focus();
        }
    }, [show]);

    // Scroll selected result into view
    useEffect(() => {
        if (currentIndex >= 0 && currentIndex < results.length) {
            const el = resultRefs.current[currentIndex];
            if (el) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [currentIndex, results.length]); // Only scroll explicitly on index change

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                onNavigate?.('prev');
            } else {
                onNavigate?.('next');
            }
        } else if (e.key === 'Escape') {
            onClose?.();
        }
    };

    const handleResultClick = (result, idx) => {
        onResultClick?.(result, idx);
    };

    if (!show) return null;

    return (
        <div className="bg-white border border-gray-300 px-2 py-1.5 relative z-search-panel">
            <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Find..."
                        value={query}
                        onChange={(e) => {
                            const newQuery = e.target.value;
                            setQuery(newQuery);
                            onSearch?.(newQuery, false);
                        }}
                        onKeyDown={handleKeyDown}
                        className="w-full text-xs border-0 rounded-none px-2 py-1 focus:outline-none pr-16 bg-white"
                    />
                    <div className="absolute right-2 top-1 flex items-center gap-1">
                        {isSearching ? (
                            <Loader2 className="w-3 h-3 animate-spin text-gray-600" />
                        ) : (
                            <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                                {results.length > 0
                                    ? `${currentIndex + 1} / ${results.length}`
                                    : (query && !isSearching ? 'No results' : '')}
                            </span>
                        )}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="h-[22px] w-[22px] flex items-center justify-center hover:bg-gray-200 rounded-none text-gray-400 hover:text-gray-600 transition-colors"
                    title="Close search"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {results.length > 0 && (
                <div
                    className="max-h-[200px] overflow-y-auto border border-gray-200 bg-white mt-1.5"
                    style={{ overflowAnchor: 'auto' }}
                >
                    {results.map((result, idx) => {
                        const isSelected = idx === currentIndex;

                        return (
                            <button
                                key={`${result.page}-${result.pos}`}
                                ref={el => resultRefs.current[idx] = el}
                                onClick={() => handleResultClick(result, idx)}
                                className={`w-full text-left px-2 py-1.5 border-b border-gray-100 flex justify-between items-start gap-2 transition-colors ${isSelected
                                    ? 'bg-blue-50 border-l-2 border-l-blue-500'
                                    : 'hover:bg-gray-50'
                                    }`}
                            >
                                <span className="text-[11px] leading-relaxed flex-1 text-gray-600">
                                    {result.snippet.substring(0, result.queryStart)}
                                    <b className="text-blue-700 bg-blue-100/50 px-0.5">
                                        {result.snippet.substring(result.queryStart, result.queryEnd)}
                                    </b>
                                    {result.snippet.substring(result.queryEnd)}
                                </span>
                                <span className="text-[10px] font-bold text-gray-400">
                                    {result.page}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SearchPanel;
