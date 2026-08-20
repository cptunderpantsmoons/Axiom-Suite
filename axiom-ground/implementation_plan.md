# Implementation Plan

[Overview]
Deliver the next development stages of ContextLock — a read-only local GUI web app served by `ctx site serve`, followed by reliability hardening, a claim ledger, and file-watch automation — while preserving the zero-runtime-dependency, deterministic, CLI-first identity.

## Current state of development

All 13 tracked builds are `done` or `validated`: `ctx init`, `ctx snapshot`, `snapshot.md` quality, `ctx prompt onboarding`, `ctx audit --since-last`, `ctx site build`, post-commit automation, Hugging Face sync, CI audit, rules/contracts, planning engine, RAG ingestion bundle + agent memory, and the code index artifact. Specs 11–21 are `validated` with fixture-gated implementation readiness. Every active guardrail (spec-link check, secret-scan, source/test coupling, scope boundary, determinism replay) passes. The CHANGELOG for 0.1.0 confirms all P0 alpha blockers from `docs/11-remediation-backlog-and-hardening.md` are resolved. The CLI surface is complete and documented.

## Gap analysis — what is documented but not yet built

1. **`ctx site serve`** — explicitly specified in `docs/09-human-readable-html-layer.md` (`ctx site serve --port 4123`, "Starts a local read-only server") but never implemented.
2. **Interactive GUI** — the static site renders snapshot/architecture/prompts/audit/claims/progress, but **memory (spec-20) and code index (spec-21) artifacts are never surfaced**, and `claims.html` is a hard-coded placeholder.
3. **Hardening items** — `docs/planning/contextlock-progress.json` guardrail notes record two explicit next steps: "more granular incremental aggregate recomputation" and "broader real-provider HF validation".
4. **`ctx daemon start|stop`** — listed in `docs/02-system-architecture.md` primary command surface and `docs/03-development-roadmap.md` Phase 5 ("daemon debounces file changes") but not implemented.
5. **Claim ledger** — ranked #1 elevation opportunity in `docs/08-elevation-opportunities.md`; `claims.html` exists as a placeholder and the auditor already has a `documentation_drift` category it can extend.

## GUI decisions (confirmed with the user)

- **Form factor:** a local web app served by `ctx site serve` — a zero-dependency Node `http` server serving the existing generated static site plus JSON API endpoints.
- **Mutation model:** the server is **strictly read-only**. It serves artifacts and curated read-only API payloads; all writes (`snapshot`, `audit`, `prompt`, `memory add`, `sync`, `plan`, `code index`, `claims`) remain CLI-only. No POST/PUT/DELETE routes exist.
- **Front end:** vanilla JS progressive enhancement over the existing static HTML — no framework, no build step, works offline via `file://`, and degrades to the server-rendered content when JavaScript is disabled (matching the existing "works with JavaScript disabled" quality gate).

## Stage roadmap

- **Stage 1 — GUI web app (`ctx site serve`)** (primary ask): new `src/serve/` module, API payload layer, interactive JS, new `memory.html` + `code-index.html` pages, read-only enforcement, traversal protection.
- **Stage 2 — Reliability hardening:** granular incremental aggregate reuse, real-provider HF integration test (env-gated), misc serve/API hardening.
- **Stage 3 — Claim ledger:** `src/claims/` extraction + verification engine, `claims.schema.json`, `ctx claims` CLI, audit integration, real `claims.html` data.
- **Stage 4 — Daemon automation:** `ctx daemon start|stop|run` polling watcher (debounced, logged, non-destructive), complementing the existing git hooks.

Every stage is additive: no existing command, artifact, or schema version is changed except where an existing build output gains new deterministic pages (site pages list). No new runtime dependencies at any point.

---

[Types]
Introduces the serve/API envelope and payload shapes, claim ledger and daemon state models, and the additive config blocks — all schema-versioned, zero-dependency, and validated against JSON Schema like every existing artifact.

## Stage 1 — Serve configuration and API contract

### `ServeOptions` (internal, CLI-parse level)

```js
{
  port: number;    // default 4123; `0` selects an ephemeral port (tests)
  host: string;    // default '127.0.0.1' (loopback only — never 0.0.0.0)
  open: boolean;   // default false; --open launches the default browser
  quiet: boolean;  // suppresses non-essential stdout
  // write is deliberately absent — the server has no mutation surface
}
```

### API envelope (every response)

