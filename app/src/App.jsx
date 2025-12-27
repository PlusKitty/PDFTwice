import 'pdfjs-dist/web/pdf_viewer.css';
import SideBySidePDF from './SideBySidePDF'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

function App() {
  return (
    <div className="h-screen w-screen bg-gray-100 overflow-hidden">
      <ErrorBoundary>
        <SideBySidePDF />
      </ErrorBoundary>
    </div>
  )
}

export default App
