use std::fs;
use std::sync::OnceLock;

// Store CLI args at startup (before Tauri takes over the event loop)
static CLI_PDF_PATHS: OnceLock<Vec<String>> = OnceLock::new();

/// Get PDF paths passed via CLI arguments (called by frontend on mount)
#[tauri::command]
fn get_cli_pdf_paths() -> Vec<String> {
    CLI_PDF_PATHS.get().cloned().unwrap_or_default()
}

/// Read a PDF file from the local filesystem
#[tauri::command]
fn read_pdf_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

/// Write a PDF file to the local filesystem
#[tauri::command]
fn write_pdf_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &data).map_err(|e| format!("Failed to write file {}: {}", path, e))
}


/// Open the file explorer with the file selected
#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path]) // Comma is important for explorer /select
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Fallback for other OS if ever needed (xdg-open, open, etc.)
        // For now, return error or no-op
        return Err("Not supported on this OS".to_string());
    }
    Ok(())
}

// Note: URL opening is handled by tauri-plugin-opener (window.__TAURI__.opener.openUrl)

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Parse CLI arguments BEFORE starting Tauri (ensures they're captured)
    let args: Vec<String> = std::env::args().collect();
    
    let pdf_paths: Vec<String> = args
        .into_iter()
        .skip(1) // Skip executable path
        .filter(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".pdf") && std::path::Path::new(arg).exists()
        })
        .collect();
    
    // Store for later retrieval by frontend
    let _ = CLI_PDF_PATHS.set(pdf_paths);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Debug logging (dev only)
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // DevTools enabled via "devtools" feature - use Ctrl+Shift+I to open
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cli_pdf_paths, 
            read_pdf_file, 
            write_pdf_file,
            show_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
