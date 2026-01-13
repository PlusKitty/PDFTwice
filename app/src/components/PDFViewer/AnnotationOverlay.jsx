import React from 'react';
import { MessageSquare } from 'lucide-react';

/**
 * AnnotationOverlay - Renders comment and highlight overlays on a PDF page
 * 
 * Features:
 * - Yellow highlight rectangles (multi-rect support)
 * - Comment icons for point annotations
 * - Hover tooltips showing comment preview
 * - Click handling to open full comment editor
 */

/**
 * HighlightRects - Renders multiple highlight rectangles for a comment
 */
const HighlightRects = ({
    comment,
    onHover,
    onLeave,
    onClick
}) => (
    <div
        className="absolute inset-0 pointer-events-none z-annotation-base opacity-40 hover:opacity-60 transition-opacity"
        style={{ width: '100%', height: '100%' }}
    >
        {comment.highlightRects.map((rect, idx) => (
            <div
                key={`${comment.id}-${idx}`}
                className="absolute bg-yellow-400 cursor-pointer pointer-events-auto"
                style={{
                    left: `${rect.left}%`,
                    top: `${rect.top}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                }}
                onMouseEnter={() => onHover?.(comment.id)}
                onMouseLeave={() => onLeave?.()}
                onClick={(e) => {
                    e.stopPropagation();
                    onClick?.(comment);
                }}
            />
        ))}
    </div>
);

/**
 * SingleHighlight - Renders a single highlight rectangle (legacy format)
 */
const SingleHighlight = ({
    comment,
    onHover,
    onLeave,
    onClick
}) => (
    <div
        className="absolute bg-yellow-400 opacity-40 hover:opacity-60 transition-opacity cursor-pointer z-annotation-base"
        style={{
            left: `${comment.highlightRect.left}%`,
            top: `${comment.highlightRect.top}%`,
            width: `${comment.highlightRect.width}%`,
            height: `${comment.highlightRect.height}%`,
        }}
        onMouseEnter={() => onHover?.(comment.id)}
        onMouseLeave={() => onLeave?.()}
        onClick={(e) => {
            e.stopPropagation();
            onClick?.(comment);
        }}
    />
);

/**
 * PointAnnotation - Renders a comment icon for point annotations (no highlight)
 */
const PointAnnotation = ({
    comment,
    onHover,
    onLeave,
    onClick
}) => (
    <div
        className="absolute text-yellow-600 opacity-70 hover:opacity-100 transition-opacity cursor-pointer z-annotation-point"
        style={{
            left: `${comment.x}%`,
            top: `${comment.y}%`,
            transform: 'translate(-50%, -50%)'
        }}
        onMouseEnter={() => onHover?.(comment.id)}
        onMouseLeave={() => onLeave?.()}
        onClick={(e) => {
            e.stopPropagation();
            onClick?.(comment);
        }}
    >
        <MessageSquare className="w-5 h-5 fill-current" />
    </div>
);

/**
 * CommentTooltip - Hover preview for a comment
 */
const CommentTooltip = ({ comment }) => (
    <div
        className="absolute bg-white border border-gray-300 rounded-none shadow-xl p-2 text-xs max-w-[200px] z-annotation-tooltip pointer-events-none"
        style={{
            left: `${comment.x}%`,
            top: `${comment.y}%`,
            transform: 'translate(-50%, calc(-100% - 10px))'
        }}
    >
        <div className="flex justify-between items-center mb-1 border-b border-gray-100 pb-1">
            <span className="font-bold text-gray-500">{comment.author || 'User'}</span>
        </div>
        <p className="line-clamp-4 text-gray-800 leading-relaxed">
            {comment.text}
        </p>
    </div>
);

/**
 * AnnotationOverlay - Main component for rendering all annotations on a page
 */
const AnnotationOverlay = ({
    pageNum,
    comments,
    side,
    hoveredCommentId,
    activeComment,
    onHoverComment,
    onLeaveComment,
    onClickComment,
}) => {
    // Filter comments for this page and side
    const pageComments = Object.values(comments || {})
        .filter(c => c.side === side && c.page === pageNum);

    if (pageComments.length === 0) return null;

    return (
        <>
            {pageComments.map(comment => (
                <React.Fragment key={comment.id}>
                    {/* Render appropriate highlight type */}
                    {(comment.highlightRects && comment.highlightRects.length > 0) ? (
                        <HighlightRects
                            comment={comment}
                            onHover={onHoverComment}
                            onLeave={onLeaveComment}
                            onClick={onClickComment}
                        />
                    ) : comment.highlightRect ? (
                        <SingleHighlight
                            comment={comment}
                            onHover={onHoverComment}
                            onLeave={onLeaveComment}
                            onClick={onClickComment}
                        />
                    ) : (
                        <PointAnnotation
                            comment={comment}
                            onHover={onHoverComment}
                            onLeave={onLeaveComment}
                            onClick={onClickComment}
                        />
                    )}

                    {/* Hover tooltip */}
                    {hoveredCommentId === comment.id &&
                        (!activeComment || activeComment.id !== comment.id) && (
                            <CommentTooltip comment={comment} />
                        )}
                </React.Fragment>
            ))}
        </>
    );
};

export default AnnotationOverlay;
