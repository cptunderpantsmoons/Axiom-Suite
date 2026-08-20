/** Axiom configuration: modes, budgets, providers (data, not logic). */

export type Singlemode = "auto" | "interactive" | "one-shot";

export interface AppConfig {
  modes: { auto: boolean; interactive: boolean; oneShot: boolean };
  defaultMode: Singlemode;
  /** Resolution-gate ceiling (PLAN §2: ask max 3, only if it materially changes output). */
  maxQuestions: number;
  maxRepairRetries: number;
  tokenBudgets: { relevantCodeBudget: number; contextBudget: number };
  /** M1 uses the deterministic mock provider; M2 swaps in `deepseek`. */
  defaultProvider: string;
  deepseek: {
    apiKey?: string;
    model: string;
    baseUrl: string;
  };
}

export const defaultConfig: AppConfig = {
  modes: { auto: true, interactive: true, oneShot: true },
  defaultMode: "interactive",
  maxQuestions: 3,
  maxRepairRetries: 2,
  tokenBudgets: { relevantCodeBudget: 6000, contextBudget: 20000 },
  defaultProvider: "mock",
  deepseek: {
    // Browser-safe: `process` is undefined inside the webview.
    apiKey: typeof process !== "undefined" ? process.env.DEEPSEEK_API_KEY : undefined,
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com/v1",
  },
};
