# ContextLock Project Plan

ContextLock is a reproducible context layer for AI-assisted software projects. It snapshots a repository's technical reality, compiles AI-ready prompt packs from that snapshot, audits future work for architectural/context drift, and stores versioned artifacts locally or in remote storage such as Hugging Face.

## One-line positioning

**Git for AI project context: reproducible snapshots, prompt cache, and drift audits for AI coding agents.**

## Core product triangle

1. **Project Snapshot Compiler** — derives a stable, diffable project map from repo state.
2. **Prompt Cache** — compiles reusable prompts tied to exact snapshot hashes.
3. **Drift Auditing** — detects where code, docs, tests, and architecture have diverged.

Everything else is secondary until these three are working reliably.

### Extended capabilities (built on the triangle)

ContextLock also acts as the **governance/authoring layer upstream of retrieval-augmented generation (RAG)**, remaining dependency-free and deterministic:

- **Agent memory (`spec-20`)** — `ctx memory add|list|verify|supersede` authors append-only, drift-anchored memory entries; `verify` reuses the drift audit to auto-flag stale memories.
- **RAG ingestion bundle (`spec-19`)** — `ctx site export --rag <dir>` emits a deterministic, secret-redacted, hash-versioned document bundle (snapshot sections + memory) for any RAG system.
- **Code index artifact (`spec-21`)** — `ctx code index` emits a deterministic, per-file index (language, classification, content hash, extracted symbols, stable `doc_id`) so the RAG layer can retrieve at file/symbol granularity.

Embeddings, tokenization, chunking, and vector storage stay in the downstream RAG layer — never inside ContextLock.

## Documentation map

- [`docs/01-product-vision.md`](docs/01-product-vision.md)
- [`docs/02-system-architecture.md`](docs/02-system-architecture.md)
- [`docs/03-development-roadmap.md`](docs/03-development-roadmap.md)
- [`docs/04-data-models.md`](docs/04-data-models.md)
- [`docs/05-cli-and-automation.md`](docs/05-cli-and-automation.md)
- [`docs/06-hugging-face-storage.md`](docs/06-hugging-face-storage.md)
- [`docs/07-drift-auditing.md`](docs/07-drift-auditing.md)
- [`docs/08-elevation-opportunities.md`](docs/08-elevation-opportunities.md)
- [`docs/09-human-readable-html-layer.md`](docs/09-human-readable-html-layer.md)
- [`docs/10-build-task-list-and-quality-gates.md`](docs/10-build-task-list-and-quality-gates.md)
- [`docs/11-remediation-backlog-and-hardening.md`](docs/11-remediation-backlog-and-hardening.md)
- `ctx context export --format json` — curated `GroundContext v1` for Axiom Compile; never exposes raw `.contextlock/config.json` or `lock.json`.

### Pre-implementation specification set (must-read before coding)

These specs define deterministic behavior for core reliability and retrieval boundaries and are mandatory inputs for implementation and review. Specs 11–18 cover the snapshot/audit/guardrail core; specs 19–21 cover the RAG ingestion, agent-memory, and code-index layer.

- [`docs/specs/11-snapshot-canonicalization-and-hash.md`](docs/specs/11-snapshot-canonicalization-and-hash.md)
- [`docs/specs/12-file-classification-and-exclusion.md`](docs/specs/12-file-classification-and-exclusion.md)
- [`docs/specs/13-secret-scanning-policy.md`](docs/specs/13-secret-scanning-policy.md)
- [`docs/specs/14-audit-scoring-versioning.md`](docs/specs/14-audit-scoring-versioning.md)
- [`docs/specs/15-incremental-snapshot-invalidation.md`](docs/specs/15-incremental-snapshot-invalidation.md)
- [`docs/specs/16-alpha-ecosystem-support-boundary.md`](docs/specs/16-alpha-ecosystem-support-boundary.md)
- [`docs/specs/17-ai-change-guardrails.md`](docs/specs/17-ai-change-guardrails.md)
- [`docs/specs/18-guardrail-ci-checklist.md`](docs/specs/18-guardrail-ci-checklist.md)
- [`docs/specs/19-rag-ingestion-bundle.md`](docs/specs/19-rag-ingestion-bundle.md)
- [`docs/specs/20-agent-memory-model.md`](docs/specs/20-agent-memory-model.md)
- [`docs/specs/21-code-index-artifact.md`](docs/specs/21-code-index-artifact.md)

## Spec compliance policy (anti-drift)

ContextLock must be built to spec by default. Any intentional divergence must be explicit, reviewed, and documented.

### Non-negotiable policy

1. **No silent behavior drift**: implementation behavior must match written spec.
2. **Spec-first changes**: if behavior changes intentionally, update spec first (or in same PR) before merge.
3. **Versioned changes only**: changes affecting deterministic outputs must bump the relevant version field (`hash_spec_version`, `scoring_version`, schema version, etc.).
4. **Evidence in PRs**: every behavior-changing PR must include fixture outputs before/after.
5. **No hidden widening of scope**: ecosystem support changes must update the support boundary spec.

### Required PR checklist for behavior changes

- [ ] Which spec file(s) are affected?
- [ ] Is this a bug fix to match existing spec, or an intentional spec change?
- [ ] If intentional, what version field is bumped?
- [ ] Which fixture tests prove expected behavior?
- [ ] Are artifact diffs deterministic across repeated runs?
- [ ] Are security/privacy guarantees unchanged or improved?

### Decision record requirement

For intentional spec changes, add a short record under `docs/decisions/`:

- context/problem,
- decision,
- alternatives considered,
- compatibility impact,
- migration plan,
- rollback plan.

If there is no decision record for a behavior change, it should be treated as drift.

## Planning/progress artifacts (AI + HTML)

- Machine-readable progress model: [`docs/planning/contextlock-progress.json`](docs/planning/contextlock-progress.json)
- HTML visual template (driven by JSON): [`docs/planning/progress-page.template.html`](docs/planning/progress-page.template.html)

Use the JSON as the source of truth for implementation state, phase gates, and guardrail enforcement mode.

## Recommended MVP promise

```bash
# One command to rule them all:
ctx bootstrap
```

This single command initializes ContextLock, generates a project snapshot, compiles an AI onboarding prompt, builds a dashboard site, and opens it in your browser. That's it.

```bash
# Check your project health anytime:
ctx doctor
```

The first shippable version should promise:

> In under one minute, generate a reliable AI onboarding packet and a transparent, configurable drift-score heuristic for any software repo, then cache them as versioned artifacts.

## Development workflow

```bash
# First-time setup:
npm run setup

# Daily development:
npm run check          # lint + test (pre-push gate)
npm test               # run tests
npm run lint           # check code quality
npm run lint:fix       # auto-fix whitespace/newline issues
npm run test:watch     # tests in watch mode

# Install git hooks for automated quality gates:
ctx hooks install      # pre-commit: lint + test, post-commit: context refresh
ctx hooks uninstall    # remove managed hooks

# CI runs automatically on push/PR:
#   - Tests (Node 20 + 22)
#   - Lint
#   - Determinism replay
#   - Performance benchmarks
#   - Secret scan
#   - ContextLock guardrails
```
