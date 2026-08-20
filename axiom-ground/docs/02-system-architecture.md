# 02 — System Architecture

## High-level architecture

```txt
Repo State
  │
  ▼
Scanner / Indexer
  │
  ├── File inventory
  ├── Manifest parser
  ├── Git analyzer
  ├── Dependency extractor
  ├── TODO/debt scanner
  ├── Docs/code contradiction scanner
  │
  ▼
Snapshot Compiler
  │
  ├── snapshot.json
  ├── snapshot.md
  ├── lock.json
  │
  ├──────────────┐
  ▼              ▼
Prompt Compiler  Drift Auditor
  │              │
  ▼              ▼
prompts/*       audits/*
  │              │
  └──────┬───────┘
         ▼
HTML Site Generator
         │
         ▼
Local Artifact Store
  │
  ├── memory/*        (agent memory — spec-20)
  ├── index/*         (code index — spec-21)
  │
  ▼
RAG Ingestion Bundle (spec-19)  ──► downstream RAG layer (embeddings/vector store out of scope)
         │
         ▼
Remote Backend: Hugging Face / later S3 / GitHub / R2
```

> **Boundary note:** ContextLock is the *authoring/governance* layer for retrieval context. It produces
> deterministic, redacted, provenance-bearing artifacts (memory, code index, RAG bundle). Embeddings,
> tokenization, chunking strategy, and the vector store remain in the downstream RAG layer.

## Main modules

### 1. CLI

Primary command surface:

```bash
ctx init
ctx snapshot
ctx prompt onboarding
ctx audit
ctx memory add|list|verify|supersede
ctx code index
ctx site export --rag <dir> [--code]
ctx sync
ctx daemon start
```

The CLI should be the first interface. Avoid building UI too early.

### 2. Scanner / Indexer

Extracts raw facts from a repo.

Responsibilities:

- file tree inventory,
- language detection,
- package manifest detection,
- test/build command detection,
- README/docs detection,
- git branch/commit metadata,
- recent diff extraction,
- TODO/FIXME/HACK extraction,
- large/generated/vendor file exclusion.

### 3. Snapshot Compiler

Turns raw facts into stable context artifacts.

Outputs:

```txt
.contextlock/snapshots/{snapshot_hash}.json
.contextlock/snapshots/{snapshot_hash}.md
.contextlock/lock.json
```

The compiler must separate:

- machine facts,
- inferred summaries,
- human annotations,
- volatile git state.

### 4. Prompt Compiler

Generates reusable prompt packs tied to a snapshot hash.

Prompt types:

- onboarding,
- bugfix,
- code review,
- refactor,
- audit,
- test generation,
- release prep.

Each prompt includes metadata:

- snapshot hash,
- source commit,
- relevant files,
- assumptions,
- constraints,
- expected response format.

### 5. Drift Auditor

Compares current repo state against previous snapshots and project rules.

Detects:

- docs/code contradiction,
- changed architecture boundaries,
- new untested behavior,
- dependency drift,
- duplicate concepts,
- naming convention drift,
- dead commands,
- stale prompts.

The auditor is also reused by `ctx memory verify` (spec-20) to flag stale, drift-anchored memory entries.

### 6. HTML Site Generator

Generates a static, human-readable developer onboarding site from snapshot, prompt, audit, and claim artifacts.

Outputs:

```txt
.contextlock/site/index.html
.contextlock/site/snapshot.html
.contextlock/site/architecture.html
.contextlock/site/prompts.html
.contextlock/site/audit.html
.contextlock/site/claims.html
.contextlock/site/progress.html
.contextlock/site/plans.html
```

This layer is critical for trust and onboarding. Developers should be able to inspect ContextLock output without reading raw JSON.

### 7. Automation Layer

After `ctx init`, automation should be driven by:

- Git hooks,
- background daemon,
- CI jobs,
- scheduled audit runs.

### 8. Artifact Store

Local artifact store lives in `.contextlock/`.

```txt
.contextlock/
  config.json
  lock.json
  snapshots/
  prompts/
  audits/
  memory/        # agent memory entries (spec-20)
  index/         # code index artifacts (spec-21)
  site/
  cache/
  queue/
  logs/
```

Remote artifact store initially supports Hugging Face.

### 9. RAG Ingestion / Memory / Code Index

An additive, dependency-free layer that sits *upstream* of RAG retrieval (see spec-19/20/21):

- **Memory store (spec-20):** append-only, snapshot-anchored memory entries under `.contextlock/memory/`. `verify` reuses the drift auditor to flag staleness; `supersede` links replacements without mutating history.
- **Code index (spec-21):** deterministic per-file index under `.contextlock/index/<snapshot_hash>.json` — path, language, classification, content hash, best-effort extracted symbols, redaction flag, and a stable content-addressed `doc_id` plus an `index_determinism_hash`.
- **RAG ingestion bundle (spec-19):** `ctx site export --rag <dir>` compiles a normalized, redacted, hash-versioned document bundle (snapshot sections + memory entries, optionally + code-index docs via `--code`) for any RAG system.

All three are metadata/provenance only — no embeddings, tokenization, chunking, or vector store.

## Repository structure inside a target project

```txt
.contextlock/
  config.json
  lock.json
  snapshots/
  prompts/
  audits/
  memory/
  index/
  site/
  cache/
  queue/
  logs/
```

## Internal implementation package structure

Current implementation structure:

```txt
src/
  cli/
  scanner/
  snapshot/
  prompts/
  audit/
  site/
  storage/
  daemon/
  utils/
  memory/      # agent memory (spec-20)
  export/      # RAG ingestion bundle (spec-19)
  codeindex/   # code index artifact (spec-21)
```

## Technical recommendation

Use a language/runtime that can ship an easy CLI and parse many ecosystems. Good candidates:

- TypeScript/Node for fast CLI distribution through npm,
- Python for ecosystem parsing and AI tooling,
- Rust later for fast scanning.

Recommended v1: **TypeScript CLI** with JSON artifacts. Add Python/Rust workers only if needed.

## Avoid early traps

Do not start with:

- full semantic code understanding,
- vector databases,
- complex agent orchestration,
- web dashboard,
- universal planning,
- deep AST support for every language.

Start with deterministic extraction, clear artifacts, and excellent diffs.
