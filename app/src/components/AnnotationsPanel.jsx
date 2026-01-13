import React, { useState, useMemo } from 'react';
import {
    MessageSquare,
    Highlighter,
    StickyNote,
    Pencil,
    Trash2,
    ChevronDown,
    ChevronRight
} from 'lucide-react';

/**
 * AnnotationsPanel - List view of all annotations grouped by page
 * Light theme, consistent with BookmarksPanel
 */
const AnnotationsPanel = ({
    annotations = {},
    side,
    onNavigate,
    onDelete,
    onEdit,
}) => {
    const [filter, setFilter] = useState('all');
    const [collapsedPages, setCollapsedPages] = useState(new Set());

    // Filter annotations for this side and group by page
    const groupedAnnotations = useMemo(() => {
        const sideAnnotations = Object.values(annotations).filter(a => a.side === side);

        const filtered = sideAnnotations.filter(a => {
            if (filter === 'all') return true;
            if (filter === 'markup') {
                return a.highlightRects || a.highlightRect;
            }
            if (filter === 'notes') {
                return a.text && a.text.trim() && !a.highlightRects && !a.highlightRect;
            }
            return true;
        });

        const grouped = {};
        filtered.forEach(a => {
            const page = a.page || 1;
            if (!grouped[page]) grouped[page] = [];
            grouped[page].push(a);
        });

        return Object.keys(grouped)
            .map(Number)
            .sort((a, b) => a - b)
            .map(page => ({
                page,
                annotations: grouped[page].sort((a, b) =>
                    new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
                ),
            }));
    }, [annotations, side, filter]);

    const hasAnnotations = groupedAnnotations.length > 0;

    const togglePage = (page) => {
        setCollapsedPages(prev => {
            const next = new Set(prev);
            if (next.has(page)) next.delete(page);
            else next.add(page);
            return next;
        });
    };

    const getAnnotationType = (annotation) => {
        const hasHighlight = annotation.highlightRects || annotation.highlightRect;
        const hasText = annotation.text && annotation.text.trim();

        if (hasHighlight && hasText) {
            return { type: 'comment', icon: MessageSquare, color: '#4a9eff' };
        }
        if (hasHighlight) {
            return { type: 'highlight', icon: Highlighter, color: '#ffc107' };
        }
        if (hasText) {
            return { type: 'note', icon: StickyNote, color: '#ff9800' };
        }
        return { type: 'unknown', icon: Pencil, color: '#888' };
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 7) return `${diffDays}d`;
        return date.toLocaleDateString();
    };

    const renderAnnotation = (annotation) => {
        const { icon: Icon, color } = getAnnotationType(annotation);
        const preview = annotation.text
            ? annotation.text.substring(0, 50) + (annotation.text.length > 50 ? '...' : '')
            : annotation.selectedText
                ? `"${annotation.selectedText.substring(0, 35)}..."`
                : 'Highlight';

        return (
            <div
                key={annotation.id}
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    borderRadius: '4px',
                    margin: '2px 6px',
                    gap: '8px',
                    backgroundColor: '#fff',
                    border: '1px solid #e8e8e8',
                }}
                onClick={() => onNavigate?.(annotation.page, annotation.id)}
                className="hover:bg-gray-50"
            >
                <Icon size={14} style={{ color, flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        color: '#333',
                        marginBottom: 3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {preview}
                    </div>
                    <div style={{
                        color: '#888',
                        fontSize: '10px',
                        display: 'flex',
                        gap: '6px',
                    }}>
                        {annotation.author && <span>{annotation.author}</span>}
                        {annotation.timestamp && <span>{formatTime(annotation.timestamp)}</span>}
                    </div>
                </div>
                {/* Edit & Delete buttons */}
                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                    {annotation.text && onEdit && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onEdit?.(annotation.id); }}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '2px',
                                color: '#888',
                            }}
                            className="hover:text-blue-600"
                            title="Edit"
                        >
                            <Pencil size={12} />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete?.(annotation.id); }}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '2px',
                                color: '#888',
                            }}
                            className="hover:text-red-500"
                            title="Delete"
                        >
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Filter Bar */}
            <div style={{
                display: 'flex',
                gap: '3px',
                padding: '6px 8px',
                borderBottom: '1px solid #e0e0e0',
                backgroundColor: '#fff',
            }}>
                {[
                    { key: 'all', label: 'All' },
                    { key: 'markup', label: 'Markup' },
                    { key: 'notes', label: 'Notes' },
                ].map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setFilter(key)}
                        style={{
                            flex: 1,
                            padding: '4px 6px',
                            fontSize: '10px',
                            border: '1px solid #ddd',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            backgroundColor: filter === key ? '#4a9eff' : '#fff',
                            color: filter === key ? '#fff' : '#666',
                            fontWeight: filter === key ? 600 : 400,
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {hasAnnotations ? (
                    groupedAnnotations.map(({ page, annotations: pageAnnotations }) => {
                        const isCollapsed = collapsedPages.has(page);
                        return (
                            <div key={page}>
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '6px 10px',
                                        cursor: 'pointer',
                                        color: '#666',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        textTransform: 'uppercase',
                                    }}
                                    onClick={() => togglePage(page)}
                                >
                                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                    <span style={{ marginLeft: 4 }}>Page {page}</span>
                                    <span style={{
                                        marginLeft: 'auto',
                                        background: '#e8e8e8',
                                        padding: '1px 5px',
                                        borderRadius: '8px',
                                        fontSize: '9px',
                                        color: '#666',
                                    }}>
                                        {pageAnnotations.length}
                                    </span>
                                </div>
                                {!isCollapsed && pageAnnotations.map(renderAnnotation)}
                            </div>
                        );
                    })
                ) : (
                    <div style={{
                        padding: '24px 12px',
                        textAlign: 'center',
                        color: '#888',
                        fontSize: '11px',
                    }}>
                        No annotations yet
                    </div>
                )}
            </div>
        </div>
    );
};

export default AnnotationsPanel;
