# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `ctx bootstrap` and `ctx doctor` one-command MVP (init → snapshot → prompt → site) with zero-side-effect health diagnostics.
- CI automation: PR audit, GitHub Actions matrix (Node 20 + 22), lint, determinism replay, perf benchmarks, secret scan, and ContextLock guardrails.
- `ctx hooks install` / `ctx hooks uninstall` for pre-commit (lint + test) and post-commit (context refresh) quality gates.
- Planning engine (Build 11) and `progress.html` site widget driven by `docs/planning/contextlock-progress.json`.
- Architecture rules engine with suppressions (Build 10).
- **Agent memory** (`spec-20`): `ctx memory add|list|verify|supersede` authors append-only, drift-anchored memory entries under `.contextlock/memory/`. `verify` reuses the drift audit to auto-flag stale entries; `supersede` links replacements without deleting history.
- **RAG ingestion bundle** (`spec-19`): `ctx site export --rag <dir>` emits a deterministic, secret-redacted, versioned document bundle (snapshot sections + memory entries) consumable by NVIDIA RAG Blueprint (reference) or any RAG layer. Includes `bundle_determinism_hash` and a `manifest.json`.
- **Code index artifact** (`spec-21`): `ctx code index` writes a dependency-free, deterministic per-file index (`.contextlock/index/<snapshot_hash>.json`) with language, classification, content hash, best-effort extracted symbols, redaction flag, and a stable content-addressed `doc_id`; `ctx site export --rag <dir> --code` optionally appends one provenance-bearing `source: "code"` document per indexed file to the bundle.
- **Plan quality gates + detailed tasks**: every `ctx plan` artifact now carries a global `quality_gates` list (whole-plan definition of done) and each task embeds its own `quality_gates` (named, command-backed checkpoints) plus granular `steps`. `ctx audit --against-plan` flags any task that lacks gates or detailed steps, and the plan markdown renders gates and steps as checklists.
- **`plans.html` site page**: the static site now renders every generated plan's plan-level and task-level quality gates plus detailed task steps, with interactive checkboxes that persist checked-off gates in `localStorage` (`assets/contextlock.js`) and a live per-plan gate-completion counter and filling progress bar that update as checkboxes toggle, a per-plan reset button, and per-plan anchor links from the summary table; the site hash incorporates plan signatures so the site rebuilds when plans change.
- **`ctx progress` command**: mark spec/build/guardrail status in `docs/planning/contextlock-progress.json` from the CLI (`ctx progress set spec <id> <status>` / `ctx progress set build <id> <status>` / `ctx progress set guardrail <active|planned> <name> <status>`, plus `ctx progress [--format json]` for a summary), validating spec/build statuses against the ledger's `status_scale` and guardrail statuses against pass/fail/warn instead of hand-editing.
- **Plan-audit write-back**: `ctx audit --against-plan <id>` now records verified gate results into `docs/planning/contextlock-progress.json` automatically — a `plan_audits` entry with per-task `gates_verified` results and an `on_track` verdict — so a verified plan is captured in the version-controlled ledger without a separate step.
- **Planning progress schema**: `schemas/planning-progress.schema.json` validates `docs/planning/contextlock-progress.json` — spec/build statuses must be in the ledger's `status_scale`, guardrail statuses must be pass/fail/warn, and `plan_audits` entries are structurally checked; `npm run lint` enforces it, so invalid statuses/ids fail CI.
- **Config/lock schema validation**: `schemas/config.schema.json` and `schemas/lock.schema.json` now validate `.contextlock/config.json` and `.contextlock/lock.json` on every write. All writes go through `writeConfigJson`/`writeLockJson` (`ctx init`, `ctx bootstrap`, `ctx snapshot`, `ctx site`, `ctx audit`, `ctx prompt`, `ctx remote add`, `ctx pull`, and CI base snapshots), so a config missing `project_id` or a lock with an invalid `latest_drift_score`/`project_id` is rejected before it persists.

