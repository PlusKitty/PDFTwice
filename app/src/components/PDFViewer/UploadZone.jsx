import React from 'react';
import { Upload, Loader2 } from 'lucide-react';

/**
 * UploadZone - PDF upload area with drag-drop and URL loading
 * 
 * Features:
 * - File upload via click or drag-drop
 * - URL loading (remote or local bridge)
 * - Loading state indicator
 * - Respects environment flags for remote/local options
 */
const UploadZone = ({
    onUpload,
    onLoadFromUrl,
    isLoading = false,
    isDragging = false,
    onDragOver,
    onDragLeave,
    onDrop,
}) => {
    // Check environment flags
    const allowRemote = import.meta.env.VITE_ENABLE_REMOTE_PDFS !== 'false';
    const allowLocal = import.meta.env.VITE_ENABLE_LOCAL_BRIDGE !== 'false';

    let placeholder = "";
    if (allowRemote && allowLocal) placeholder = "https://... or folder/file.pdf";
    else if (allowRemote) placeholder = "https://...";
    else if (allowLocal) placeholder = "folder/file.pdf";

    return (
        <div
            className={`flex-1 flex flex-col items-center justify-center transition-all ${isDragging ? 'bg-blue-50 border-4 border-dashed border-blue-400 rounded-lg m-4' : ''
                }`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {/* File upload */}
            <label
                className={`cursor-pointer flex flex-col items-center gap-3 p-8 border-2 border-dashed rounded-none transition-colors ${isLoading
                    ? 'border-gray-200 bg-gray-50 cursor-wait'
                    : 'border-gray-400 hover:border-blue-500 hover:bg-blue-50'
                    }`}
            >
                <Upload className={`w-12 h-12 ${isLoading ? 'text-gray-300' : 'text-gray-400'}`} />
                <span className={`font-medium ${isLoading ? 'text-gray-400' : 'text-gray-600'}`}>
                    {isLoading ? 'Uploading PDF...' : 'Upload PDF'}
                </span>
                <input
                    type="file"
                    accept="application/pdf"
                    onChange={onUpload}
                    className="hidden"
                    disabled={isLoading}
                />
            </label>

            {/* URL loading section */}
            {(allowRemote || allowLocal) && (
                <>
                    <div className="flex items-center w-full max-w-xs gap-3 my-4">
                        <div className="h-px bg-gray-300 flex-1"></div>
                        <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                            Or load from URL
                        </span>
                        <div className="h-px bg-gray-300 flex-1"></div>
                    </div>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            const url = e.target.elements.url.value.trim();
                            if (url) onLoadFromUrl?.(url);
                        }}
                        className="flex w-full max-w-xs gap-2"
                    >
                        <input
                            name="url"
                            type="text"
                            placeholder={placeholder}
                            disabled={isLoading}
                            className="flex-1 text-xs border border-gray-300 rounded-none px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-none hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                            {isLoading ? 'Loading...' : 'Load'}
                        </button>
                    </form>
                </>
            )}
        </div>
    );
};

export default UploadZone;
