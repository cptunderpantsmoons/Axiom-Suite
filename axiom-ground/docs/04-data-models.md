# 04 — Data Models

## Artifact principles

All artifacts should be:

- JSON for machine use,
- Markdown for human/AI prompt use,
- content-addressed where possible,
- tied to git commit and branch,
- safe to diff,
- safe to store remotely.

## `.contextlock/config.json`

Project-local configuration.

```json
{
  "version": 1,
  "project_name": "example-project",
  "project_id": "ctxproj_abc123",
  "include": ["**/*"],
  "exclude": [
    ".git/**",
    "node_modules/**",
    "dist/**",
    "build/**",
    ".contextlock/**"
  ],
  "automation": {
    "install_hooks": true,
    "auto_snapshot": true,
    "auto_prompt_refresh": true,
    "auto_audit": true,
    "auto_sync": false
  },
  "remote": {
    "provider": "huggingface",
    "repo": null,
    "token_env": "HF_TOKEN"
  }
}
```

`config.json` is validated against `schemas/config.schema.json` on every write
(`writeConfigJson`), so a config missing `project_id` or with a non-integer
`version` is rejected before it is persisted.

## `.contextlock/lock.json`

Latest local state pointer.

```json
{
  "version": 1,
  "project_id": "ctxproj_abc123",
  "current_branch": "main",
  "current_commit": "9f02c1",
  "latest_snapshot_hash": "ctxsnap_789",
  "latest_audit_id": "audit_456",
  "latest_prompt_hashes": {
    "onboarding": "ctxprompt_111",
    "bugfix": "ctxprompt_222"
  },
  "latest_site": {
    "site_hash": "ctxsite_123",
    "snapshot_hash": "ctxsnap_789",
    "index_path": ".contextlock/site/index.html"
  },
  "updated_at": "2026-05-16T00:00:00Z"
}
```

`lock.json` is validated against `schemas/lock.schema.json` on every write
(`writeLockJson`), which is used by `ctx init`, `ctx bootstrap`, `ctx snapshot`,
`ctx site`, `ctx audit`, `ctx prompt`, and `ctx pull` — so an invalid
`project_id`, a non-numeric `latest_drift_score`, or a missing required field
never lands on disk.

## Snapshot JSON

```json
{
  "schema_version": 1,
  "artifact_type": "snapshot",
  "project_id": "ctxproj_abc123",
  "snapshot_hash": "ctxsnap_789",
  "created_at": "2026-05-16T00:00:00Z",
  "git": {
    "branch": "main",
    "commit": "9f02c1",
    "dirty": false,
    "remote_url_hash": "remote_abc"
  },
  "machine_facts": {
    "languages": ["typescript", "python"],
    "file_count": 312,
    "manifests": ["package.json", "pyproject.toml"],
    "entrypoints": ["src/main.ts"],
    "test_commands": ["npm test", "pytest"],
    "build_commands": ["npm run build"],
    "dependencies": ["react", "fastapi"]
  },
  "project_map": {
    "directories": [
      {
        "path": "src/api",
        "role": "api layer",
        "file_count": 18
      }
    ],
    "important_files": [
      {
        "path": "README.md",
        "reason": "primary documentation"
      }
    ]
  },
  "debt_markers": [
    {
      "file": "src/auth/session.ts",
      "line": 42,
      "marker": "TODO",
      "text": "TODO replace temporary token refresh"
    }
  ],
  "inferred_context": {
    "summary": "Short project summary.",
    "architecture": ["API layer", "service layer", "persistence layer"],
    "risk_zones": ["auth", "payments"]
  },
  "human_annotations": {
    "architecture_claims": [],
    "known_debt": []
  },
  "security": {
    "redaction_count": 0,
    "sensitive_paths_skipped": 0
  },
  "content_fingerprints": {
    "README.md": "sha256_...",
    "package.json": "sha256_..."
  }
}
```

- `security.redaction_count` — number of secret redactions applied to debt-marker text lines during scanning (non-negative integer).
- `security.sensitive_paths_skipped` — number of files skipped from content fingerprinting because they matched a sensitive path (e.g. `.env`, `*.pem`); such files hash to a constant placeholder fingerprint rather than their real contents.

## Prompt metadata

```json
{
  "schema_version": 1,
  "artifact_type": "prompt",
  "prompt_id": "ctxprompt_111",
  "prompt_type": "onboarding",
  "project_id": "ctxproj_abc123",
  "snapshot_hash": "ctxsnap_789",
  "source_commit": "9f02c1",
  "created_at": "2026-05-16T00:00:00Z",
  "depends_on": [
    "README.md",
    "package.json",
    "src/**",
    "tests/**"
  ],
  "valid_until_snapshot_change": true
}
```

## HTML site metadata

