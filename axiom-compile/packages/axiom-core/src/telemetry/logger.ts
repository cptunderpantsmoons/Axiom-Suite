/**
 * Local-only structured telemetry (architecture §9.4, M7). In M1 we log to
 * console as a stub; M7 persists rows to the per-user SQLite data dir and makes
 * them the eval corpus. No cloud egress in v1 — privacy-first.
 */

export interface TelemetryRow {
  intent_id?: string;
  packet_id?: string;
  mode: string;
  provider: string;
  risk: number;
  questions_asked: number;
  default_used: boolean;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms?: number;
  user_accept?: boolean;
  user_reject?: boolean;
  rework?: number;
  failure_category?: string;
  ts: string;
}

const rows: TelemetryRow[] = [];

export const telemetry = {
  record(row: TelemetryRow): void {
    rows.push(row);
    // M1 stub: structured console record; M7 writes to SQLite.
    // Browser-safe: `process` is undefined inside the webview.
    if (typeof process !== "undefined" && process.env.AXIOM_DEBUG) {
      console.log(`[telemetry] ${JSON.stringify(row)}`);
    }
  },
  list(): TelemetryRow[] {
    return [...rows];
  },
  clear(): void {
    rows.length = 0;
  },
};