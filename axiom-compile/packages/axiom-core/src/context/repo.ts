/**
 * Context contract + a BROWSER-SAFE default. No `node:*` imports here so this
 * file can be bundled into the webview. Host code injects a real RepoContext via
 * `compileIntent({ context })` (see context/repo.node.ts for the Node collector).
 */

import type { GroundContext } from "./ground.js";

export interface RepoContext {
  language?: string;
  framework?: string;
  testRunner?: string;
  relevantPaths: string[];
  repoState: string;
  isPrivateRepo: boolean;
  /** Curated, validated Ground context when the host has ContextLock installed. */
  ground?: GroundContext;
}

/** Fallback used when no host context is injected (e.g. inside the webview). */
export function browserContext(): RepoContext {
  return {
    language: "unknown",
    framework: "unknown",
    testRunner: undefined,
    relevantPaths: [],
    repoState: "webview (no host context)",
    isPrivateRepo: false,
  };
}