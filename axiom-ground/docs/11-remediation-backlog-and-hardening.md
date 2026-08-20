# 11 — Remediation Backlog and Hardening Items

This document captures minor implementation issues, architectural recommendations, feature gaps, and performance optimizations that should be addressed before beta-quality release.

## Priority policy

Even low-severity items should be tracked because ContextLock's value depends on trust. Small inconsistencies in artifacts, scoring, or CLI behavior undermine confidence in the generated context layer.

## Remediation tiers

- **P0** — blocks alpha correctness or corrupts artifacts.
- **P1** — required before public alpha.
- **P2** — required before beta.
- **P3** — polish/performance improvement.

---

# Code Issues

## 1. Null handling in `scoreAudit`

- **Location:** `src/audit/index.js:201`
- **Severity:** Low
- **Priority:** P1

### Problem

`scoreAudit` assumes `findings` is always present and array-like.

### Required fix

Use safe fallback handling:

```js
const safeFindings = Array.isArray(findings) ? findings : []
const highCount = safeFindings.filter(f => f.severity === 'high').length
```

or:

```js
const highCount = findings?.filter(f => f.severity === 'high').length ?? 0
```

### Quality gate

- `scoreAudit(null)` must not throw.
- `scoreAudit(undefined)` must not throw.
- `scoreAudit([])` must return a valid score.
- Invalid findings must be ignored or converted into explicit validation errors.

---

## 2. Missing `schema_version` in audit artifacts

- **Location:** `src/audit/index.js:256-270`
- **Severity:** Low
- **Priority:** P1

### Problem

Audit artifacts must include schema version for long-term compatibility.

### Required fix

Every audit object must include:

```js
{
  schema_version: 1,
  artifact_type: 'audit'
}
```

### Quality gate

- Every generated audit JSON validates against the audit schema.
- Audit snapshots from older schema versions can be detected.
- Missing `schema_version` fails artifact validation.

---

## 3. Hard-coded severity weights

- **Location:** `src/audit/index.js:188-199`
- **Severity:** Low
- **Priority:** P2

### Problem

Hard-coded drift scoring makes tuning difficult and prevents project-specific weighting.

### Required fix

Move weights into config/spec defaults:

```json
{
  "audit": {
    "severity_weights": {
      "high": 25,
      "medium": 10,
      "low": 3,
      "stale_prompt": 8,
      "expired_suppression": 15
    }
  }
}
```

### Quality gate

- Defaults work without config.
- Project config can override weights.
- Invalid weights fail validation.
- Audit report includes scoring breakdown.

---

## 4. Inconsistent glob patterns

- **Location:** `src/scanner/index.js:10-20`
- **Severity:** Low
- **Priority:** P1

### Problem

Some patterns use `/**` while others do not, creating inconsistent matching behavior.

### Required fix

Normalize all include/exclude patterns through a single glob utility.

Example convention:

```txt
node_modules/**
dist/**
build/**
.git/**
.contextlock/**
```

### Quality gate

- Exclusion rules behave identically across Linux/macOS/Windows path separators.
- Directory exclusions exclude all descendants.
- Tests cover both `dir` and `dir/**` input normalization.

---

## 5. Binary file handling reads entire file

- **Location:** `src/scanner/index.js:135-136`
- **Severity:** Low
- **Priority:** P2

### Problem

Reading entire binary or large files can cause memory issues on large repos.

### Required fix

Detect binary and large files before full read.

Rules:

- files over 100KB should be streamed or sampled,
- binary files should be fingerprinted, not read as text,
- known binary extensions should be skipped early,
- content extraction should be size-limited.

### Quality gate

- Scanner does not load files over configured threshold into memory as full text.
- Binary files are marked as binary and fingerprinted only.
- Large repo fixture does not exceed memory budget.

---

## 6. Missing CRLF equivalence test

- **Location:** Test suite
- **Severity:** Medium
- **Priority:** P1

### Problem

Line-ending differences can produce unstable hashes and noisy drift reports.

### Required fix

Add test fixture with equivalent LF and CRLF files.

### Quality gate

- Equivalent text files with LF and CRLF normalize to same semantic fingerprint where intended.
- Raw content hash may differ, but semantic snapshot hash should not change from line endings alone unless configured.
- Audit should not report drift only because of line-ending conversion.

---

# Architecture Recommendations

## 1. TypeScript config exists but is not used

- **Current:** `tsconfig.json` exists but project appears JavaScript-first.
- **Priority:** P2

### Recommendation

Choose one path:

