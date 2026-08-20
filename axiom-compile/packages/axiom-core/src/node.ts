/**
  * NODE-ONLY entry for @axiom/core. Re-exports the browser-safe index plus the
 * host-side Node capabilities (deterministic context collection, Claude CLI
 * detection) which import `node:*` APIs and MUST NOT enter the webview bundle.
 * CLI, preview server, and Tauri Rust IPC import from this entry.
 */
export * from "./index.js";
export { collectContext } from "./context/repo.node.js";
export { detectClaudeCli } from "./harness/claudeCode.js";