```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "message": "", "reason": "", "recovery": "", "command": "", "code": 404 } }
```

### Route table (GET only; any other method on any route → `405` JSON)

| Route | Payload shape |
|---|---|
| `GET /` | static `index.html` |
| `GET /assets/*`, `GET /*.html`, `/*.css`, `/*.js` | static site files from `.contextlock/site/` only |
| `GET /api/status` | `StatusPayload` — identical shape to `ctx status --format json` |
| `GET /api/doctor` | `DoctorPayload` — identical shape to `ctx doctor --json` |
| `GET /api/snapshots` | `{ snapshots: [ { hash, mtimeMs } ] }` sorted newest-first |
| `GET /api/snapshot?hash=<h>` | full snapshot artifact; `404` if missing |
| `GET /api/audit/latest` | full latest audit artifact; `404` if none |
| `GET /api/memory` | `{ entries: [MemoryEntry], count }` — same shape as `ctx memory list --format json` |
| `GET /api/code-index/latest` | full code index artifact; `404` if none |
| `GET /api/prompts` | `{ onboarding: "fresh"\|"stale"\|"missing" }` |
| `GET /api/progress` | contents of `docs/planning/contextlock-progress.json` |
| `GET /api/claims/latest` | `ClaimsPayload` (Stage 3); `404` JSON with recovery until claims exist |
| `GET /api/site` | contents of `.contextlock/site/site.json` |
| any other route | `404` JSON (standard ContextLock error object) |

### Validation rules (API layer)

- Every payload is built by a curated builder function — **raw `.contextlock/config.json` and `lock.json` are never served**. Artifacts served are already secret-redacted by construction (`snapshot`, `audit`, `memory`, `code-index`, `site`, prompts).
- Static file serving must resolve the request path, `path.resolve()` it, and reject any target not inside the site directory (traversal guard).
- No `Access-Control-Allow-Origin` header is emitted (same-origin only).
- JSON content types: `application/json; charset=utf-8`; HTML `text/html; charset=utf-8`; CSS `text/css`; JS `application/javascript`.

## Stage 3 — Claim ledger model

Stored under `.contextlock/claims/<snapshot_hash>.json`, schema-validated against `schemas/claims.schema.json`:

```json
{
  "schema_version": 1,
  "artifact_type": "claims",
  "claims_version": 1,
  "snapshot_hash": "ctxsnap_...",
  "project_id": "ctxproj_...",
  "generated_at": "2026-08-15T00:00:00Z",
  "claim_count": 1,
  "claims": [
    {
      "id": "claim_<sha256(text+source_file).slice(0,16)>",
      "text": "Tests are run with `node --test`.",
      "source_file": "README.md",
      "line": 12,
      "category": "command" | "tech_choice" | "architecture" | "process" | "other",
      "confidence": "high" | "medium" | "low",
      "evidence_status": "verified" | "unverified" | "contradicted",
      "supporting_evidence":  [ { "file": "package.json", "line": 5, "text": "\"test\": \"node --test\"" } ],
      "contradicting_evidence": [ { "file": "README.md", "line": 12, "text": "..." } ],
      "last_verified_snapshot": "ctxsnap_..."
    }
  ]
}
```

Rules: `id` is content-addressed over normalized `text + sorted(source_file)`; `generated_at` is excluded from any determinism hash; evidence arrays are sorted by `(file, line)`; the artifact is deterministic for identical snapshot + docs + config.

## Stage 4 — Daemon state model

Stored at `.contextlock/daemon.json` (covered by default `.contextlock/**` exclusions):

```json
{
  "schema_version": 1,
  "artifact_type": "daemon_state",
  "pid": 12345,
  "root": "/abs/path/to/repo",
  "interval_sec": 30,
  "debounce_ms": 5000,
  "started_at": "2026-08-15T00:00:00Z",
  "last_run_at": "2026-08-15T00:00:10Z"
}
```

`daemon.json` is written by `daemon start`, updated by the worker after each cycle, and removed by `daemon stop` (or when `stop` finds the pid dead). Reading it is joined with a liveness check (`process.kill(pid, 0)`), so `/api/status` can report `{ daemon: { running: true|false, pid, interval_sec, started_at } | null }`.

## Config additions (all optional / defaulted in code)

```json
{
  "daemon": {
    "interval_sec": 30,
    "debounce_ms": 5000,
    "auto_start": false
  }
}
```

