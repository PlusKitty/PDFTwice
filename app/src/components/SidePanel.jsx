import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

/**
 * SidePanel - Collapsible, resizable panel container for Bookmarks/Annotations
 * Light theme to match app design
 */
const SidePanel = ({ position = 'left', isOpen, onClose, title, children, width, onResize }) => {
    // const [width, setWidth] = useState(168); // LIFTED UP
    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef(null);
    const isLeft = position === 'left';

    // Handle resize
    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e) => {
            if (!panelRef.current) return;
            const panelRect = panelRef.current.getBoundingClientRect();
            let newWidth;
            if (isLeft) {
                newWidth = e.clientX - panelRect.left;
            } else {
                newWidth = panelRect.right - e.clientX;
            }
            // Clamp between 120px and 400px
            if (onResize) onResize(Math.max(120, Math.min(400, newWidth)));
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, isLeft, onResize]);

    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            className="side-panel"
            style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                [isLeft ? 'left' : 'right']: 0,
                width: `${width}px`,
                backgroundColor: '#f8f9fa',
                borderRight: isLeft ? '1px solid #e0e0e0' : 'none',
                borderLeft: isLeft ? 'none' : '1px solid #e0e0e0',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 50,
                boxShadow: isLeft
                    ? '2px 0 8px rgba(0,0,0,0.08)'
                    : '-2px 0 8px rgba(0,0,0,0.08)',
                userSelect: isResizing ? 'none' : 'auto',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: '1px solid #e0e0e0',
                    backgroundColor: '#fff',
                }}
            >
                <span style={{
                    fontWeight: 600,
                    fontSize: '12px',
                    color: '#333',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                }}>
                    {title}
                </span>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#666',
                        borderRadius: '4px',
                    }}
                    className="hover:bg-gray-200"
                    title="Close panel"
                >
                    {isLeft ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </button>
            </div>

            {/* Content */}
            <div
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    backgroundColor: '#f8f9fa',
                }}
            >
                {children}
            </div>

            {/* Resize Handle */}
            <div
                onMouseDown={() => setIsResizing(true)}
                style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    [isLeft ? 'right' : 'left']: -4,
                    width: 8,
                    cursor: 'col-resize',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <div
                    style={{
                        width: 4,
                        height: 32,
                        borderRadius: 2,
                        backgroundColor: isResizing ? '#4a9eff' : '#ccc',
                        opacity: isResizing ? 1 : 0,
                        transition: 'opacity 0.2s',
                    }}
                    className="group-hover:opacity-100"
                />
            </div>
        </div>
    );
};

export default SidePanel;
