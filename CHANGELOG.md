# Changelog

All notable changes to the **Twice PDF** project will be documented in this file.

## [1.1.0] - 2026-01-12

### 🚀 Added
- **Desktop Application (Tauri)**:
  - Native Windows executable with direct file system access.
  - **CLI Support**: Open PDFs directly via command line (`TwicePDF.exe file1.pdf file2.pdf`).
  - **Native Export**: "Save to source" option (bypasses browser dialog).
  - **Configurable Output**: Filename prefix/suffix settings for exported files.
- **Accessibility & Alt Text**:
  - **Alt Text Extraction**: Hybrid strategy using Structure Tree (BBox), MCID matching, and Fallback Heuristics.
  - **Visual Indicators**: Toggleable "ALT" badge on images with tooltips.
  - **Advanced Settings**: Configurable fallback modes (Spatial vs. Draw order) for untagged PDFs.
- **Sidebar Panels**:
  - **Bookmarks**: Navigate document outline and Table of Contents.
  - **Annotations**: key-value list of all comments, sticky notes, and highlights.

### ⚡ Improved
- **Architecture**: Major refactor into 25+ modular components (reduced code volume by ~20%).
- **Search**: Fixed active result highlighting and scroll behavior.
- **Rendering**: Z-index consolidation to prevent UI layering bugs.
- **Links**: Enabled internal PDF cross-reference links and ToC navigation.

### 🐛 Fixed
- Fixed issue where resizing sidebars didn't update viewport margins.
- resolved various React hook dependency warnings.

---

## [Pre-2026 History]

### Core Features
- Dual PDF viewing with synced scrolling (Lock/Unlock modes).
- Sticky notes and text highlighting.
- Session recovery (local storage).
- URL-based PDF loading (`?a=...&b=...`).
- SSRF protection and proxy fallback chain.