`claims` needs no config key — it runs on-demand via CLI and inside `site build` when an existing claims artifact is present. These live in `buildDefaultConfig` when Stage 4 lands; existing configs are merged, never overwritten (same pattern as `automation`/`remote`).

---

[Files]
Adds four new source modules, two new site pages and one interactive JS asset, one schema, and targeted modifications to the CLI dispatcher, site builder, sync enumerator, init defaults, and planning/progress documentation — with zero deletions and zero dependency changes.

## New files

1. **`src/serve/index.js`** — CLI entry: `siteServeCommand(args, cwd)`; parses `--port`, `--host`, `--open`, `--quiet`; creates the server via `createSiteServer`; prints the URL; handles SIGINT/SIGTERM graceful shutdown.
2. **`src/serve/server.js`** — pure `node:http` server factory `createSiteServer(root, { port, host })` returning the `http.Server`; request router; static file serving with traversal guard `isPathInside(base, target)`; `sendJson(res, status, payload)` and `sendError(res, status, err)` helpers; 404/405 handling; `resolveSiteDir(root)`.
3. **`src/serve/api.js`** — `buildApiPayload(root, kind, query)` dispatch plus one builder per route: `payloadStatus`, `payloadDoctor`, `payloadSnapshots`, `payloadSnapshot`, `payloadAuditLatest`, `payloadMemory`, `payloadCodeIndexLatest`, `payloadPrompts`, `payloadProgress`, `payloadClaimsLatest`, `payloadSite`. Each returns `{ ok:true, data }` or `{ ok:false, error }`.
4. **`src/status/index.js`** — extracted shared builder `buildStatusPayload(root)` moved out of `statusCommand` in `src/cli/app.js` (lines 80–121); used by both the CLI and `/api/status`; output byte-identical to today.
5. **`src/doctor/index.js`** — extracted shared builder `buildDoctorChecks(root)` and `doctorExitCode(checks)` moved out of `doctorCommand` in `src/bootstrap/index.js`; used by both the CLI and `/api/doctor`; output byte-identical to today.
6. **`src/claims/index.js`** (Stage 3) — claim extraction/verification engine: `extractClaimsFromDocs(root, snapshot)`, `verifyClaims(root, claims, snapshot, config)`, `buildClaimsArtifact(root, lock, config)`, `writeClaimsArtifacts(root, built)`, `readLatestClaims(root, snapshotHash)`, `listClaimsArtifacts(root)`, `claimsCommand(args, cwd)`.
7. **`schemas/claims.schema.json`** (Stage 3) — JSON Schema for `claims` artifacts mirroring `schemas/audit.schema.json` style (`additionalProperties: true`, strict required list per §Types).
8. **`src/daemon/index.js`** (Stage 4) — `daemonStartCommand`, `daemonRunCommand`, `daemonStopCommand`, `daemonStatusForServe(root)` (reads `daemon.json` + liveness, used by `/api/status`).
9. **`src/site/assets/contextlock.js`** — vanilla interactive front-end script written as a template string from `src/site/index.js` (same pattern as the CSS today): `fetchJson`, `initDashboard`, `renderStatus`, `renderSnapshots`, `renderSnapshotDetail`, `renderAudit`, `renderMemory`, `renderCodeIndex`, `renderProgress`, `renderClaims`, `renderPrompts`, `filterTable`, `debounce`, `autoRefresh` (60s poll, read-only).

## Modified files

