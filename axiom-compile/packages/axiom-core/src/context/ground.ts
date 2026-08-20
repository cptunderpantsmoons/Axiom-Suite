import { z } from "zod";

export const GroundMemoryEntry = z.object({
  id: z.string(),
  type: z.string(),
  content: z.string(),
  anchor_hash: z.string(),
  related_files: z.array(z.string()),
  stale: z.boolean(),
  stale_reason: z.string().nullable(),
  superseded_by: z.string().nullable(),
  redacted: z.boolean(),
  schema_version: z.number().int(),
});

export const GroundContext = z.object({
  schema_version: z.literal("ground.context.v1"),
  project: z.object({
    project_id: z.string(),
    project_name: z.string(),
  }),
  snapshot: z.object({
    snapshot_hash: z.string(),
    snapshot_schema_version: z.number().int(),
    hash_spec_version: z.number().int(),
    created_at: z.string(),
    git: z.object({
      branch: z.string().nullable(),
      commit: z.string().nullable(),
      dirty: z.boolean(),
    }),
  }),
  prompt_pack: z.object({
    prompt_id: z.string().nullable(),
    prompt_type: z.literal("onboarding"),
    snapshot_hash: z.string(),
    available: z.boolean(),
  }),
  drift: z.object({
    audit_id: z.string().nullable(),
    score: z.number().nullable(),
    status: z.enum(["unknown", "pass", "warn", "fail"]),
    snapshot_hash: z.string(),
  }),
  repo_context: z.object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    test_commands: z.array(z.string()),
    build_commands: z.array(z.string()),
    run_commands: z.array(z.string()),
    entrypoints: z.array(z.string()),
    important_files: z.array(z.record(z.string(), z.unknown())),
  }),
  memory: z.object({ entries: z.array(GroundMemoryEntry) }),
  code_index: z.object({
    available: z.boolean(),
    snapshot_hash: z.string().nullable(),
    index_determinism_hash: z.string().nullable(),
  }),
  security: z.object({
    secret_scan_passed: z.boolean(),
    redaction_count: z.number().int().nonnegative(),
    sensitive_paths_skipped: z.number().int().nonnegative(),
  }),
});

export type GroundContext = z.infer<typeof GroundContext>;
