# 21 — Code Index Artifact (Dependency-Free, Retrieval-Ready)

## Goal
Give the downstream RAG layer **fine-grained, provenance-bearing retrieval units** without pulling
embeddings, AST libraries, or a vector store into ContextLock. Today the RAG bundle (`spec-19`) only
chunks the snapshot markdown at the section level, so retrieval is coarse (whole-project overview,
commands, debt). `spec-21` emits a deterministic, hash-versioned **code index** of every tracked file
— path, language, classification, content hash, extracted symbols, and a stable `doc_id` — that the
RAG layer can chunk/embed at file (and symbol) granularity. The index stays inside ContextLock's
governance boundary: it is metadata + provenance only, never embeddings.

## Scope boundary
- **In scope (ContextLock):** walking tracked files (reusing `walkFiles` + `DEFAULT_EXCLUDES`),
  per-file language/classification, content hash, lightweight best-effort **symbol extraction** via
  regex per language, secret redaction of indexed text, deterministic `doc_id`, and a deterministic
  `index_determinism_hash`.
- **Out of scope (RAG layer):** tokenization, embeddings, chunking strategy, vector store, ranking.
  The RAG layer reads the index (by `doc_id`/`path`) and applies its own embedding pipeline.

## Artifact model
Written to `.contextlock/index/<snapshot_hash>.json`:
- `schema_version` — `1`.
- `artifact_type` — `"code_index"`.
- `code_index_version` — `1`.
- `snapshot_hash` — the anchor snapshot the index was built against.
- `generated_at` — ISO timestamp (excluded from the determinism hash).
- `index_determinism_hash` — sha256 over sorted `(doc_id, path, content_hash, classification,
  symbols)` tuples; identical repo state ⇒ identical hash.
- `files[]` — one entry per tracked, non-binary, non-excluded file:
  - `doc_id` — `f-<sha256(posix_path + "\0" + content_hash)[:16]>` (content-addressed; stable
    across runs for the same file content, so the RAG layer can cache/invalidate embeddings by it).
  - `path` — posix repo-relative path.
  - `language` — from `detectLanguage`.
  - `classification` — from `classifyFile` (`source | test | docs | config | binary`).
  - `content_hash` — normalized-text sha256 (normalized via `normalizeTextContent` in `src/scanner/content.js`, then hashed with `sha256` from `src/utils/core.js`).
  - `size_bytes`.
  - `redacted` — `true` if `redactSecrets` removed anything from the file text.
  - `symbols[]` — best-effort `[{ name, kind, line }]`; empty if none/unsupported language.
- `artifact_counts` — `{ files, symbols, redacted }`.

Binary files and excluded paths (per `DEFAULT_EXCLUDES`, which already covers `.contextlock/**`)
are omitted. Symbol extraction never throws; parse errors yield an empty `symbols` list for that file.

## Symbol extraction (lightweight, per-language regex)
Best-effort, language-keyed, line-numbered:
- `javascript` / `typescript`: `function NAME`, `async function NAME`, `const|let|var NAME =`,
  `class NAME`, method `NAME(` inside a class body.
- `python`: `def NAME`, `async def NAME`, `class NAME`.
- `go`: `func NAME`, `func (...) NAME`, `type NAME struct`.
- `rust`: `fn NAME`, `struct NAME`, `enum NAME`, `trait NAME`, `impl NAME`.
All other languages: no symbols (empty list). Extraction is forgiving: malformed matches are skipped.

## Secret policy
Indexed file text passes through `redactSecrets` (from `src/scanner/markers.js`). A `redacted: true`
flag is recorded per file; the RAG bundle (`spec-19`) carries the redacted text for code docs.

## Self-ingestion guard
The index lives under `.contextlock/index/`, already covered by `DEFAULT_EXCLUDES` (`.contextlock/**`),
so index files are never re-scanned into a snapshot or recursively indexed.

## CLI surface
- `ctx code index` — builds and writes `.contextlock/index/<snapshot_hash>.json`; prints a summary
  (file count, symbol count, redacted count, determinism hash).
- `ctx site export --rag <dir> --code` — extends the `spec-19` bundle to also emit one
  `source: "code"` document per indexed file (redacted text, `doc_id` = `code-<file_doc_id>`,
  `related_files` = `[path]`, `anchor_hash`/`snapshot_hash` = the snapshot). The `--code` flag is
  opt-in so the existing `spec-19` bundle shape (no `--code`) is unchanged and still deterministic.

## Determinism
- `doc_id` is a pure function of `(path, content_hash)` ⇒ stable and reproducible.
- `index_determinism_hash` excludes `generated_at` and file ordering (sorted tuples), so two runs
  over the same repo yield the same hash.
- Adding a `redacted` flag does not change the hash (it is derived deterministically from content).

## Versioning
- Code-index schema change ⇒ bump `code_index_version`.
- Historical index files are never rewritten; a new file is written per snapshot anchor.

## Validation
Fixture tests:
1. `ctx code index` writes `.contextlock/index/<snapshot_hash>.json` with deterministic `doc_id` and
   `content_hash` for a known file.
2. Identical repo state ⇒ identical `index_determinism_hash` across two runs.
3. A JS file with a function ⇒ at least one symbol extracted (`kind: "function"`).
4. `ctx site export --rag <dir> --code` includes one `source: "code"` doc per indexed non-binary
   file, each with `related_files` = `[path]`, `anchor_hash`, and a `redacted` flag.
5. A file containing a synthetic secret ⇒ `redacted: true` and the raw secret absent from the
   code doc body in the `--code` RAG export.