10. **`src/cli/app.js`** — add `serve` subcommand dispatch inside `siteCommand` (after `open`): `ctx site serve [--port N] [--host H] [--open] [--quiet]`; add `ctx claims` dispatch (Stage 3); add `ctx daemon start|stop|run` dispatch (Stage 4); refactor `statusCommand` to call `buildStatusPayload`; help text entries for `serve`, `claims`, `daemon`.
11. **`src/site/index.js`** — add `memory.html` and `code-index.html` static pages (server-rendered fallback from memory/code-index artifacts when present, placeholder message otherwise); extend `renderNav` with both pages; when a claims artifact exists, render real data into `claims.html` instead of the placeholder; write `assets/contextlock.js` alongside the CSS; extend `siteDirJson.pages` to the full nine pages; keep site hash input including the new pages so determinism replay covers them.
12. **`src/bootstrap/index.js`** — refactor `doctorCommand` to use `buildDoctorChecks`/`doctorExitCode` from `src/doctor/index.js`; no behavior change.
13. **`src/storage/sync.js`** (Stage 3) — `gatherArtifacts` gains a `claims/` walker emitting `{ localPath, remotePath: "claims/<file>", label: "claims:<file>" }` (only if `.contextlock/claims/` exists).
14. **`src/init/index.js`** (Stage 4) — merge `daemon` defaults into `buildDefaultConfig`; add `claims` and `index` to `ensureContextlockDirs` only if not already present (they are additive dirs).
15. **`package.json`** — optional convenience script `"serve": "node src/cli/main.js site serve"`. No dependency changes.
16. **`docs/planning/contextlock-progress.json`** — add builds 14 (GUI site serve), 15 (hardening validation), 16 (claim ledger), 17 (daemon automation); update `guardrails.notes`; bump `updated_at`.
17. **`docs/09-human-readable-html-layer.md`** — mark `ctx site serve` implemented; document the read-only API route table and traversal guarantees; document `memory.html` and `code-index.html`.
18. **`docs/02-system-architecture.md`** — mark `ctx daemon start` implemented under the Automation Layer module; add `src/serve/`, `src/claims/`, `src/daemon/` to the package structure tree.
19. **`docs/03-development-roadmap.md`** — Phase 5: mark daemon tasks done at implementation; Phase 4 acceptance updated for new pages; add a Phase 4.5 "GUI/read-only serve" note.
20. **`docs/decision-records`** — `docs/decisions/2026-08-15-ctx-site-serve-readonly-gui.md` (problem, decision: zero-dep read-only local web app; alternatives: SPA/framework, write-enabled API, desktop app; compatibility: additive, no version bumps; migration/rollback: remove `src/serve/` and the `serve` dispatch).
21. **`README.md`** — document map gains the serve/claims/daemon commands and link to `docs/13`-style status (reuse `docs/09` for serve).
22. **`CHANGELOG.md`** — Unreleased: Added entries for `ctx site serve`, interactive GUI, `memory.html`/`code-index.html`, claim ledger, daemon; Changed: hardened incremental aggregates, real-provider HF test.

## Deleted / moved files

None. `src/status/index.js` and `src/doctor/index.js` are extractions; the original exports and CLI behavior remain byte-identical (verified by fixture comparison tests).

---

[Functions]
Adds the serve/API/daemon/claims function sets and the interactive front-end helpers, refactors `statusCommand` and `doctorCommand` into shared payload builders with no behavior change, and removes no functions.

## New functions — `src/serve/index.js`

| Signature | Purpose |
|---|---|
| `siteServeCommand(args, cwd)` | CLI entry for `ctx site serve`. Resolves git root, validates init, parses flags, calls `createSiteServer`, prints `Serving ContextLock at http://127.0.0.1:4123/`, blocks until SIGINT/SIGTERM, returns 0. Non-zero with standard `fail()` error object on invalid `--port`/`--host`. |
| `openBrowser(url)` | Reuses the platform opener approach from `src/bootstrap/index.js` (`open`/`start`/`xdg-open`) when `--open` is set. |

## New functions — `src/serve/server.js`

| Signature | Purpose |
|---|---|
| `createSiteServer(root, { port, host })` | Creates and returns the `http.Server`. Routes `GET` requests: API paths to `buildApiPayload`, static paths to the file handler. Non-GET → `405`. Binds to the resolved `host`/`port`; when `port === 0` the OS-assigned port is read via `server.address().port`. |
| `handleStaticRequest(req, res, siteDir)` | Serves files under `siteDir` with correct content-types; maps `/` → `index.html`; `404` HTML for missing files. |
| `isPathInside(base, target)` | Traversal guard: `path.resolve(target)` must equal `base` or start with `base + path.sep`. Returns boolean. |
| `sendJson(res, statusCode, payload)` | Writes JSON with `application/json; charset=utf-8`. |
| `sendError(res, statusCode, err)` | Writes the standardized `{ ok:false, error }` envelope. |
| `resolveSiteDir(root)` | Returns `.contextlock/site`; verifies it exists (else 500 error JSON with recovery `ctx site build`). |

## New functions — `src/serve/api.js`