### Option A — Commit to TypeScript

- Rename core files to `.ts`.
- Add strict or gradually strict compiler settings.
- Emit typed CLI build.
- Type artifact schemas.

### Option B — Remove unused config

- Remove `tsconfig.json` until TypeScript migration starts.
- Use JSDoc typedefs for schema-heavy areas.

### Recommended decision

Use TypeScript for ContextLock long-term. Artifact schemas, storage backends, and audit rules benefit from types.

### Quality gate

- No unused build config in public alpha.
- If TypeScript remains, CI must run `tsc --noEmit`.

---

## 2. Error message standardization

- **Current:** Error messages are good but inconsistent.
- **Priority:** P1

### Required format

All command errors should use:

```txt
ContextLock error: <what failed>
Reason: <why it failed>
Recovery: <what to do next>
Command: <suggested command if applicable>
```

Example:

```txt
ContextLock error: Could not create snapshot
Reason: No Git repository found at current path
Recovery: Run ctx init inside a Git repository or use --no-git if supported
Command: git init && ctx init
```

### Quality gate

- All CLI thrown errors map to standardized output.
- Machine-readable mode emits structured error JSON.

---

## 3. CLI output format consistency

- **Current:** Mix of human-readable and machine-readable output.
- **Priority:** P1

### Required fix

Add common output flag:

```bash
--format text
--format json
```

or:

```bash
--json
```

### Quality gate

- `ctx status --format=json` works.
- `ctx snapshot --format=json` returns artifact metadata.
- Automation uses quiet/json modes, not parsed prose.

---

# Feature Gaps

## 1. CRLF equivalence

- **Status:** Not implemented
- **Priority:** P1

### Required test

Add fixture pairs:

```txt
fixtures/line-endings/lf/README.md
fixtures/line-endings/crlf/README.md
```

### Expected behavior

Semantic snapshot hash should remain equivalent if only line endings differ.

---

## 2. Binary file streaming

- **Status:** Reads all
- **Priority:** P2

### Required behavior

- Stream files over 100KB.
- Skip text extraction over max size.
- Fingerprint large files using streaming hash.

---

## 3. Multi-language support

- **Status:** Node/Python only
- **Priority:** P2

### Add detection for

- Go: `go.mod`, `go.sum`, `*.go`
- Rust: `Cargo.toml`, `Cargo.lock`, `*.rs`

### Quality gate

- Go fixture detects `go test ./...`.
- Rust fixture detects `cargo test` and `cargo build`.

---

# Performance Optimizations

## 1. File fingerprint caching

- **Opportunity:** Avoid rereading unchanged files.
- **Priority:** P2

### Recommendation

Use file path + size + mtime as a fast precheck, then content hash when needed.

### Quality gate

- Incremental snapshot is faster than full snapshot on unchanged repo.
- Cache invalidates when file content changes without relying solely on mtime.

---

## 2. Stream-based processing for large repos

- **Opportunity:** Reduce memory usage.
- **Priority:** P2

### Recommendation

All fingerprinting should support streaming.

### Quality gate

- Snapshot of large fixture repo stays under defined memory threshold.

---

## 3. Glob matching optimization

- **Opportunity:** Avoid recompiling glob patterns repeatedly.
- **Priority:** P3

### Recommendation

Compile include/exclude patterns once per scan.

### Quality gate

- Scanner uses cached matcher object.
- Pattern behavior covered by tests.

---

# Integration into release gates

## Alpha blockers

These must be fixed before public alpha:

- Null-safe audit scoring.
- `schema_version` on audit artifacts.
- Glob normalization.
- CRLF equivalence test.
- Standard error format.
- `--format=json` or `--json` for key commands.

## Beta blockers

These must be fixed before beta:

- Config-driven severity weights.
- Binary/large file streaming.
- Go/Rust detection.
- TypeScript decision finalized.
- Incremental fingerprint cache.

## Not required for alpha

- Full TypeScript migration.
- Advanced graph visualization.
- Complete semantic AST analysis.
- Full multi-language dependency graph extraction.

---

# Recommended immediate patch order

1. Add `schema_version` to audit artifacts.
2. Make `scoreAudit` null-safe.
3. Normalize glob patterns.
4. Add CRLF equivalence tests.
5. Standardize CLI error format.
6. Add `--format=json` for `status`, `snapshot`, and `audit`.
7. Add large/binary file streaming threshold.
8. Move severity weights to config defaults.
9. Add Go/Rust project detection.
10. Decide TypeScript migration path.
