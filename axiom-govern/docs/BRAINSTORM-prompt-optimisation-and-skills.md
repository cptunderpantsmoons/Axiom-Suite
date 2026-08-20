 # Brainstorm — Prompt Optimisation & Skill Creation

Status: Discovery (brainstorm only, no implementation). Produced 2026-08-16 by an
orchestrated 4-agent team (Prompt Engineer, Product Manager, Software Architect,
UX Architect), grounded in the actual codebase.

## Ground truth (what the code already tells us)

1. **The optimizer is a dormant, actively-harmful stub.** `internal/components/optimizer/optimizer.go`
   `DefaultCompressor` does `strings.ToLower(prompt)` (destroys case-sensitive
   meaning: code, acronyms, identifiers) and `strings.ReplaceAll` filler removal
   (substring-level, can corrupt tokens mid-word). It is wired in bootstrap in
   `shadow mode` but **never invoked** in the proxy request path.
2. **"Skill" does not exist.** No user-defined skill/template concept; only the
   MCP proxy's hardcoded `chat_completion` tool.
3. **The pipeline is ordered** (auth → guardian → budget → router → provider) and
   the proxy's three handlers duplicate the same `resolve → select → budget →
   call → record` prefix — a natural single integration point.
4. **Reusable precedents exist:** `providers.Registry` (atomic hot-reload),
   `config.RuntimeStore` (file + Watch + secret-preserving merge), `policy.FileLoader`
   (hot-reloadable rules), and the dashboard CRUD pattern (`handlers_policies.go`).

## The one strategic decision

**Prompt optimisation should be a property of *skills*, not a standalone global
gateway transform.** Structural cost reduction (a fixed system prompt + bounded
template) is where durable, low-risk savings live; post-hoc lossy compression of
free-form traffic is high-risk and low-ceiling. So: build **Skills first**, then
make **optimisation a skill-scoped, shadow-first, opt-in** feature.

## Feature 1 — Prompt optimisation

Reframe "optimisation" as *prompt transformation*, lossless-first:

| Order | Technique | Value | Risk |
|-------|-----------|-------|------|
| 1 | Prefix stabilisation + system-prompt templating (exposes provider prefix-cache) | free 10–70% cost/latency | ~zero |
| 2 | Deterministic context pruning (drop oldest turns; keep system + current turn) | medium | low |
| 3 | LLM summarisation (cheap model compresses long context) | high | high (drift) |

**Pipeline placement (non-negotiable):** guardian sees the ORIGINAL; optimizer
runs AFTER guardian and BEFORE `enforceBudget`/routing, so the budget estimate
matches what is actually billed. Gate the LLM summariser behind the budget gate.

**Safety/gating:** default shadow-mode; per-team/per-model/per-skill opt-in with
technique granularity; entity/number/constraint invariance checks; byte-identical
fallback to original on any non-clean pass.

**Fix first:** delete the lowercase/filler `DefaultCompressor`; replace with a
lossless normaliser (whitespace + boundary-aware filler removal). This is a
correctness bug, not a feature.

**Metrics:** `harness_optimizer_*` (applied/fallback/tokens_saved/compaction_ratio/
llm_optimizer_cost+duration), plus a "would-have-saved" shadow counter so savings
are provable before flipping to apply.

## Feature 2 — Skills

**Definition:** a named, versioned, reusable prompt contract (system instructions +
templated body with typed `{{slots}}` + declared parameters + owner/permissions).

**Model** (`internal/core/models/skill.go`): `Skill{Name, Version, SystemPrompt,
Template, Parameters[], Owner, Permissions{Public,Teams,Users,MinRole}, Deprecated,
timestamps}`; versioned as `SkillSet` (active per name) + `SkillVersions` (history).

**Invocation:** `ChatRequest` gains `skill` ("summarize@1.2.0") + `skill_params`;
the pipeline expands + validates, then strips both before upstream. Unknown
name/version → 400 (never silent fallback).

**Integration:** new `internal/components/skills/` component mirroring
`providers.Registry` (in-memory atomic) + `RuntimeStore`/`policy.FileLoader`
(file `configs/skills.json` + Watch). New admin routes modeled on
`handlers_policies.go`: `GET/POST /api/v1/skills`, `PUT /api/v1/skills/{name}`
(immutable new version), `activate`/`rollback`, `DELETE` (deprecate). Policy engine
gains a `skill`/`skill_owner` condition so rules can gate skill use centrally.

**Resolution order in pipeline:**
```
guardian(ORIGINAL) -> skill resolve+expand -> guardian re-scan(final, cheap)
   -> optimize(user-role messages only) -> selectProvider + budget + upstream
```

**Top risk — prompt injection via skill params:** treat param values as untrusted
user input. Mitigations: strict regex interpolator (declared slots only, type/
required/enum/length), guardian re-scan of the expanded prompt, policy gating.
Also: secret-scan templates at save; mask secrets in the dashboard; render keys 0600.

## Recommended build order (MVP)

1. Fix/replace the unsafe `DefaultCompressor` (lossless normaliser). [correctness]
2. **Skills MVP** — model + file store + registry + resolver/expand + admin CRUD +
   dashboard Library/Editor (create → publish; one active version; invocation via
   `skill`+`skill_params`; per-skill audit/metering). [the larger, more defensible value]
3. Collapse the three duplicate handler preambles into a shared `Pipeline.Prepare`.
4. **Optimisation as skill-scoped, shadow-first, opt-in** annotation + telemetry.
5. Later: version diffing/rollback UI, cross-org sharing, auto-skill selection, LLM summariser.

## Open questions before implementation

1. Skill propagation across replicas: shared file volume vs. Redis-backed store?
2. Real compressor: internal rule-based vs. external-model call (adds a secondary LLM + its own cost/auth)?
3. Guardian re-scan default: block (403) vs. strip the offending param?
4. Permission source of truth: skill-level Permissions vs. policy rules vs. both (recommend both)?

## UX (from the UX Architect)

Two new rail pages: **Skills** (Library/Editor, beside Policies) and
**Optimisation** (master switch + team/model scope table + 3-number telemetry),
role-aware nav (downstream users get a read-only Skills *catalog* with
playground/snippet). Skill editor = full-width form with auto `{{slot}}` detection
+ live preview/test (rendered prompt, token & cost estimate). Everything reuses the
existing panel/table/badge/modal design language; no new primitives.