| Signature | Purpose |
|---|---|
| `buildApiPayload(root, kind, query)` | Route dispatcher; catches and normalizes all read errors to the standard error envelope. |
| `payloadStatus(root)` | Delegates to `buildStatusPayload(root)` from `src/status/index.js`; adds `daemon` field from `daemonStatusForServe`. |
| `payloadDoctor(root)` | Delegates to `buildDoctorChecks(root)` from `src/doctor/index.js`; returns `doctorExitCode`-compatible shape. |
| `payloadSnapshots(root)` | `listSnapshotArtifacts(root)` mapped to `{ hash, mtimeMs }`. |
| `payloadSnapshot(root, hash)` | `loadSnapshotArtifact`; `404` error object when null. |
| `payloadAuditLatest(root, lock)` | `latestAuditArtifact`; `404` when null. |
| `payloadMemory(root, lock)` | `listMemory(root)` → `{ entries, count }`. |
| `payloadCodeIndexLatest(root, lock)` | `readCodeIndex(root, lock.latest_snapshot_hash)`; `404` when missing. |
| `payloadPrompts(root, lock)` | `getPromptFreshness` → `{ onboarding }`. |
| `payloadProgress(root)` | Reads `docs/planning/contextlock-progress.json`; `404` error envelope when absent (used by progress page). |
| `payloadClaimsLatest(root, lock)` | Stage 3: `readLatestClaims`; `404` until claims exist. |
| `payloadSite(root)` | Reads `.contextlock/site/site.json`. |

## New functions — `src/status/index.js` and `src/doctor/index.js` (extractions)

- `buildStatusPayload(root)` — the exact object currently built inside `statusCommand` (branch, commit, support level, prompt freshness, drift score); returns the same JSON.
- `buildDoctorChecks(root)` — the exact `checks` array currently built inside `doctorCommand` (Git, ContextLock, ecosystem, snapshot, prompt, drift, debt, hooks, remote); returns the array plus the exit-code decision.
- `doctorExitCode(checks)` — `1` when any check is `bad`, else `0`.

## New functions — `src/claims/index.js` (Stage 3)

| Signature | Purpose |
|---|---|
| `extractClaimsFromDocs(root, snapshot)` | Line-based extraction over `README.md` + `docs/**/*.md` (skip fenced code blocks). Pattern classes: command claims (`tests are run with …`, `npm test`), tech-choice claims (`uses/build with/powered by/written in <X>`), architecture/process claims (`should never/always/not …`, `must not import/use …`). Returns normalized candidate claims with `source_file`, `line`, `category`, `confidence`. |
| `verifyClaims(root, claims, snapshot, config)` | Verifies each claim: command claims against `machine_facts.test_commands/build_commands/run_commands`; tech-choice against `dependencies`, `languages`, `manifests`, `entrypoints`; architecture import claims by reusing the import extractor from `src/rules/index.js` on fresh file reads. Produces `verified/unverified/contradicted` with evidence arrays. |
| `buildClaimsArtifact(root, lock, config)` | Wraps extraction + verification into the schema-validated artifact (§Types); deterministic (`id` content-addressed, evidence sorted, `generated_at` excluded from hash). |
| `writeClaimsArtifacts(root, built)` | Writes `.contextlock/claims/<snapshot_hash>.json`. |
| `readLatestClaims(root, snapshotHash)` / `listClaimsArtifacts(root)` | Readers mirroring `readCodeIndex`/`listSnapshotArtifacts`. |
| `claimsCommand(args, cwd)` | CLI: `ctx claims` (builds artifact, prints counts), `--format json`, `--quiet`. |

## New functions — `src/daemon/index.js` (Stage 4)

| Signature | Purpose |
|---|---|
| `daemonStartCommand(args, cwd)` | Writes `daemon.json` (pid = spawned child), detach-spawns `node src/cli/main.js daemon run <root> --interval <sec>` with stdout/stderr to `.contextlock/logs/daemon.log` (via `stdio: 'ignore'` + explicit file fd), prints pid. Fails if already running (liveness check). |
| `daemonRunCommand(args, cwd)` | Foreground worker: loop every `interval_sec`; detect repo changes by comparing `runGit(['status','--porcelain'])` snapshot + latest snapshot hash; on change (debounced `debounce_ms`) run `ctx snapshot --incremental --quiet`, `ctx audit --since-last --quiet`, `ctx prompt refresh --changed --quiet`, `ctx site build --quiet`; log start/status/end lines to `logs/automation.log`; never exits non-zero from ContextLock failures; graceful exit on SIGINT/SIGTERM; `--once` runs a single cycle. |
| `daemonStopCommand(args, cwd)` | Reads `daemon.json`, liveness-check, `process.kill(pid, 'SIGTERM')`, removes the file; idempotent; no-op with message when not running. |
| `daemonStatusForServe(root)` | Returns `null` or `{ running, pid, interval_sec, started_at, last_run_at }` for `/api/status`. |

