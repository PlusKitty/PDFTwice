// Selectively suppress noisy PDF.js warnings while keeping other warnings visible
// Must be at the VERY TOP before any imports to intercept all console calls
const pdfJsNoisePatterns = ['flatedecode', 'textlayerrender', 'textcontentstream', 'textcontent`', 'deprecated api usage'];

const originalWarn = console.warn;
console.warn = (...args) => {
  const msg = args[0]?.toString?.()?.toLowerCase() || '';
  if (pdfJsNoisePatterns.some(p => msg.includes(p))) return;
  originalWarn.apply(console, args);
};

const originalLog = console.log;
console.log = (...args) => {
  const msg = args[0]?.toString?.()?.toLowerCase() || '';
  if (pdfJsNoisePatterns.some(p => msg.includes(p))) return;
  originalLog.apply(console, args);
};

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