```json
{
  "schema_version": 1,
  "artifact_type": "site",
  "site_hash": "ctxsite_123",
  "project_id": "ctxproj_abc123",
  "snapshot_hash": "ctxsnap_789",
  "audit_id": "audit_456",
  "generated_at": "2026-05-16T00:00:00Z",
  "pages": [
    "index.html",
    "snapshot.html",
    "architecture.html",
    "prompts.html",
    "audit.html",
    "claims.html",
    "progress.html",
    "plans.html"
  ]
}
```

## Audit JSON

```json
{
  "schema_version": 1,
  "artifact_type": "audit",
  "audit_id": "audit_456",
  "project_id": "ctxproj_abc123",
  "from_snapshot": "ctxsnap_old",
  "to_snapshot": "ctxsnap_new",
  "from_commit": "abc111",
  "to_commit": "def222",
  "created_at": "2026-05-16T00:00:00Z",
  "drift_score": 72,
  "scoring_model": "weighted_heuristic",
  "findings": [
    {
      "id": "finding_001",
      "severity": "high",
      "category": "architecture_boundary",
      "title": "API layer imports database client directly",
      "evidence": [
        {
          "file": "src/api/users.ts",
          "line": 4,
          "text": "import { db } from '../db/client'"
        }
      ],
      "recommendation": "Route database access through service layer."
    }
  ],
  "stale_prompts": ["onboarding", "bugfix"]
}
```

- `scoring_model` — labels the drift-scoring method. Currently `"weighted_heuristic"`: a transparent, configurable weighted sum of finding severities and stale-prompt/expired-suppression counts (see `docs/specs/14-audit-scoring-versioning.md`). It is a heuristic indicator, **not** a statistical or absolute measurement of code quality.

## Plan JSON

Generated by `ctx plan feature|refactor|release`; written to `.contextlock/plans/<plan_id>.json` (+ `.md`).

```json
{
  "schema_version": 2,
  "artifact_type": "plan",
  "plan_id": "ctxplan_abc123",
  "plan_type": "feature",
  "project_id": "ctxproj_abc123",
  "snapshot_hash": "ctxsnap_789",
  "source_commit": "9f02c1",
  "created_at": "2026-05-16T00:00:00Z",
  "summary": "Feature plan for \"src/api\" in example-project.",
  "context": {
    "project_name": "example-project",
    "languages": ["javascript"],
    "entrypoints": ["src/main.js"],
    "test_commands": ["npm test"],
    "build_commands": ["npm run build"],
    "dependencies": ["leftpad"],
    "latest_drift_score": 12,
    "audit_findings": [
      { "id": "finding_001", "title": "API layer imports database client directly", "severity": "high" }
    ],
    "prompt_freshness": "fresh"
  },
  "quality_gates": [
    { "name": "Tests pass", "command": "npm test", "description": "The full test suite is green before this task is considered done." },
    { "name": "No new high-severity drift", "command": "ctx audit --since-last --json", "description": "The drift audit reports no new high-severity findings from this work." }
  ],
  "tasks": [
    {
      "id": "task-1-understand",
      "description": "Review current implementation in src/api",
      "affected_modules": ["src/api"],
      "expected_touched_files": ["src/api/users.js"],
      "steps": [
        "Read the identified files and note current behavior, patterns, and conventions.",
        "Record the baseline drift score with `ctx audit --since-last --json` before making changes."
      ],
      "acceptance_criteria": ["Existing code patterns and conventions understood"],
      "quality_gates": [
        { "name": "Baseline recorded", "command": "ctx snapshot && ctx audit --since-last --json", "description": "A baseline snapshot and drift score are recorded before changes begin." }
      ],
      "validation_commands": ["npm test"],
      "rollback_criteria": "No changes made yet — nothing to roll back.",
      "depends_on": [],
      "references_prompts": ["onboarding"]
    }
  ],
  "audit_checkpoints": ["pre-implementation", "post-tests", "post-implementation", "post-docs"],
  "rollback_plan": "1. Revert implementation commits in reverse order.",
  "validation_summary": "Validate by running: npm test; npm run build"
}
```

- `schema_version` is `2` (added `quality_gates` and task `steps`; version `1` plans remain readable by `ctx audit --against-plan`).
- **Plan-level `quality_gates`** are the whole-plan definition of done, derived from detected project commands.
- **Task-level `quality_gates`** are named, command-backed checkpoints that must pass before that task is complete; `ctx audit --against-plan` emits a low-severity `plan-task-ungated` finding for any task without them.
- **`steps`** are the granular, ordered sub-steps for executing a task.
- `audit_checkpoints`, `rollback_plan`, and `validation_summary` are the plan-wide verification, abort, and validation guidance.

## Planning progress ledger

`docs/planning/contextlock-progress.json` (rendered by `progress.html`) is the version-controlled
record of spec/build/guardrail status. `ctx progress set spec|build <id> <status>` (or
`ctx progress set guardrail <active|planned> <name> <status>`) updates it, and
`ctx audit --against-plan <plan_id>` appends verified gate results to its `plan_audits` array.

