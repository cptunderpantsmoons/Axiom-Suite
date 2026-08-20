# Plan: Fix flagged code/implementation weaknesses in ContextLock

## Context

A review of `contextlock` (v0.1.0) flagged five code/implementation weaknesses. The
product/scope concerns (feature diffusion, process overhead) are **explicitly out of
scope** per user decision — this plan covers code fixes only. All changes are
behavior-preserving unless noted, and must keep the existing 100-test suite green.

Confirmed facts from investigation:
- `src/cli/app.js` is **774 lines**; the 600-line lint limit (`scripts/lint.js:12`,
  `MAX_FILE_LINES`) is reported as `'warn'` (`:60`), so it passes today.
- Genuinely dead exports (definition + re-export only, no other refs): `fileSha256`
  (`src/scanner/content.js:26`), `shouldSkipSecretScan` (`src/scanner/markers.js:24`),
  `extractDebtMarkers` (`src/scanner/markers.js:68`). The lint "unused export" info
  warnings for `listMemoryEntries`, `readMemoryEntry`, `compileExcluder`,
  `looksHighEntropy` are **false positives** (used internally) — do NOT delete these.
- `security.redaction_count` (`src/snapshot/index.js:443`) only reflects debt-marker-line
  redactions and is smuggled via `Object.defineProperty(markers,'redactionCount',...)` at
  `:223`. The `security` object is **not** in `schemas/snapshot.schema.json` (root
  `additionalProperties:true`), so it is never validated.
- Drift score (`src/audit/index.js:197` `scoreAudit`) is a capped weighted sum — correct
  but should be labeled a heuristic, not a measurement.

## Decisions

- Code fixes only; product scope unchanged.
- No new features; only cleanup, honesty fixes, and a refactor with identical behavior.
- Keep `main` exported from `src/cli/app.js` (bin entry depends on it).

## Task 1 — Decompose `src/cli/app.js` (774 → ≤600 lines)

1. Create `src/cli/help.js`, move `printHelp` (currently `app.js:558-667`) there, export it.
2. Create `src/cli/shared.js`, move `hasFlag` and `outputFormat` (`app.js:28-37`) there, export both.
3. Create `src/cli/commands/`, one file per handler currently inline in `app.js`:
   - `init.js` (`initCommand`), `status.js` (`statusCommand`),
     `snapshot.js` (`snapshotCommand`), `prompt.js` (`promptCommand`, `promptRefreshCommand`, `parseRelates`),
     `audit.js` (`auditCommand`), `site.js` (`siteCommand`),
     `memory.js` (`memoryCommand`), `code.js` (`codeIndexCommand`).
   Each exports `export function <name>Command(args, cwd)` and imports `hasFlag`/`outputFormat`
   from `../shared.js` plus the existing domain modules (no logic moved from domains).
4. Rewrite `src/cli/app.js` as a thin router: import all handlers + `printHelp`, build a
   `COMMANDS` registry `Map`/`object` mapping command name → handler (replacing the long
   `if (command === ...)` chain, `app.js:669-773`). Keep `--help`/`-h`/`--version`/`-v`
   handling and `export async function main`.
5. Bootstrap/doctor continue to route to `src/bootstrap/index.js` as today.
6. (Guardrail) In `scripts/lint.js:60` bump the line-count violation from `'warn'` to
   `'error'` so `app.js` cannot regress past 600 lines again. Only `app.js` violates today,
   so this is safe post-refactor.

## Task 2 — Remove truly-dead exports

1. Delete `fileSha256` body (`src/scanner/content.js:26-?`) and its re-export
   (`src/scanner/index.js:13`).
2. Delete `shouldSkipSecretScan` body (`src/scanner/markers.js:24-?`) and re-export
   (`src/scanner/index.js:40`).
3. Delete `extractDebtMarkers` body (`src/scanner/markers.js:68-?`) and re-export
   (`src/scanner/index.js:39`).
4. Verify no remaining references with `rg -n "<sym>" src` (ignore `docs/` mention of
   `fileSha256` in `specs/21-code-index-artifact.md` — leave doc text).
