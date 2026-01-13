import React from 'react';
import { ExternalLink } from 'lucide-react';

/**
 * FileInfo - Displays PDF filename with optional link
 * 
 * Features:
 * - Clickable filename (opens source URL or copies local path)
 * - Copy feedback animation
 * - Placeholder when no PDF loaded
 */
const FileInfo = ({
    pdf,
    side,
    copyFeedback,

}) => {
    if (!pdf) {
        return (
            <span
                className="text-xs font-medium text-gray-400 truncate"
                title={`${side === 'left' ? 'Left' : 'Right'} PDF`}
            >
                {`${side === 'left' ? 'Left' : 'Right'} PDF`}
            </span>
        );
    }

    if (pdf.sourceUrl) {
        const isLocal = pdf.sourceUrl.startsWith('file:///');

        return (
            <a
                href="#"
                className="text-xs font-medium text-gray-700 hover:underline truncate cursor-pointer active:opacity-70"
                title={isLocal ? "Show in folder" : "Open in browser"}
                onClick={async (e) => {
                    e.preventDefault();

                    const tauri = window.__TAURI__;
                    const isTauri = !!tauri?.core?.invoke;

                    if (isTauri) {
                        try {
                            if (isLocal) {
                                // Prefer sourcePath if available, otherwise strip file protocol
                                let path = pdf.sourcePath;
                                if (!path && pdf.sourceUrl?.startsWith('file:///')) {
                                    // Basic stripping, might need decoding
                                    path = decodeURIComponent(pdf.sourceUrl.replace('file:///', ''));
                                }

                                if (path) {
                                    await tauri.core.invoke('show_in_folder', { path });
                                }
                            } else {
                                const opener = tauri?.opener;
                                if (opener?.openUrl) {
                                    await opener.openUrl(pdf.sourceUrl);
                                }
                            }
                        } catch (err) {
                            console.error("Failed to open generic file/link:", err);
                        }
                    } else {
                        // Web fallback
                        if (pdf.sourceUrl && !isLocal) {
                            window.open(pdf.sourceUrl, '_blank');
                        }
                    }
                }}
            >
                {copyFeedback || pdf.name}
            </a>
        );
    }

    return (
        <span className="text-xs font-medium text-gray-700 truncate" title={pdf.name}>
            {pdf.name}
        </span>
    );
};

export default FileInfo;
