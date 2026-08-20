# 05 — CLI and Automation

## CLI design principle

The CLI should be boring, predictable, and scriptable.

Avoid conversational UX. ContextLock is infrastructure.

## Command map

```bash
ctx init
ctx snapshot
ctx prompt <type>
ctx prompt refresh
ctx audit
ctx memory add|list|verify|supersede
ctx code index
ctx site build
ctx site open
ctx site export <dir> [--rag <dir>] [--code]
ctx sync
ctx pull
ctx daemon start
ctx daemon stop
ctx hooks install
ctx status
```

## `ctx init`

Creates `.contextlock/`, writes config, detects project shape, and optionally installs hooks.

```bash
ctx init
ctx init --yes
ctx init --remote hf:user/project-context-cache
```

Should create:

```txt
.contextlock/
  config.json
  lock.json
  snapshots/
  prompts/
  audits/
  memory/
  index/
  cache/
  queue/
  logs/
```

## `ctx snapshot`

```bash
ctx snapshot
ctx snapshot --incremental
ctx snapshot --full
ctx snapshot --json
```

Behavior:

- scans repo,
- writes snapshot JSON,
- writes snapshot Markdown,
- updates lockfile.

## `ctx prompt`

```bash
ctx prompt onboarding
ctx prompt bugfix
ctx prompt review
ctx prompt refactor
ctx prompt audit
ctx prompt refresh --changed
ctx prompt refresh --all
```

Behavior:

- reads latest snapshot,
- compiles prompt markdown,
- writes metadata,
- avoids regeneration if snapshot hash is unchanged.

## `ctx audit`

```bash
ctx audit
ctx audit --since-last
ctx audit --from ctxsnap_old --to ctxsnap_new
ctx audit --pr
```

Behavior:

- compares snapshots,
- evaluates rule engine,
- detects stale prompts,
- writes JSON and Markdown reports.

## `ctx memory` (spec-20 — agent memory)

Append-only, drift-anchored memory. Entries live under `.contextlock/memory/`.

```bash
ctx memory add --type procedural "Onboarding needs a fresh snapshot" --relates README.md --relates src/main.ts
ctx memory list
ctx memory list --stale
ctx memory verify
ctx memory supersede <id> <new-id>
```

Behavior:

- `add` anchors the entry to the current snapshot hash and records `related_files`.
- `list --stale` surfaces entries whose anchored snapshot has since drifted (per the audit).
- `verify` reuses the drift auditor to flag stale entries deterministically.
- `supersede` links an old entry to its replacement without deleting history.

## `ctx code index` (spec-21 — code index artifact)

Builds a deterministic, per-file index anchored to the current snapshot.

```bash
ctx code index
ctx code index --format json
ctx code index --quiet
```

Behavior:

- walks tracked, non-binary, non-excluded files (reusing `walkFiles` + `DEFAULT_EXCLUDES`),
- writes `.contextlock/index/<snapshot_hash>.json` with path, language, classification, content hash, best-effort extracted symbols, redacted flag, and a stable content-addressed `doc_id`,
- prints a summary (file/symbol/redacted counts + determinism hash).

## `ctx site export --rag` (spec-19 — RAG ingestion bundle)

```bash
ctx site export --rag <dir>
ctx site export --rag <dir> --code
```

Behavior:

- emits a deterministic, secret-redacted, hash-versioned document bundle (`documents/<doc_id>.md` + `manifest.json`) from the current snapshot and memory entries,
- `--code` additionally appends one `source: "code"` document per indexed file (provenance via `related_files` + `anchor_hash`),
- the downstream RAG layer performs retrieval/embeddings; ContextLock only authors and governs the corpus.

## `ctx status`

Must be fast.

Example:

```txt
ContextLock status
Project: my-app
Branch: main
Commit: 9f02c1
Latest snapshot: ctxsnap_789
Working tree: dirty
Prompt cache: onboarding stale, review valid
Remote sync: 2 artifacts pending
Last drift score: 38/100
```

## Git hooks

### First hook to implement: post-commit

`.git/hooks/post-commit`:

```bash
#!/usr/bin/env bash
ctx snapshot --incremental --quiet
ctx audit --since-last --quiet
ctx prompt refresh --changed --quiet
ctx progress refresh --quiet
ctx site build --quiet
ctx sync --quiet
```

Important: default hooks should not block developer workflow.

### Later hooks

#### post-checkout

Runs after branch switch.

```bash
ctx snapshot --incremental --quiet
ctx audit --branch-drift --quiet
```

#### post-merge

Runs after merge.

```bash
ctx snapshot --full --quiet
ctx audit --merge-drift --quiet
ctx prompt refresh --changed --quiet
```

#### pre-push

Optional gate.

```bash
ctx audit --since-last
```

Can warn or fail based on config.

## Daemon design

The daemon should be optional in v1. Git hooks are simpler and more reliable.

When added, it should:

- watch file changes,
- debounce events,
- update dirty graph,
- enqueue snapshot/audit jobs,
- sync in background.

## Dirty graph

```json
{
  "dirty": true,
  "changed_files": [
    "src/auth/session.ts",
    "README.md"
  ],
  "affected_domains": ["auth", "docs"],
  "requires_full_snapshot": false,
  "stale_prompts": ["onboarding", "bugfix", "audit"]
}
```

## Automation lifecycle

```txt
ctx init
  ↓
install post-commit hook
  ↓
developer edits code
  ↓
developer commits
  ↓
snapshot generated
  ↓
audit generated
  ↓
prompt cache refreshed
  ↓
HTML onboarding site regenerated
  ↓
remote sync attempted
```

## Failure handling

Automation must be resilient:

- if snapshot fails, log error and exit 0 from non-blocking hooks,
- if sync fails, queue artifact for retry,
- if audit fails, preserve last valid snapshot,
- if config is invalid, show actionable error.

## CI integration

GitHub Actions command:

```yaml
name: ContextLock Audit
on: [pull_request]
jobs:
  contextlock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm install -g contextlock
      - run: ctx snapshot --ci
      - run: ctx audit --pr
```

## Autonomous operation target

After setup, a project should maintain its own AI context trail without humans manually updating docs or prompts.

The human should only intervene when:

- adding explicit architecture rules,
- resolving audit findings,
- approving suppressions,
- changing remote configuration.
