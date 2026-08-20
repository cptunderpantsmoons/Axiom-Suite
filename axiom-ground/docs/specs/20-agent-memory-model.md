# 20 — Agent Memory Model (Drift-Grounded, Repo-Anchored)

## Goal
Extend ContextLock from a *project-state* compiler into a *verifiable agent memory* layer.
A memory entry is valid only while the snapshot it was anchored against still matches the
repo; when code drifts, the entry is auto-flagged `stale` instead of silently rotting.
This is the novel differentiator vs. embedding-only memory (mem0 / knowledge-graph): every
memory carries provenance and a built-in validity signal.

## Memory entry model
Stored under `.contextlock/memory/<id>.json`, append-only:
- `id` — stable identifier.
- `type` — `episodic | semantic | procedural | decision`.
- `content` — free text / Markdown.
- `anchor_hash` — snapshot hash at write time (grounds the entry in repo reality).
- `related_files` — array of repo paths the entry depends on (precise provenance).
- `created_at` — ISO timestamp.
- `superseded_by` — `id | null` (never delete; mark superseded).
- `schema_version` — `1`.

## Storage & addressing
- Append-only JSON files; updates create a new `superseded_by` link, never mutate history.
- `id` is content-addressed as `hash(normalized_content + sorted(related_files))` for
  deterministic de-duplication of the same fact recorded across different snapshots.
  `anchor_hash` is stored separately and does NOT participate in the `id`.

## Anchoring & provenance
- `ctx memory add` captures the current snapshot hash as `anchor_hash` and records
  `related_files` from the `--relates` flags.
- Entries are meaningless without their anchor; export (spec-19) carries `anchor_hash` so the
  RAG layer can show provenance alongside retrieved text.

## Staleness (reuse drift audit)
- `ctx memory verify` calls `buildAuditFindings(root, anchorSnapshot, currentSnapshot, config)`
  (existing audit engine; `chooseAuditPair` already supports `--from <anchor_hash>`) to compare
  the entry's anchored snapshot against the current one.
- **Staleness rule (threshold):** an entry is `stale` iff the audit yields >=1 finding where
  (a) the finding's affected paths intersect the entry's `related_files`, and
  (b) `severity >= MEMORY_STALE_MIN_SEVERITY` (`medium`; low-severity/cosmetic findings do NOT
  trigger staleness). `MEMORY_STALE_MIN_SEVERITY` is configurable in project config.
- Stale entries are flagged, preserved, and excluded from the "fresh" set — not deleted.
- `ctx memory list --stale` surfaces only flagged entries.

## Lifecycle
- `ctx memory add --type <t> "<content>" --relates <file> [--relates <file>]` — anchors to
  current snapshot.
- `ctx memory list [--stale]` — lists entries; `--stale` filters by drift flag.
- `ctx memory verify` — runs audit, marks stale (idempotent, deterministic).
- `ctx memory supersede <id> <new-id>` — links old entry to its replacement.

## Secret policy
All `content` is passed through `redactSecrets` (from `src/scanner/markers.js`) before write.
Redaction failures block the write with the standard ContextLock error format.

## Self-ingestion guard
The memory store lives under `.contextlock/memory/`, which is already covered by
`DEFAULT_EXCLUDES` (`.contextlock/**`) in `src/scanner/core.js`. Memory files are therefore never
scanned into a snapshot and never recursively ingested. No additional exclusion logic required.

## Composition with spec-19
Memory entries are first-class documents in the RAG ingestion bundle. `ctx site export --rag`
includes `memory/*.json` (rendered to Markdown) alongside `snapshot.md`, all hash-versioned
and redacted. RAG retrieves; ContextLock's `stale` flag tells the agent which retrieved
memories are no longer trustworthy before it acts.

## Versioning
- Memory schema or staleness-threshold change => bump `schema_version`.
- Historical entries are never rewritten in place; migration via `superseded_by`.

## Validation
Fixture tests:
1. `memory add` with a known repo state => deterministic `id` and `anchor_hash`.
2. A memory whose `related_files` later changes => flagged `stale` by `verify`.
3. Synthetic secret in `content` => redacted on write, blocked if redaction impossible.
4. `export --rag` includes the memory doc with correct `anchor_hash` and `redacted` flag.
5. Append-only: `supersede` leaves the original file intact with a `superseded_by` link.
