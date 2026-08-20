import type { z } from "zod";

/** Model provider port (architecture §7). UI-agnostic, thin, deterministic boundary. */

export interface CompletionRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelProvider {
  id: string;
  /** demoGateway=false: a non-private provider must never see private repo data. */
  readonly privateSafe: boolean;
  /** Complete a request and validate against the given Zod schema. Fail-closed. */
  complete<T>(req: CompletionRequest, schema: z.ZodType<T>): Promise<T>;
}

/** Build an intent-compilation prompt (M1: context + memory inject into constraints). */
export function buildIntentPrompt(
  rawRequest: string,
  repo: { language?: string; framework?: string; repoState: string },
  memoryRules: string[],
): { system: string; user: string } {
  const system = [
    "You are Axiom's intent compiler. Transform a messy human request into",
    "a structured intent (strict JSON matching the provided schema).",
    "Rules: task_type must be one of the enum; store exact user wording in summary;",
    "NEVER silently rewrite intent — list assumptions instead;",
    "non_goals must prevent scope expansion;",
    "propose at most 3 resolution gates and ONLY those whose answers materially change output.",
    "Return ONLY valid JSON. If it is not valid JSON, it did not happen.",
  ].join(" ");

  const user = [
    `Raw request: ${JSON.stringify(rawRequest)}`,
    `Detected project: language=${repo.language ?? "unknown"}, framework=${repo.framework ?? "unknown"}, repo_state=${repo.repoState}`,
    memoryRules.length
      ? `Known constraints from precedents:\n- ${memoryRules.join("\n- ")}`
      : "Known constraints from memory: none",
    "Produce the IntentResult JSON object now.",
  ].join("\n");

  return { system, user };
}