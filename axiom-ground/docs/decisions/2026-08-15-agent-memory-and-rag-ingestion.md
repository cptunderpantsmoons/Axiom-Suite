# Agent Memory + RAG Ingestion Bundle

## Context/problem

ContextLock today is a deterministic *project-state* compiler (snapshot, prompt cache, drift
audit) for AI coding agents. It captures what the repo *is*, but not what the agent *decided,
learned, or was told*. Separately, the user wants RAG value without the usual rot: embedding-only
memory and raw-repo RAG ingest both suffer from stale, unprovenanced, sometimes secret-leaking
content. No NVIDIA RAG Blueprint checkout or `NGC_API_KEY` exists in this environment, so a
full Blueprint deployment is out of scope here.

## Decision

Extend ContextLock into a **drift-grounded, repo-anchored agent memory system** that sits
*upstream* of RAG, and add a deterministic, secret-redacted, versioned **RAG ingestion bundle**
export. Two coupled specs:

- `spec-19` — `ctx site export --rag` emits a normalized, redacted, hash-versioned document bundle
  (snapshot + memory) consumable by NVIDIA RAG Blueprint (reference) or any RAG.
- `spec-20` — `ctx memory add|list|verify|supersede` authors append-only memory entries anchored
  to a snapshot hash; `verify` reuses the drift audit to flag stale entries automatically.

Retrieval/embeddings/vector store stay outside ContextLock (in the RAG layer). ContextLock
remains dependency-free, deterministic, and the *governance* layer.

## Alternatives considered

- **Build chat-RAG inside ContextLock (`ctx ask`).** Rejected: duplicates the prompt-cache's
  purpose, forces embeddings + a vector store into a deliberately zero-dependency tool, and
  erodes the deterministic identity. Feature creep with negative ROI.
- **Full NVIDIA RAG Blueprint bridge (deploy + serve).** Rejected for now: requires a Blueprint
  checkout + `NGC_API_KEY` absent here; unbuildable/untestable. The adapter half is covered by
  spec-19's bundle, which any future Blueprint deployment can ingest.
- **Generic vector memory (mem0-style).** Rejected as the core: no provenance, no validity
  signal, memories rot silently. ContextLock's value is specifically the drift-anchoring.

## Compatibility impact

No change to existing commands or artifacts. Adds a `memory` subcommand and a `--rag` flag to the
existing `ctx site export` command. New artifact dirs (`.contextlock/memory/`, export bundle) are additive
and ignored by current scanners via existing exclusion rules. Bumps no existing version field;
introduces `rag_bundle_version` (spec-19) and memory `schema_version` (spec-20).

## Migration plan

1. Land `spec-19` export (low risk, read-only over existing artifacts).
2. Land `spec-20` memory store + `verify` (reuses snapshot + audit engines).
3. Wire memory docs into the spec-19 bundle.
4. Add fixture tests for determinism, redaction, and staleness per each spec's Validation section.

## Rollback plan

Both features are additive and behind new commands/flags. Removing `src/memory/` and the `--rag`
branch of `export` (plus the two spec files and this record) fully reverts with no effect on
`init/snapshot/prompt/audit/site`. Existing snapshots and prompts are untouched.

## Addendum — Code Index Artifact (spec-21)

The coarse section-level chunking of `spec-19` left a granularity gap: the RAG layer could not
retrieve at file/symbol level. Decision: add a **dependency-free, deterministic code-index artifact**
(`spec-21`) inside ContextLock that emits per-file metadata (path, language, classification,
content hash, best-effort extracted symbols, redaction flag, stable content-addressed `doc_id`, and
a deterministic `index_determinism_hash`). It is metadata + provenance only — embeddings, tokenization,
chunking strategy, and the vector store remain in the downstream RAG layer. Exposed via
`ctx code index` and, opt-in, via `ctx site export --rag <dir> --code` which appends one
`source: "code"` document per indexed file to the bundle. This keeps ContextLock's zero-dependency,
deterministic, governance-layer identity intact while closing the retrieval-granularity gap.

