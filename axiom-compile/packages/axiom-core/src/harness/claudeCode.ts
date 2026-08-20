import { execFile, spawn } from "node:child_process";

/**
 * Harness B: dispatch to the `claude` CLI (architecture §9.2, M0/P1-10 probe).
 * v1: detect presence + time-boxed spawn; full execution lands in M5.
 */
export async function detectClaudeCli(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("claude", ["--version"], { timeout: 3000 }, (err) => {
      resolve(!err);
    });
  });
}

export function spawnClaude(packetMarkup: string): void {
  // Stub probe only for M1 (never executes a real task). Time-boxed in M5.
  const child = spawn("claude", ["-p", packetMarkup], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", () => void 0); // absent CLI handled gracefully by caller routing
  setTimeout(() => child.kill(), 3000);
}