```json
{
  "plan_audits": [
    {
      "plan_id": "ctxplan_abc123",
      "plan_type": "feature",
      "verified_at": "2026-05-16T00:00:00Z",
      "on_track": true,
      "verdict": "Plan appears on track",
      "findings_total": 1,
      "task_results": [
        { "id": "task-1-understand", "gates_verified": true, "issue_count": 0 }
      ]
    }
  ]
}
```

- `task_results[].gates_verified` is `false` when the plan audit found a finding scoped to that task (`plan-task-*:<task_id>`); `issue_count` counts those findings.
- `on_track` is `true` when there are no high/medium-severity findings.
- Entries are keyed by `plan_id`; re-auditing the same plan replaces its prior entry.

The ledger is validated in CI against `schemas/planning-progress.schema.json` (via
`npm run lint`), so an out-of-scale spec/build status, an invalid guardrail status, or a
malformed `plan_audits` entry fails the build.

## Rule model

```json
{
  "id": "api-no-db-direct",
  "description": "API layer must not import database client directly",
  "severity": "high",
  "match": ["src/api/**"],
  "forbid_imports": ["src/db/**"]
}
```

## Suppression model

Suppressions must expire. This prevents permanent normalization of debt.

```json
{
  "finding_id": "finding_001",
  "reason": "Temporary during migration",
  "expires_at": "2026-06-01T00:00:00Z",
  "approved_by": "local-user"
}
```

## Memory entry (`spec-20`)

Append-only, snapshot-anchored agent memory under `.contextlock/memory/<id>.json`.

```json
{
  "schema_version": 1,
  "id": "mem_9f02c1a1b2c3d4e5",
  "type": "procedural",
  "content": "Onboarding requires a fresh snapshot before the prompt cache is valid.",
  "anchor_hash": "ctxsnap_789",
  "related_files": ["README.md", "src/main.ts"],
  "created_at": "2026-05-16T00:00:00Z",
  "superseded_by": null,
  "redacted": false
}
```

- `id` is content-addressed as `hash(normalized_content + sorted(related_files))`; `anchor_hash` is stored separately.
- `superseded_by` links a replacement; entries are never deleted, only linked.
- `redacted` is set when `redactSecrets` fired on `content`.

## RAG ingestion bundle manifest (`spec-19`)

Produced by `ctx site export --rag <dir>`; documents live in `<dir>/documents/<doc_id>.md`.

```json
{
  "rag_bundle_version": 1,
  "generated_at": "2026-05-16T00:00:00Z",
  "snapshot_hash": "ctxsnap_789",
  "bundle_determinism_hash": "sha256_...",
  "artifact_counts": { "snapshot": 6, "memory": 1, "code": 0, "total": 7 },
  "documents": [
    {
      "doc_id": "ctxsnap_78-overview",
      "source": "snapshot",
      "title": "overview",
      "snapshot_hash": "ctxsnap_789",
      "anchor_hash": "ctxsnap_789",
      "related_files": [],
      "redacted": false
    },
    {
      "doc_id": "mem_9f02c1a1b2c3d4e5",
      "source": "memory",
      "title": "procedural: mem_9f02c1a1b2c3d4e5",
      "snapshot_hash": "ctxsnap_789",
      "anchor_hash": "ctxsnap_789",
      "related_files": ["README.md"],
      "redacted": false
    }
  ]
}
```

- `bundle_determinism_hash` excludes `generated_at`; identical repo state ⇒ identical hash.
- With `--code`, additional `source: "code"` documents are appended (one per indexed file).

## Code index artifact (`spec-21`)

Produced by `ctx code index`; written to `.contextlock/index/<snapshot_hash>.json`.

```json
{
  "schema_version": 1,
  "artifact_type": "code_index",
  "code_index_version": 1,
  "snapshot_hash": "ctxsnap_789",
  "generated_at": "2026-05-16T00:00:00Z",
  "index_determinism_hash": "sha256_...",
  "artifact_counts": { "files": 12, "symbols": 34, "redacted": 1 },
  "files": [
    {
      "doc_id": "f-1a2b3c4d5e6f7g8h",
      "path": "src/index.js",
      "language": "javascript",
      "classification": "source",
      "content_hash": "sha256_...",
      "size_bytes": 512,
      "redacted": false,
      "symbols": [
        { "name": "bootstrap", "kind": "function", "line": 1 },
        { "name": "Server", "kind": "class", "line": 4 }
      ]
    }
  ]
}
```

- `doc_id` = `f-<sha256(posix_path + "\0" + content_hash)[:16]>` (content-addressed, stable across runs).
- `index_determinism_hash` excludes `generated_at` and file ordering.
- Symbol extraction is lightweight, best-effort, per-language; empty for unsupported languages.
