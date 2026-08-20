# 07 — Drift Auditing

## Core idea

A normal diff shows what changed in files.

A ContextLock audit should show what changed in project meaning.

## Drift categories

### 1. Documentation drift

Docs claim one thing, code/config says another.

Examples:

- README says `npm test`, package uses `pnpm test`.
- README says SQLite, code requires Postgres.
- docs mention an endpoint that no longer exists.

### 2. Architecture boundary drift

Code violates intended layering or module boundaries.

Examples:

- API imports database client directly.
- UI imports server-only module.
- domain logic appears in route handlers.

### 3. Test drift

Behavior changes without corresponding test changes.

Examples:

- new auth logic added, no auth tests touched.
- tests removed while code complexity increased.
- snapshot changes without contract tests.

### 4. Dependency drift

Dependencies change project shape or risk.

Examples:

- new database driver added,
- two HTTP clients now coexist,
- abandoned package introduced,
- lockfile changed without manifest change.

### 5. Convention drift

Project naming and organization become inconsistent.

Examples:

- `userId`, `user_id`, and `uid` all used for same concept.
- services/controllers/routes mixed inconsistently.

### 6. Prompt drift

Cached prompts no longer reflect repo state.

Examples:

- onboarding prompt references removed file,
- bugfix prompt omits new risky module,
- refactor prompt uses old architecture claim.

### 7. Debt drift

Known debt expands, moves, or becomes normalized.

Examples:

- TODO count increases,
- HACK markers appear in critical path,
- suppressions expire unresolved.

## Audit scoring

Use transparent scoring. Avoid black-box magic.

Example:

```txt
Base score: 0
High severity: +25 each
Medium severity: +10 each
Low severity: +3 each
Stale prompt: +8 each
Expired suppression: +15 each
Cap: 100
```

Interpretation:

```txt
0-20: low drift
21-50: moderate drift
51-75: high drift
76-100: severe drift
```

## Finding format

Every finding must include evidence.

```json
{
  "severity": "high",
  "category": "documentation_drift",
  "title": "README test command does not match package script",
  "evidence": [
    {
      "file": "README.md",
      "line": 18,
      "text": "Run npm test"
    },
    {
      "file": "package.json",
      "line": 9,
      "text": "\"test\": \"vitest\""
    }
  ],
  "recommendation": "Update README or package scripts so onboarding command is accurate."
}
```

## MVP audit rules

Start with simple, high-signal rules:

1. README command mismatch.
2. package manifest changed.
3. lockfile changed without manifest change.
4. TODO/FIXME/HACK count changed.
5. test files removed.
6. source files changed but tests untouched.
7. stale prompts after snapshot change.
8. docs changed but code untouched.
9. code changed but relevant docs untouched.
10. new risky dependency category.

## Rule engine design

Rules should be small functions:

```ts
interface AuditRule {
  id: string
  description: string
  evaluate(input: AuditInput): Finding[]
}
```

## Architecture contracts

Later, projects can define rules in config.

```json
{
  "architecture_rules": [
    {
      "id": "ui-no-server-imports",
      "match": ["src/ui/**"],
      "forbid_imports": ["src/server/**"],
      "severity": "high"
    }
  ]
}
```

## Elevating idea: drift fingerprint

Each project can accumulate a unique drift fingerprint.

Example:

```json
{
  "common_drift_modes": [
    "docs lag behind implementation",
    "auth logic duplicates during feature work",
    "tests skipped during config changes"
  ]
}
```

This lets ContextLock warn before common project-specific failure modes repeat.

## Elevating idea: semantic contradiction ledger

Maintain a ledger of project claims:

```json
{
  "claim": "The app uses SQLite locally",
  "source": "README.md",
  "evidence_status": "contradicted",
  "contradicted_by": "docker-compose.yml uses postgres:16"
}
```

This is more powerful than summarization. It turns documentation and architecture into auditable claims.
