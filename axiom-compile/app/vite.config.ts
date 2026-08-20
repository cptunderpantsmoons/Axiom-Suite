import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri needs a fixed port + clear screen for the Rust webview to connect.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2021", outDir: "dist", emptyOutDir: true },
});