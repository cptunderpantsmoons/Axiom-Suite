/**
 * Axiom single JSON seam. Plain §2: "One JSON contract seams the whole
 * pipeline. If it's not valid JSON, it didn't happen."
 *
 * Mirrors the locked schemas in project-docs/architecture.md §4 and PLAN §7.
 */
import { z } from "zod";

export const TaskType = z.enum([
  "feature",
  "fix",
  "refactor",
  "test",
  "docs",
  "setup",
  "investigate",
  "migration",
  "other",
]);
export type TaskType = z.infer<typeof TaskType>;

export const IntentQuestion = z.object({
  id: z.string(),
  question: z.string(),
  kind: z.enum(["single_choice", "boolean", "free_text"]),
  options: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .optional(),
  default: z.string(),
  rationale: z.string(),
});
export type IntentQuestion = z.infer<typeof IntentQuestion>;

/** Contract §4.1 — the compiled, validated intent (post-question-gate). */
export const IntentResult = z.object({
  contract_v: z.literal(1),
  intent_id: z.string().uuid(),
  task_type: TaskType,
  summary: z.string().min(1),
  target_area: z.string(),
  scope_lock: z.string(),
  assumptions: z.array(z.string()),
  constraints: z.array(z.string()),
  non_goals: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  verification_hints: z.array(z.string()),
  risk: z.object({
    score: z.number().min(0).max(1),
    dangerous: z.enum(["none", "destructive", "require_plan"]),
    needs_questions: z.boolean(),
  }),
  questions: z.array(IntentQuestion).max(3),
});
export type IntentResult = z.infer<typeof IntentResult>;

/** Contract §4.2 — one row in any memory layer (A/B/C/D). */
export const MemoryRule = z.object({
  contract_v: z.literal(1),
  rule_id: z.string().uuid(),
  layer: z.enum(["global_prefs", "project_dna", "correction", "task_template"]),
  scope: z.enum(["global", "project"]),
  project_path: z.string().optional(),
  rule_type: z.enum(["positive", "negative", "template"]),
  text: z.string().min(1),
  source_task_type: z.string().optional(),
  confidence: z.number().min(0).max(1),
  requires_confirmation: z.boolean().default(false),
  created_at: z.string().datetime(),
  last_used_at: z.string().datetime().nullable(),
});
export type MemoryRule = z.infer<typeof MemoryRule>;

/** Contract §4.3 — the final deliverable task packet (§7 as data). */
export const TaskPacket = z.object({
  contract_v: z.literal(1),
  packet_id: z.string().uuid(),
  intent_id: z.string().uuid(),
  emitted_at: z.string().datetime(),
  mode: z.enum(["direct", "claude_code", "plan_only"]),
  task_contract: z.object({
    objective: z.string(),
    task_type: TaskType,
    target_area: z.string(),
    scope_lock: z.string(),
  }),
  project_context: z.object({
    language: z.string().optional(),
    framework: z.string().optional(),
    test_runner: z.string().optional(),
    relevant_paths: z.array(z.string()),
    repo_state: z.string(),
  }),
  constraints: z.array(z.string()),
  non_goals: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  verification: z.array(z.string()),
  relevant_code: z.string(),
  untrusted_content: z.array(z.string()),
  execution_rules: z.array(z.string()),
  output_contract: z.object({
    files: z.array(z.string()),
    commands: z.array(z.string()),
    tests: z.array(z.string()),
    assumptions: z.array(z.string()),
    risks: z.array(z.string()),
  }),
  token_budget: z.object({
    relevant_code_budget: z.number(),
    context_budget: z.number(),
  }),
  /** Optional cross-stack provenance; absent for standalone Compile usage. */
  ground_context: z.object({
    schema_version: z.literal("ground.context.v1"),
    project_id: z.string(),
    snapshot_hash: z.string(),
    prompt_pack_id: z.string().nullable(),
    drift_score: z.number().nullable(),
    code_index_hash: z.string().nullable(),
  }).optional(),
  risk_score: z.number().min(0).max(1).optional(),
  risk_dangerous: z.enum(["none", "destructive", "require_plan"]).optional(),
});
export type TaskPacket = z.infer<typeof TaskPacket>;