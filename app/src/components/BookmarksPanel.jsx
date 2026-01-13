import React, { useState } from 'react';
import {
    Bookmark,
    FileText,
    ChevronRight,
    ChevronDown,
    Plus,
    Pencil,
    Trash2,
} from 'lucide-react';

/**
 * BookmarksPanel - Tree view merging PDF outline and user bookmarks
 * Light theme, consistent with app design
 */
const BookmarksPanel = ({
    outline = [],
    bookmarks = [],
    onNavigate,
    onAddBookmark,
    onRemoveBookmark,
    onRenameBookmark,
    currentPage = 1,
}) => {
    const [filter, setFilter] = useState('all');
    const [expandedItems, setExpandedItems] = useState(new Set());
    const [editingId, setEditingId] = useState(null);
    const [editText, setEditText] = useState('');

    const hasOutline = outline && outline.length > 0;
    const hasBookmarks = bookmarks && bookmarks.length > 0;

    const toggleExpanded = (id) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const startEditing = (bookmark) => {
        setEditingId(bookmark.id);
        setEditText(bookmark.label);
    };

    const commitEdit = () => {
        if (editingId && editText.trim()) {
            onRenameBookmark?.(editingId, editText.trim());
        }
        setEditingId(null);
        setEditText('');
    };

    const renderOutlineItem = (item, index, depth = 0) => {
        const id = `outline-${depth}-${index}`;
        const hasChildren = item.items && item.items.length > 0;
        const isExpanded = expandedItems.has(id);

        return (
            <div key={id}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 8px',
                        paddingLeft: `${8 + depth * 12}px`,
                        cursor: 'pointer',
                        color: '#555',
                        fontSize: '11px',
                        borderRadius: '3px',
                        margin: '1px 4px',
                        backgroundColor: '#fff',
                        border: '1px solid #e8e8e8',
                    }}
                    onClick={() => {
                        if (hasChildren) toggleExpanded(id);
                        if (item.dest) onNavigate?.(item.dest);
                    }}
                    className="hover:bg-gray-50"
                >
                    {hasChildren ? (
                        isExpanded ? <ChevronDown size={12} style={{ marginRight: 4 }} />
                            : <ChevronRight size={12} style={{ marginRight: 4 }} />
                    ) : (
                        <span style={{ width: 16 }} />
                    )}
                    <FileText size={12} style={{ marginRight: 6, opacity: 0.5 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title || 'Untitled'}
                    </span>
                </div>
                {hasChildren && isExpanded && (
                    <div>
                        {item.items.map((child, i) => renderOutlineItem(child, i, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    const renderBookmarkItem = (bookmark) => {
        const isEditing = editingId === bookmark.id;

        return (
            <div
                key={bookmark.id}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    color: '#4a9eff',
                    fontSize: '11px',
                    borderRadius: '3px',
                    margin: '1px 4px',
                    gap: '6px',
                    backgroundColor: '#fff',
                    border: '1px solid #e8e8e8',
                }}
                onClick={() => !isEditing && onNavigate?.(bookmark.page)}
                className="hover:bg-blue-50"
            >
                <Bookmark size={12} style={{ flexShrink: 0 }} />
                {isEditing ? (
                    <input
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            flex: 1,
                            background: '#f8f8f8',
                            border: '1px solid #ddd',
                            borderRadius: '3px',
                            padding: '2px 6px',
                            color: '#333',
                            fontSize: '11px',
                        }}
                    />
                ) : (
                    <>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {bookmark.label}
                        </span>
                        <span style={{
                            background: '#e8e8e8',
                            padding: '1px 5px',
                            borderRadius: '8px',
                            fontSize: '9px',
                            color: '#666',
                        }}>
                            p.{bookmark.page}
                        </span>
                        <button
                            onClick={(e) => { e.stopPropagation(); startEditing(bookmark); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#888' }}
                            className="hover:text-blue-600"
                            title="Rename"
                        >
                            <Pencil size={11} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onRemoveBookmark?.(bookmark.id); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#888' }}
                            className="hover:text-red-500"
                            title="Remove"
                        >
                            <Trash2 size={11} />
                        </button>
                    </>
                )}
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
                {['all', 'outline', 'bookmarks'].map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        style={{
                            flex: 1,
                            padding: '4px 6px',
                            fontSize: '10px',
                            border: '1px solid #ddd',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            backgroundColor: filter === f ? '#4a9eff' : '#fff',
                            color: filter === f ? '#fff' : '#666',
                            fontWeight: filter === f ? 600 : 400,
                        }}
                    >
                        {f === 'all' ? 'All' : f === 'outline' ? 'Outline' : 'Bookmarks'}
                    </button>
                ))}
            </div>

            {/* Add Bookmark Button */}
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', backgroundColor: '#fff' }}>
                <button
                    onClick={() => onAddBookmark?.(currentPage)}
                    style={{
                        width: '100%',
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        border: '1px dashed #ccc',
                        borderRadius: '4px',
                        backgroundColor: 'transparent',
                        color: '#666',
                        cursor: 'pointer',
                        fontSize: '10px',
                    }}
                    className="hover:border-blue-400 hover:text-blue-600"
                >
                    <Plus size={12} />
                    Bookmark Page {currentPage}
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {(filter === 'all' || filter === 'outline') && (
                    <>
                        {hasOutline ? (
                            outline.map((item, i) => renderOutlineItem(item, i))
                        ) : (
                            filter === 'outline' && (
                                <div style={{ padding: '16px 12px', textAlign: 'center', color: '#888', fontSize: '11px' }}>
                                    No table of contents
                                </div>
                            )
                        )}
                    </>
                )}

                {(filter === 'all' || filter === 'bookmarks') && (
                    <>
                        {hasBookmarks ? (
                            bookmarks.map(renderBookmarkItem)
                        ) : (
                            filter === 'bookmarks' && (
                                <div style={{ padding: '16px 12px', textAlign: 'center', color: '#888', fontSize: '11px' }}>
                                    No bookmarks yet
                                </div>
                            )
                        )}
                    </>
                )}

                {filter === 'all' && !hasOutline && !hasBookmarks && (
                    <div style={{ padding: '16px 12px', textAlign: 'center', color: '#888', fontSize: '11px' }}>
                        No outline or bookmarks
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookmarksPanel;