## New front-end functions — `src/site/assets/contextlock.js`

`fetchJson(path)`; `debounce(fn, ms)`; `filterTable(input, table)`; `autoRefresh(fn, ms)`; per-page renderers (`renderStatus`, `renderSnapshots`, `renderAudit`, `renderMemory`, `renderCodeIndex`, `renderProgress`, `renderClaims`, `renderPrompts`, plus `renderBadge`/`el` DOM helpers). All read-only; all feature-detect `fetch`; all no-ops with a `.offline` note when served via `file://` (server-rendered content remains).

## Modified functions

- **`statusCommand(args, cwd)`** in `src/cli/app.js` — body replaced by `buildStatusPayload(root)` + shared print/JSON logic. Output byte-identical.
- **`doctorCommand(args, cwd)`** in `src/bootstrap/index.js` — body replaced by `buildDoctorChecks(root)` + shared render/JSON logic. Output byte-identical.
- **`buildSiteArtifacts(root, lock)`** in `src/site/index.js` — adds two pages, the JS asset, claims rendering, and extends `siteDirJson.pages`.
- **`renderNav(active)`** in `src/site/index.js` — adds `memory.html` and `code-index.html` links.
- **`siteCommand(args, cwd)`** in `src/cli/app.js` — adds `serve` subcommand dispatch.
- **`gatherArtifacts(root)`** in `src/storage/sync.js` — adds claims walker (Stage 3).
- **`buildDefaultConfig(root, existing)`** in `src/init/index.js` — merges `daemon` defaults (Stage 4).
- **`printHelp()`** in `src/cli/app.js` — new command help entries.

## Removed functions

None. All extractions preserve public API surface (re-export pattern already used by `plan`, `storage`, `scanner`).

---

[Classes]
Introduces no new classes — the codebase is functional ESM throughout; the only instantiated object added is the `http.Server` returned by `node:http`'s `createServer`.

- No `class` declarations anywhere in the new code.
- `createSiteServer` returns an `http.Server` instance (native Node object), used by `siteServeCommand` for `listen()`/`close()` and SIGINT/SIGTERM shutdown.
- The front end uses plain functions and DOM APIs — no component classes, no framework.
- Existing modules remain untouched structurally; extracted builders are plain exported functions.

---

[Dependencies]
Adds zero new runtime or test dependencies — the changes rely entirely on Node.js >=20 built-ins, preserving the project's dependency-free identity (as asserted in `package.json` and `scripts/setup.js`).

- Runtime: `node:http` (server), `node:fs`/`node:path`/`node:url` (static serving + traversal guard), `node:child_process` (`spawn`/`spawnSync` for `--open` browser launch and detached daemon child), `node:crypto` not needed (existing `sha256` reused).
- `engines` stays `node >=20`; `node:fetch` (already used in `src/storage/backends.js`) is used by tests against the ephemeral-port server.
- `package.json` gains only the convenience `"serve"` npm script — no `dependencies`, no `devDependencies`, no lockfile change.
- Guardrail compliance: any dependency addition would trip the existing `dependency_rationale_check` — this plan intentionally introduces none.

---

[Testing]
Adds serve/claims/daemon test suites plus refactor-equivalence and hardening tests, all under the existing `node --test` harness with fixture repos, ephemeral ports, and determinism replay — keeping the existing spec-conformance gate green.

## New test files

### `tests/serve.test.js` (Stage 1)
- Starts `createSiteServer` on port `0` (ephemeral) against a fixture repo with a built site. Asserts:
  - `GET /` → 200, `Content-Type: text/html`, body contains the dashboard title.
  - `GET /assets/contextlock.css` → 200 `text/css`; `GET /assets/contextlock.js` → 200 `application/javascript`.
  - `GET /api/status` → `{ ok: true, data: { initialized: true, project, branch, commit, prompt_cache, last_drift_score } }`.
  - `GET /api/snapshots` → 200 list; `GET /api/snapshot?hash=<built>` → 200 with `snapshot_hash`; `GET /api/snapshot?hash=nope` → 404 JSON error envelope with `recovery`.
  - `GET /api/memory` → 200 `{ entries: [], count: 0 }` on a fixture without memory; seeded fixture asserts entry shape.
  - `GET /api/code-index/latest` → 200 after `ctx code index`; `404` before.
  - `GET /api/progress` → 200 from fixture progress JSON.
  - **Traversal blocks:** `GET /..%2F..%2Fconfig.json`, `GET /../lock.json`, `GET /%2e%2e/package.json` → 404 (never 200, never a file outside `siteDir`).
  - **Read-only:** `POST /api/status`, `PUT /api/memory`, `DELETE /api/status` → `405` with JSON error envelope.
  - Unknown route → 404 JSON.
  - Server closes cleanly (`server.close()` resolves).