### Changed
- Plan artifacts bumped to `schema_version: 2` to add `quality_gates` (plan- and task-level) and task `steps`; the plan generator was split into focused modules (`gates.js`, `tasks.js`, `feature.js`, `refactor.js`, `release.js`).
- Scanner decomposed into focused submodules (`core.js`, `content.js`, `manifests.js`, `markers.js`) via a re-export barrel, preserving the public API surface.
- `docs/planning/contextlock-progress.json` refreshed to reflect validated spec and guardrail status (specs 19–21 and Builds 12–13 validated).
- Decomposed the monolithic `src/cli/app.js` (~774 → ~190 lines) into a thin command router plus `src/cli/commands/{init,status,snapshot,prompt,audit,site,memory,code}.js` handlers and `src/cli/help.js`/`src/cli/shared.js` helpers; `scripts/lint.js` now fails the build on files exceeding the line limit (previously a warning), preventing `app.js` from regressing past 600 lines.
- Snapshot `security` object (`redaction_count`, `sensitive_paths_skipped`) is now declared in `schemas/snapshot.schema.json` and validated; it is no longer attached via a non-enumerable property.
- Audit artifact now records `scoring_model: "weighted_heuristic"` (validated by `schemas/audit.schema.json`); README/MVP wording clarifies the drift score is a transparent, configurable heuristic, not a measurement.

### Fixed
- Static site nav now highlights the active page on every page instead of always marking Dashboard as active.
- Corrected CHANGELOG date year for `[0.1.0]`.
- Removed genuinely dead exports: `fileSha256` (`src/scanner/content.js`), `shouldSkipSecretScan` and `extractDebtMarkers` (`src/scanner/markers.js`); their re-exports were dropped from `src/scanner/index.js`.
- Audit evidence file list is now de-duplicated (source files only) instead of relying on a fragile `Map` round-trip; stale-prompt detection uses explicit prior/current prompt-metadata existence checks rather than indirect signals.

## [0.1.0] - 2026-05-27

### Added

- `ctx bootstrap` — one-command setup that runs `init → snapshot → prompt → site` and opens the dashboard.
- `ctx doctor` — zero-side-effect health check with 9 diagnostic checks, color-coded output, and `--json` for CI integration.
- Glob engine hardening: bracket character classes `[abc]`, ranges `[a-z]`, negation `[!x]`, nested brace expansion `{a,{b,c}}`, safety limits (`MAX_GLOB_LENGTH`, `MAX_BRACE_DEPTH`), and graceful degradation.
- Hardened snapshot scanning: defensive `statSync` retries and `FINGERPRINT_BATCH_SIZE` for future async scale-out.
- Performance benchmarks for 100-file, 500-file, and incremental snapshot workflows.
- Full `architecture_rules` config schema reference documented at `docs/12-architecture-rules.md`.
- Production-ready packaging: `LICENSE`, `CHANGELOG.md`, and `package.json` metadata.

### Fixed

- Removed dead TypeScript scaffold (`src/cli/main.ts`, `tsconfig.json`).
- Split monolithic modules into focused submodules (plan, storage) while preserving backward-compatible re-exports.
- Removed or un-exported internal helper functions that were unintentionally part of the public API surface.
- Eliminated linter false positives for TODO/FIXME/HACK inside strings, regexes, and code expressions.

### Changed

- `scoreAudit` null-safe with `Array.isArray` guard and `filter(Boolean)` on findings.
- Config-driven severity weights via `DEFAULT_SEVERITY_WEIGHTS` with project-level `audit.severity_weights` overrides.
- Standardized error format across all CLI commands: `ContextLock error: <what> / Reason: <why> / Recovery: <how> / Command: <cmd>`.

### Production Readiness

- All P0 alpha blockers from remediation backlog resolved:
  - `schema_version` enforced on every audit artifact via `writeAuditArtifacts` schema validation.
  - Glob normalization centralized through `normalizeGlobPattern`.
  - CRLF equivalence covered by test suite (LF and CRLF files normalize to identical semantic fingerprints).
  - Binary and large files handled safely (2MB text threshold, `isBinaryBuffer` detection, streaming hash).
  - Go and Rust manifest detection implemented and tested.
- Error messages include standardized recovery actions for every user-facing failure path.
- CLI output uses `console.error` for diagnostics and `console.log` for normal output, respecting `--quiet`.
- All 86 tests passing with deterministic replay checks.
- Zero external dependencies (Node.js >=20).
