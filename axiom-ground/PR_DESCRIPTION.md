## Summary

Two commits that close out the v1 audit cycle: **`ctx bootstrap` + `ctx doctor`** for one-command onboarding and health diagnostics, followed by a **systematic fix of all 7 audit findings** — dead code removal, file size splits, glob engine hardening, schema documentation, and performance benchmarking.

---

## Changes Made

### `ctx bootstrap` — one-command setup
- Runs `init → snapshot → prompt → site` in a single command
- Auto-opens the dashboard in the browser
- Prints actionable next-step guidance with file paths
- Flags: `--quiet`, `--no-open`, `--force`, `--with-hooks`

### `ctx doctor` — zero-side-effect health check
- Runs 9 diagnostic checks: git state, init, support level, snapshot freshness, prompt freshness, drift score, debt markers, hooks, remote
- Outputs color-coded results with actionable recommendations
- Supports `--json` for CI integration
- Exits `1` if any check is `bad`

### Audit fix #1 — Remove dead TypeScript scaffold
- Deleted `src/cli/main.ts` (superseded by `main.js` + `app.js`)
- Deleted `tsconfig.json` (no `.ts` files remain; `src/**/*.ts` include was inert)

### Audit fix #2 — Split `src/plan/index.js` (674 → 443+89+64)
- `src/plan/generate.js` — task factory, plan base builder, 3 plan generators, dispatcher
- `src/plan/render.js` — markdown rendering, artifact persistence
- `src/plan/index.js` — thin CLI command with backward-compatible re-exports

### Audit fix #3 — Split `src/storage/index.js` (632 → 201+152+101+171)
- `src/storage/secrets.js` — secret scanning gate, retry queue
- `src/storage/backends.js` — file/local/mock/HuggingFace backends, factory
- `src/storage/sync.js` — artifact enumeration, sync, pull logic
- `src/storage/index.js` — CLI commands with backward-compatible re-exports

### Audit fix #4 — Document `architecture_rules` config schema
- Full reference doc at `docs/12-architecture-rules.md`
- Covers: rule schema, `match`/`forbid_imports`/`require_files`, suppressions, expiry behavior, validation workflow

### Audit fix #5 — Harden glob engine
- **Bracket character classes**: `[abc]`, `[a-z]`, `[!x]` (negation)
- **Nested brace expansion**: `{a,{b,c}}` with `findMatchingBrace()` + `splitBraceAlternatives()` helpers
- **Safety limits**: `MAX_GLOB_LENGTH=512`, `MAX_BRACE_DEPTH=3`
- **Graceful degradation**: unclosed brackets/braces treated as literal characters
- **18 new targeted glob tests** covering all edge cases

### Audit fix #6 — Prepare fingerprint extraction for scale
- `FINGERPRINT_BATCH_SIZE` constant with documented yield points for future async migration
- Defensive `try/catch` around `statSync` for files deleted between walk and fingerprint

### Audit fix #7 — Performance benchmarks
- **100 files**: <5s threshold (actual: ~86ms) ✅
- **500 files**: <10s threshold (actual: ~127ms) ✅
- **Incremental snapshot**: <3s threshold (actual: ~151ms) ✅
- **Artifact count correctness** verified at 500 files

---

## Technical Details

### Design decisions

- **Thin index pattern**: Split files use the barrel-reexport pattern — `index.js` re-exports from submodules so no import paths break downstream. This avoids a cascading refactor while keeping each file under 600 lines.
- **Backward-compatible re-exports**: Every public function that was previously `import { x } from './storage/index.js'` still works identically.
- **Glob engine hardening is additive**: The existing `*`, `**`, `?`, and `{a,b}` behavior is unchanged. New features (brackets, nested braces, depth limits) are purely additive with graceful fallback.
- **Performance benchmarks use real CLI**: Tests spawn `node src/cli/main.js` against real Git repos (created in temp dirs), not unit-test mocks. This catches integration regressions.

### Architecture