- Determinism replay: run the serve suite twice against the same fixture; all non-time assertions identical.

### `tests/status-doctor-refactor.test.js` (Stage 1 regression)
- Fixture compare: capture `ctx status --format json` and `ctx doctor --json` output before refactor (fixture JSON files), then assert the new `buildStatusPayload`/`buildDoctorChecks` outputs are byte-identical to the captured fixtures.

### `tests/claims.test.js` (Stage 3)
- Fixture: README + docs with claim sentences. Asserts:
  - Extraction finds command and tech-choice claims with `source_file`/`line`.
  - A claim matching a real manifest script → `verified` with supporting evidence.
  - A claim contradicted by the actual manifest (README says `npm test`, manifest says `pytest`) → `contradicted` with `contradicting_evidence`.
  - Determinism: two runs → identical claim `id`s and evidence ordering.
  - Schema validation passes via `bundledSchemaPath('claims')`.
  - `gatherArtifacts` includes `claims/<file>` when present.
  - Audit: a contradicted claim referenced in a prior audit produces a `claim_contradiction` finding (severity `medium`, category `documentation_drift`).

### `tests/daemon.test.js` (Stage 4)
- Fixture git repo. Asserts:
  - `daemon start` writes `daemon.json` with a live pid; `daemon stop` removes it and terminates the child.
  - `daemon stop` when not running is idempotent (exit 0, message).
  - `daemon run --once --interval 1` with a touched source file creates a new snapshot artifact and appends log lines to `logs/automation.log`.
  - `daemonStatusForServe` returns `{ running: false, ... }` after stop.
  - Determinism/secret-scan gates still pass after the cycle.

## Existing test modifications

- `tests/site.test.js` — update expected `pages` list to include `memory.html`, `code-index.html`, and (Stage 3) non-placeholder `claims.html` rendering; assert `assets/contextlock.js` is written and deterministic.
- `tests/storage.test.js` — extend artifact enumeration assertions for claims (Stage 3).
- `tests/perf.test.js` — add an incremental-unchanged-repo case asserting `volatile_state.incremental.reused_aggregates: true` and runtime not regressed (Stage 2).
- `tests/bootstrap.test.js` — doctor fixture asserts unchanged output post-refactor.

## Validation strategies

- Every new artifact type validated through `assertValidSchema` before write (claims, daemon state).
- Site build determinism replay now covers nine pages + JS asset.
- Secret scan gate stays green: new pages/endpoints serve only already-redacted artifacts; the server never exposes `config.json`/`lock.json` raw.
- Serve tests use port `0` so CI never collides with a running instance; graceful shutdown asserted after each suite.
- Stage 2 hardening adds an env-gated real-provider HF integration test (skipped unless `HF_TOKEN` and `CONTEXTLOCK_HF_TEST_REPO` are set), mirroring the existing skip pattern for environment-gated tests.
- Full suite gate: `npm run check` (lint + all tests) must pass at every milestone.

---

[Implementation Order]
Implements Stage 1 (GUI serve) first as the core ask, then hardening, claims, and daemon — each milestone gated by `npm run check` and a determinism replay before the next begins.

## Stage 1 — GUI web app (`ctx site serve`)