5. Do NOT touch `listMemoryEntries`, `readMemoryEntry`, `compileExcluder`, `looksHighEntropy`
   (used internally; lint info is a false positive).

## Task 3 — Fix `security.redaction_count` (honest + validated)

1. In `src/snapshot/index.js` `extractFingerprintsAndMarkersWithCache`: return
   `redactionCount` as a plain number (remove the `Object.defineProperty(markers,'redactionCount',...)`
   at `:223`). Also count `sensitivePathsSkipped` (increment when `isSensitivePath(rel)` is
   true and the file is hashed to `SENSITIVE_FP`).
2. In `buildSnapshot`, replace `security: { redaction_count: debtMarkers.redactionCount || 0 }`
   (`:442-444`) with:
   `security: { redaction_count: redactionCount, sensitive_paths_skipped: sensitivePathsSkipped }`.
3. In `schemas/snapshot.schema.json` add `security` to root `properties`:
   `{ "type": "object", "properties": { "redaction_count": {"type":"integer"},
   "sensitive_paths_skipped": {"type":"integer"} }, "additionalProperties": true }`
   (root keeps `additionalProperties:true`; no `required` change needed).
4. Update `tests/snapshot.test.js` to assert `security.redaction_count` and
   `security.sensitive_paths_skipped` are integers ≥ 0, and that a snapshot containing a
   `.env`/`.pem` file yields `sensitive_paths_skipped >= 1`.

## Task 4 — Drift-score honesty

1. In `src/audit/index.js`, add `scoring_model: 'weighted_heuristic'` to the audit artifact
   (in `auditCommand` object, ~`:288`) and document it in `scoreAudit` JSDoc.
2. Add `scoring_model` (`type: string`) to `properties` in `schemas/audit.schema.json`.
3. Soften README.md wording: the MVP promise (`:114`) and "Drift score" framing should state
   it is a transparent, configurable weighted heuristic — not a statistical measurement.
   No change to scoring math (already configurable via `config.audit.severity_weights`).

## Task 5 — Audit evidence dedup + fragile stale-prompt check

In `src/audit/index.js`:
1. Finding #1 (`:79-82`): replace the `new Map(...).values()` file hack with:
   `const changedSourceFiles = [...new Set([...diff.changed, ...diff.added, ...diff.removed].filter(i => classifyFile(i.file) === 'source').map(i => i.file))];`
   `evidence: changedSourceFiles.map(f => ({ file: f }))`.
2. Stale-prompt finding (`:145-161`): replace with direct existence checks:
   `const prevHadPrompt = Boolean(prev && readPromptMetadata(root, prev.snapshot_hash, 'onboarding'));`
   `const currHasPrompt = Boolean(readPromptMetadata(root, curr.snapshot_hash, 'onboarding'));`
   `if (prev?.snapshot_hash && prev.snapshot_hash !== curr.snapshot_hash && prevHadPrompt && !currHasPrompt) { ... }`
   Keep evidence text pointing at the actual missing onboarding prompt path.

## Validation

- `node --test` → all 100 pass. Tasks 3 & 5 change artifact shape/logic, so update only the
  affected assertions in `tests/snapshot.test.js` and `tests/audit.test.js`; CLI spawn tests
  (`bootstrap`, `init`, etc.) must still pass unchanged.
- `node scripts/lint.js` → 0 errors; `app.js` now ≤600 (warning gone; line-limit escalated to error).
- `npm run check` (lint + test) green.
- Determinism check: run `node src/cli/main.js snapshot` twice in a temp git repo → identical
  `snapshot_hash` (confirm `security` fields are deterministic after Task 3).

## Risks

- Task 1 is the largest change; risk of subtle arg-parsing/exit-code regression. Mitigation:
  preserve exact flag handling and exit codes; rely on existing CLI integration tests.
- Schema edits to `security` are additive/validated; no internal consumer expects its absence.
- Escalating line-limit to `error` only bites `app.js`, which will be under 600 after Task 1.

## Out of scope

Product/scope trimming (Hugging Face sync, HTML site, agent memory, RAG bundle, process-docs
overhead) — deferred per user decision.
