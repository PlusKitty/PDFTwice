import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        // Optional: Only reload if strictly necessary, but often state reset is enough
        // window.location.reload(); 
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8 bg-gray-50 border-2 border-dashed border-red-200 rounded-lg text-center">
                    <div className="bg-red-100 p-4 rounded-full mb-4">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-800 mb-2">Something went wrong</h2>
                    <p className="text-sm text-gray-600 max-w-md mb-6">
                        The PDF viewer encountered an unexpected error. This might be due to a corrupt PDF file or a rendering issue.
                    </p>

                    {this.state.error && (
                        <div className="bg-white border border-red-100 p-3 rounded text-xs text-red-600 font-mono mb-6 max-w-full overflow-auto whitespace-pre-wrap">
                            {this.state.error.toString()}
                        </div>
                    )}

                    <button
                        onClick={this.handleRetry}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-sm font-medium"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