1. Add `src/status/index.js` (`buildStatusPayload`) and `src/doctor/index.js` (`buildDoctorChecks`, `doctorExitCode`); refactor `statusCommand` and `doctorCommand` to use them. Capture `ctx status --format json` / `ctx doctor --json` fixtures first; add `tests/status-doctor-refactor.test.js`.
2. Create `src/serve/server.js` (server factory, static handler, traversal guard, JSON/error helpers) and `src/serve/api.js` (payload builders).
3. Create `src/serve/index.js` (`siteServeCommand`, `openBrowser`, graceful shutdown); wire `site serve` into `src/cli/app.js` `siteCommand` and `printHelp`.
4. Add `tests/serve.test.js` (routes, payloads, traversal blocks, 405 read-only, ephemeral port, clean shutdown). Gate: `node --test tests/serve.test.js`.
5. Extend `src/site/index.js`: add `memory.html` + `code-index.html` server-rendered pages, nav links, `siteDirJson.pages` update, and write `assets/contextlock.js`. Update `tests/site.test.js`.
6. Implement the interactive JS asset: status dashboard (auto-refresh 60s), snapshot explorer (list + detail + marker filter), audit explorer (severity chips + search), memory browser (stale badges + type filter), code-index browser (file/symbol filter), progress board, artifacts that degrade gracefully offline.
7. Add `"serve"` npm script; update `docs/09` (serve API table, read-only guarantees, new pages), `README.md` map, `CHANGELOG.md`, and write `docs/decisions/2026-08-15-ctx-site-serve-readonly-gui.md`.
8. Update `docs/planning/contextlock-progress.json`: add **Build 14 — GUI site serve**; refresh `ui` widget block and `updated_at`. Milestone gate: `npm run check` + determinism replay on site build.

## Stage 2 — Reliability hardening

9. Incremental aggregate reuse: in `src/snapshot/index.js`, when an incremental run reuses all per-file fingerprints and the file list is unchanged, carry `machine_facts`, `project_map`, and `inferred_context.architecture` from the baseline snapshot and set `volatile_state.incremental.reused_aggregates: true`; verify the resulting snapshot hash equals the baseline hash (deterministic). Update `tests/perf.test.js` with an unchanged-repo incremental case; gate: determinism replay.
10. Real-provider HF integration test: new env-gated test file (skipped unless `HF_TOKEN` + `CONTEXTLOCK_HF_TEST_REPO`) exercising `ctx remote add hf`, `ctx sync`, `ctx pull` round-trip against a real dataset repo; document in `docs/11` as resolved.
11. Serve hardening pass: request body size limits (reject bodies on GET), timeouts on keep-alive sockets, `server.requestTimeout`/`headersTimeout` defaults tuned for a read-only localhost server; document decisions in `docs/09`. Update `tests/serve.test.js` with oversized-body and timeout sanity cases. Milestone gate: `npm run check`.

## Stage 3 — Claim ledger

12. Add `schemas/claims.schema.json`; register it in `src/utils/schema.js` `bundledSchemaPath` mapping.
13. Implement `src/claims/index.js` (extraction + verification + artifact build/write/read + `claimsCommand`); wire `ctx claims` into `src/cli/app.js` and help text.
14. Integrate into audit: `buildAuditFindings` gains a `claim_contradiction` finding (severity `medium`, category `documentation_drift`) when the latest claims artifact contains a `contradicted` claim against the current snapshot; respect suppressions.
15. Wire claims into site: `claims.html` renders real artifact data (server-rendered fallback + JS enhancement via `/api/claims/latest`); add claims to `gatherArtifacts` for sync.
16. Add `tests/claims.test.js` + storage/site test updates; update `contextlock-progress.json` (**Build 16 — claim ledger**), `docs/08` priority list status, `docs/11`, `README.md`, `CHANGELOG.md`, and a decision record (`2026-08-15-claim-ledger.md`). Milestone gate: `npm run check`.

## Stage 4 — Daemon automation

17. Implement `src/daemon/index.js` (`daemonStartCommand`, `daemonRunCommand`, `daemonStopCommand`, `daemonStatusForServe`); wire `ctx daemon start|stop|run` into `src/cli/app.js` and `printHelp`.
18. Add `daemon` defaults to `buildDefaultConfig` in `src/init/index.js`; add `daemon` field to `/api/status` via `payloadStatus`.
19. Add `tests/daemon.test.js`; update `docs/02` (Automation Layer), `docs/03` (Phase 5 daemon tasks), `README.md`, `CHANGELOG.md`, and `contextlock-progress.json` (**Build 17 — daemon automation**); decision record `2026-08-15-daemon-automation.md`.
20. Final validation: full `npm run check`, determinism replay of site build + all artifacts, secret scan, fixture compare of `status`/`doctor` outputs, and `docs/planning/contextlock-progress.json` guardrail booleans updated to reflect the four new builds.