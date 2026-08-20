// Axiom — thin Tauri shell (architecture §9.1): windowing + packaging only.
// All domain logic lives in @axiom/core running in the React webview.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Axiom");
}