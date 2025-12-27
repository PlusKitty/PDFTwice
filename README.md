# <img src="app/public/favicon.ico" width="40" height="40" style="vertical-align: text-bottom;"> PDFTwice

**Compare PDFs the smart way.** A minimalist, privacy-first tool for side-by-side PDF review—built for QC, translation checks, and version comparison. Try it [here](https://pluskitty.github.io/PDFTwice)!

![PDFTwice Screenshot](app/public/screenshot/Main%20view.png)

---

## ✨ For Users

### 🎁 Ready to Use
| Feature | Why It Matters |
|:--------|:---------------|
| **No Install Required** | Open the web app and start comparing—nothing to download or configure. |
| **100% Private** | Your PDFs never leave your browser. All processing happens locally. |
| **Ad-Free** | Clean interface, no distractions. Focus on your documents. |
| **Free & Open Source** | Use it forever, for free. Inspect the code anytime. |
| **Offline Capable** | Once loaded, works without an internet connection. |

### 🔍 Core Features

- **Dual View**: Two PDFs side-by-side for effortless comparison
- **Synced Scrolling**: Lock scroll, zoom, and navigation between panels
- **Instant Search**: Find text with context previews and page numbers
- **Fit to Page**: One-click zoom to fit page in viewport
- **View Modes**: Toggle between page-by-page or continuous scroll

### 💬 Annotations & Review

- **Sticky Notes**: Double-click to add comments anywhere
- **Text Highlighting**: Select text to highlight—with or without comments
- **Custom Author**: Your name persists across sessions
- **One-Click Export**: Download annotated PDFs instantly

### 🔄 Session & Sharing

- **Session Recovery**: Comments auto-save—restored if you close the tab
- **URL-Based Loading**: Share via `?a=doc1.pdf&b=doc2.pdf`
- **Unsaved Changes Warning**: Prompted before losing work

---

## 🛠 For Developers & Teams

### 💡 Why Choose PDFTwice?

| Quality | What It Means |
|:--------|:--------------|
| **Lightweight** | ~150KB gzipped. Minimal dependencies. |
| **Flexible** | URL parameters, env configs, extensible architecture. |
| **Bespoke** | Modern, sleek UI. Flat design. Easily themed. |
| **Scalable** | Lazy rendering with IntersectionObserver. Handles large documents. |
| **Robust** | Multi-proxy CORS fallback, SSRF protection, DNS pinning. |
| **Secure** | Private IP filtering, path traversal protection, feature flags. |

### 🏗 Architecture Highlights

- **React 19 + Vite 7**: Modern stack with fast HMR and optimized builds
- **PDF.js Bundled Locally**: No CDN calls—faster, private, offline-ready
- **Smooth Zoom Engine**: CSS transform for instant feedback + debounced re-render
- **RAF-Throttled Sync**: `requestAnimationFrame` scroll handling prevents flooding
- **Memory Management**: Off-screen page unloading in continuous mode
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

> [!WARNING]
> When using "Load from URL", content may pass through third-party proxies. For sensitive documents, **download locally and upload manually**.

---

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)

### Installation

```bash
git clone https://github.com/PlusKitty/PDFTwice.git
cd PDFTwice/app
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### URL Parameters

```
http://localhost:5173/?a=file1.pdf&b=file2.pdf
```

> [!NOTE]
> The local bridge only serves files from `app/public/samples` for security.

---

## 🌐 Deployment

Deploy as a static site on [GitHub Pages](https://pages.github.com/), [Vercel](https://vercel.com/), or [Netlify](https://www.netlify.com/).

> [!NOTE]
> The "Local Bridge" feature is only available when running the Vite dev server.

---

## 📜 License

**GNU Affero General Public License v3.0 (AGPLv3)**

- ✅ Free to use for personal or internal purposes
- ✅ Modify and distribute with source code disclosure
- ⚠️ SaaS usage requires source code release under the same license

**Want different terms?** 

If you are an open source developer, I want to help you. If you are a business, let's talk.

Contact: pluskittydev [at] gmail [dot] com

See [LICENSE](LICENSE) for full details.

-----
### Screenshots 
**Add comments and highlights**

![Add comment](app/public/screenshot/Add%20comment.png)

**View existing comments**

![See comment](app/public/screenshot/See%20comment.png)

**Search and explore**

![Search view](app/public/screenshot/Search.png)