```
src/
├── bootstrap/index.js     ← NEW: ctx bootstrap + ctx doctor
├── cli/app.js              ← UPDATED: routes bootstrap + doctor commands
├── plan/
│   ├── generate.js         ← NEW: plan generation logic (443 lines)
│   ├── render.js           ← NEW: markdown + artifact persistence (89 lines)
│   └── index.js            ← SIMPLIFIED: CLI command + re-exports (64 lines)
├── scanner/index.js        ← UPDATED: hardened glob engine
├── snapshot/index.js       ← UPDATED: defensive stat + batch constant
├── storage/
│   ├── backends.js         ← NEW: backend implementations (152 lines)
│   ├── secrets.js          ← NEW: secret scan + retry queue (101 lines)
│   ├── sync.js             ← NEW: artifact sync/pull logic (171 lines)
│   └── index.js            ← SIMPLIFIED: CLI commands + re-exports (201 lines)
tests/
├── bootstrap.test.js       ← NEW: 10 end-to-end bootstrap/doctor tests
├── glob.test.js            ← NEW: 18 targeted glob edge-case tests
└── perf.test.js            ← NEW: 4 performance benchmark tests
```

---

## Files Modified

| File | Change | Description |
|------|--------|-------------|
| `src/bootstrap/index.js` | **Added** | `ctx bootstrap` (init→snapshot→prompt→site) and `ctx doctor` (9 health checks) |
| `src/cli/app.js` | Modified | Routes `bootstrap` and `doctor` commands, updated help text |
| `src/plan/generate.js` | **Added** | Plan generation logic extracted from monolithic `index.js` |
| `src/plan/render.js` | **Added** | Markdown rendering and artifact persistence |
| `src/plan/index.js` | Simplified | Now just CLI command + re-exports (674→64 lines) |
| `src/storage/backends.js` | **Added** | File, local, mock HF, and HF backend implementations |
| `src/storage/secrets.js` | **Added** | Secret scanning and retry queue management |
| `src/storage/sync.js` | **Added** | Artifact enumeration, sync, and pull logic |
| `src/storage/index.js` | Simplified | Now just CLI commands + re-exports (632→201 lines) |
| `src/scanner/index.js` | Modified | Hardened glob engine with brackets, nested braces, safety limits |
| `src/snapshot/index.js` | Modified | Defensive statSync, FINGERPRINT_BATCH_SIZE constant |
| `docs/12-architecture-rules.md` | **Added** | Full config schema reference for architecture rules |
| `tests/bootstrap.test.js` | **Added** | 10 end-to-end tests for bootstrap and doctor |
| `tests/glob.test.js` | **Added** | 18 tests for glob edge cases (brackets, braces, limits) |
| `tests/perf.test.js` | **Added** | 4 performance benchmarks at 100/200/500 files |
| `README.md` | Modified | Updated MVP promise section |
| `src/cli/main.ts` | **Deleted** | Dead TypeScript scaffold (superseded by `main.js` + `app.js`) |
| `tsconfig.json` | **Deleted** | Dormant config (no `.ts` files remain) |

---

## Testing

| Suite | Tests | What's covered |
|-------|-------|---------------|
| `tests/bootstrap.test.js` | 10 | End-to-end: `ctx bootstrap` with flags, `ctx doctor` checks, `--json` output, exit codes |
| `tests/glob.test.js` | 18 | Bracket classes `[abc]`, ranges `[a-z]`, negation `[!x]`, nested braces `{a,{b,c}}`, unclosed literals, long patterns, real directory walks |
| `tests/perf.test.js` | 4 | 100-file repo (<5s), 500-file repo (<10s), incremental cache hit (<3s), artifact count correctness |
| **Existing suites** | 54 | Snapshot, audit, site, storage, hooks, CI, rules, plan — all unchanged, all passing |
| **Total** | **86** | **All passing** |

Run with:
```bash
node --test
```

---

## Breaking Changes

**None.** All public imports remain backward-compatible via re-exports. CLI interface is unchanged (new commands are additive).

---

## Additional Notes

- The glob engine now handles the full set of standard glob features: `*`, `**`, `?`, `[abc]`, `[a-z]`, `[!x]`, `{a,b,c}`, and nested braces — with graceful degradation for malformed patterns.
- The `FINGERPRINT_BATCH_SIZE = 200` constant marks where a future async refactor could insert `await new Promise(setImmediate)` to yield control between batches. The current sync approach benchmarks well at 500 files (~127ms), but repos with 10k+ files would benefit from an async migration.
- `ctx doctor` is designed for CI: `ctx doctor --json` outputs machine-readable diagnostics and exits `1` on `bad` checks, making it suitable for GitHub Actions health gates.
