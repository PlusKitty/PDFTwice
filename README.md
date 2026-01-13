# <img src="app/public/favicon.ico" width="40" height="40" style="vertical-align: text-bottom;"> Twice PDF

A lightweight PDF viewer and annotator with synced side-by-side view. Built for QC, translation checks, and version comparison. Try it online [here](https://pluskits.github.io/Twice-PDF)!

![Twice PDF Screenshot](app/public/screenshot/Main%20view.png)

---
### 🎁 Ready to Use


 * **Instant web access**.
* **Private and local**.
* **Open source and ad free**.
## ✨ For Users


### 🔍 Core Features

- **Side by side**: Compare two PDFs in the same viewer
- **Synced view**: Simultaneous scroll, zoom, and page navigation
- **Search**: Find and navigate to any string
- **Bookmarks sidebar**: Browse and create custom bookmarks and ToC outline
- **Annotations sidebar**: View all sticky notes, comments, and highlights
- **View modes**: Switch between page-by-page rendering or continuous scroll
- **Session recovery**: Comments get autosaved and restored when you come back
- **Accessibility**: Show alt text on hover, with an optional visual indicator
- **Automation friendly**: Load remote and local PDFs on the web version like this: `?a=doc1.pdf&b=doc2.pdf` or use command line arguments with the desktop app.

### 💬 Annotations & Review

- **Sticky notes**: Double click to add comments anywhere on the page
- **Text annotations**: Select text to highlight or add comments
- **Custom author**: Change your name so your comments are easily identifiable
- **Export**: Download annotated PDFs with your changes

### 🖥️ Desktop App
Twice PDF is available as a native Windows application powered by **Tauri**.
- **CLI Support**: Open PDFs via command line: `Twice-PDF.exe doc1.pdf doc2.pdf`
- **Native I/O**: Direct file access including "save to source" functionality with configurable naming patterns.
- **Fully offline**: No online capabilities necessary to view and save PDFs.
- **Minimal footprint**: Tauri uses the OS native web viewer, avoiding Electron-like embedding for a 95% smaller bundle size, 60-90% less memory usage, and automatic browser updates. The Windows app is **under 15 MB**!

---

## 🛠 For Developers & Teams

### 💡 Why Choose Twice PDF?

|   |   |
|---|---|
| **Lightweight** | ~150KB gzipped. Minimal dependencies. |
| **Flexible** | URL and CLI parameters, env configs, extensible architecture. |
| **Bespoke** | Modern, sleek UI. Flat design. Easily themed. |
| **Scalable** | Lazy rendering with IntersectionObserver. Handles large documents. |
| **Robust** | Multi-proxy CORS fallback, SSRF protection, DNS pinning. |
| **Secure** | Private IP filtering, path traversal protection, feature flags. |
| **Modular** | 25+ focused modules: SearchPanel, AnnotationOverlay, useAnnotations, pdfExport, etc. |

### 🏗 Architecture Highlights

- **React 19 + Vite 7**: Modern stack with fast HMR and optimized builds
- **PDF.js Bundled Locally**: No CDN calls—faster, private, offline-ready
- **Smooth Zoom Engine**: CSS transform for instant feedback + debounced re-render
- **RAF-Throttled Sync**: `requestAnimationFrame` scroll handling prevents flooding
- **Memory Management**: Off-screen page unloading
- **Canvas Size Guard**: Prevents browser crashes on oversized pages
- **Error Boundary**: Graceful error handling with retry UI

### 🔧 Configuration

`.env` in the `app` directory:

| Variable | Default | Description |
|:---------|:-------:|:------------|
| `VITE_ENABLE_REMOTE_PDFS` | `true` | Disable to block external URL loading |
| `VITE_ENABLE_LOCAL_BRIDGE` | `true` | Disable to block local file access via dev bridge |

### 🔒 Security

- **SSRF Protection**: IP filtering, DNS pinning, redirect validation
- **Private IP Blocking**: Rejects 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x
- **Path Traversal Protection**: Local bridge restricted to `public/samples`
- **Network Exposure Warning**: Console alert if dev server exposed to LAN

### 🔌 Integration Potential

- Auto-generate comparison views for QC processes
- Add custom action buttons (e.g., database operations)
- Autosave with preset naming patterns
- URL parameter API for programmatic loading

### 🚨 CORS Proxy Notice

Remote PDFs use a fallback chain of public proxies:
1. Direct fetch → 2. AllOrigins → 3. CORS.lol → 4. corsproxy.io

 When direct fetch fails due to a CORS error, "Load from URL" will pass the PDF through third-party proxies. For sensitive documents, **download and upload manually**.

---

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)

### Installation

```bash
git clone https://github.com/PlusKits/Twice-PDF.git
cd Twice-PDF/app
npm install
npm run dev

# For Desktop App
npm run tauri:dev   # Debug mode
npm run tauri:build # Release build
```

Open `http://localhost:5173` in your browser.

### URL Parameters

```
http://localhost:5173/?a=file1.pdf&b=file2.pdf
```

> [!NOTE]
> The Vite local bridge only serves files from `app/public/samples` for security. The base path can be configured.

---

## 🌐 Deployment

Deploy as a static site on [GitHub Pages](https://pages.github.com/), [Vercel](https://vercel.com/), or [Netlify](https://www.netlify.com/). Deploy as a Windows executable via our GitHub releases.

> [!NOTE]
> Local path functionality is only available through the Vite dev server and desktop app due to browser security restrictions.

---

## 📜 License

**GNU Affero General Public License v3.0 (AGPLv3)**

- ✅ Free to use for personal or internal purposes
- ✅ Modify and distribute with source code disclosure
- ⚠️ SaaS usage requires source code release under the same license

**Want different terms?** 

If you are an open source developer, I will gladly help. Even if you don't need a license, if you are working on a PDF viewer I would love to chat!
If you are a business, we can talk too.

Contact: pluskittydev [at] gmail [dot] com

See [LICENSE](LICENSE) for full details.

---

## 📋 Changelog

See [CHANGELOG.md](CHANGELOG.md) for complete version history.

**Latest Updates (January 2026):**
- **Desktop Support**: Native Windows app with Tauri (CLI args, native file access).
- **Accessibility**: Alt text extraction, visualization, and fallback heuristics.
- **Architecture**: Major refactor into 25+ modular components.
- **Panels**: New Bookmarks and Annotations sidebars.

-----
### Screenshots 
**Add comments and highlights**

![Add comment](app/public/screenshot/Add%20comment.png)

**View existing comments**

![See comment](app/public/screenshot/See%20comment.png)

**Search and explore**

![Search view](app/public/screenshot/Search.png)
