# 19 — RAG Ingestion Bundle (Deterministic, Redacted, Versioned)

## Goal
Give any RAG system (NVIDIA RAG Blueprint is the reference target) a higher-signal
ingestion corpus than the raw repo tree, derived entirely from ContextLock's existing
curated artifacts. ContextLock sits *upstream* of RAG: it authors and governs the corpus;
RAG performs retrieval and generation.

## Scope
This spec governs the export format and its generation. It does **not** add embeddings,
a vector store, or a chat server inside ContextLock. Retrieval stays in the RAG layer.

## Bundle layout
`ctx site export --rag <dir>` writes to `<dir>/`:
- `documents/<id>.md` — one Markdown doc per ingestible unit (snapshot sections, memory entries).
- `manifest.json` — array mapping each doc to:
  - `doc_id`, `source` (`snapshot` | `memory`),
  - `snapshot_hash` (the snapshot the bundle was built against),
  - `anchor_hash` (for memory docs, the hash the entry was written against),
  - `related_files` (grounding pointers),
  - `redacted`: boolean (secret redaction applied),
  - `title`, `chunk_hint` (optional soft guidance for downstream splitters).

## Generation rules
- Deterministic: identical snapshot + config + memory state => byte-identical `manifest.json`
  and sorted, normalized `documents/`. No timestamps inside doc bodies.
- Secret redaction: reuse `redactSecrets` from `src/scanner/markers.js` on every doc body
  before writing. Set `redacted: true` when any pattern fired.
- Normalization: LF line endings, trailing newline, sorted `documents/` by `doc_id`.
- **Determinism hash:** `bundle_determinism_hash` = sha256 of (sorted `documents/<id>.md` bytes
  concatenated with the normalized `manifest.json` *excluding* `generated_at`). Identical repo
  state => identical `bundle_determinism_hash`. Tests assert this, not raw byte equality of the
  timestamp field.
- Exclusion: respect existing `.contextlock/` exclusion rules; never export
  ignored or binary files.

## Metadata
Bundle `manifest.json` must include:
- `rag_bundle_version` (e.g. `1`),
- `generated_at` (ISO, for traceability only — excluded from determinism hash),
- `snapshot_hash`,
- `artifact_counts`.

## Command surface
Extends the existing `site export` command (`ctx site export <dir>`):
- `ctx site export --rag <dir>` — emit the ingestion bundle instead of (or alongside) the static site.
- No new runtime dependencies; reuses `snapshot` + `memory` (spec-20) readers.

## Validation
Fixture tests:
1. Same repo state => identical `bundle_determinism_hash` (determinism replay).
2. A fixture containing a synthetic secret => `redacted: true` and secret absent from docs.
3. Bundle omits files matched by exclusion rules.
4. Adding a memory entry changes only that entry's doc + manifest diff (no full rewrite churn).

## Testability / out-of-scope
This spec validates the **bundle** (format, determinism, redaction, exclusion), which is fully
testable in any environment with no GPU or `NGC_API_KEY`. The downstream NVIDIA RAG Blueprint
**ingestor adapter** (pushing the bundle into a live Blueprint deployment) is a separate,
environment-gated step: implement a skipped integration test that runs only when `NGC_API_KEY` is
present. Blueprint *serving* itself cannot be validated in this repo's CI and is out of scope.
