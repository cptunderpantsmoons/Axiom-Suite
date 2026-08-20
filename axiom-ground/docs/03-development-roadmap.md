# 03 — Development Roadmap

## Development philosophy

Build in this order:

1. deterministic artifacts,
2. reliable diffs,
3. prompt compilation,
4. audit rules,
5. human-readable HTML,
6. automation,
7. remote sync,
8. planning.

Planning comes later because reliable planning depends on reliable snapshots and audits.

## Phase gate zero (mandatory before implementation)

Before coding build phases, lock these eight specs as implementation contracts:

- `docs/specs/11-snapshot-canonicalization-and-hash.md`
- `docs/specs/12-file-classification-and-exclusion.md`
- `docs/specs/13-secret-scanning-policy.md`
- `docs/specs/14-audit-scoring-versioning.md`
- `docs/specs/15-incremental-snapshot-invalidation.md`
- `docs/specs/16-alpha-ecosystem-support-boundary.md`
- `docs/specs/17-ai-change-guardrails.md`
- `docs/specs/18-guardrail-ci-checklist.md`

No build phase is considered started until these are acknowledged in planning and test design.

## Anti-drift execution model

### Core rule

Implementation must conform to specs. Changes are allowed only by explicit decision, not accidental drift.

### Change classes

1. **Conformance fix**: code changes to match existing spec (no spec change required).
2. **Spec improvement**: intentional behavior change that improves reliability/usability/security.
3. **Scope expansion**: support boundary widening (new ecosystem/rules/behavior class).

### Required controls by class

- **Conformance fix**
  - Add/adjust fixture tests proving conformance.
  - No version bump unless output format/algorithm changes.
- **Spec improvement**
  - Update spec file(s) in same PR.
  - Bump relevant version fields.
  - Add migration note if artifact compatibility changes.
- **Scope expansion**
  - Update `16-alpha-ecosystem-support-boundary.md`.
  - Add explicit non-goals to avoid accidental broadening.
  - Add at least one new fixture per newly supported ecosystem.

### Merge gates for behavior-changing work

A behavior-changing change cannot merge unless all are true:

- Spec link included in PR description.
- Before/after artifact diff attached.
- Determinism check rerun twice with identical output.
- Security check confirms no secret leakage regression.
- Reviewer explicitly marks change as `conformance` or `intentional_spec_change`.

### Regression prevention gates

At minimum CI must include:

- Snapshot determinism replay test.
- Exclude/classification fixture suite.
- Secret scanning fixture suite.
- Audit scoring reproducibility test.
- Incremental/full snapshot equivalence test.
- Support-boundary assertion test (unsupported ecosystems yield partial support, not silent assumptions).

### Drift escalation policy

If runtime behavior is discovered to differ from spec:

1. Label issue `spec-drift`.
2. Freeze related feature expansion until resolved.
3. Choose one path explicitly:
   - fix code to match spec, or
   - update spec + version bump + migration note.
4. Add a regression fixture before closing.

---

# Phase 0 — Prototype skeleton

## Goal

Create a working CLI that can initialize a repo and emit a basic snapshot.

## Commands

```bash
ctx init
ctx snapshot
```

## Deliverables

- `.contextlock/config.json`
- `.contextlock/lock.json`
- `.contextlock/snapshots/{hash}.json`
- `.contextlock/snapshots/{hash}.md`

## Snapshot should include

- repo root,
- current branch,
- current commit,
- file count,
- language guesses,
- manifest files,
- README/docs files,
- test/build commands if detectable,
- TODO/FIXME/HACK list.

## Acceptance criteria

- runs in any Git repo,
- ignores `.git`, `node_modules`, `dist`, build outputs,
- snapshot hash changes when meaningful files change,
- snapshot can be regenerated without crashing.

---

# Phase 1 — Real snapshot compiler

## Goal

Make snapshots useful enough to onboard an AI.

## Add extraction for

- package manifests,
- scripts/commands,
- dependency names,
- likely entrypoints,
- test directories,
- documentation map,
- recent commit messages,
- changed files since previous snapshot,
- risk markers.

## Add snapshot layers

```json
{
  "machine_facts": {},
  "inferred_context": {},
  "human_annotations": {},
  "volatile_state": {}
}
```

## Acceptance criteria

- `snapshot.md` is readable and useful as AI context,
- `snapshot.json` is stable and diffable,
- generated files do not include secret values,
- large files are summarized or skipped.

---

# Phase 2 — Prompt cache

## Goal

Compile prompts from snapshots.

## Commands

```bash
ctx prompt onboarding
ctx prompt bugfix
ctx prompt review
ctx prompt refactor
```

## Deliverables

```txt
.contextlock/prompts/{snapshot_hash}/onboarding.md
.contextlock/prompts/{snapshot_hash}/bugfix.md
.contextlock/prompts/{snapshot_hash}/review.md
.contextlock/prompts/{snapshot_hash}/refactor.md
```

## Prompt rules

Every prompt must include:

- snapshot hash,
- source commit,
- project summary,
- architecture summary,
- relevant commands,
- known risks,
- constraints,
- expected output format.

## Acceptance criteria

- prompts are regenerated only when snapshot hash changes,
- prompt metadata points to exact snapshot,
- stale prompts can be detected.

---

# Phase 3 — Drift auditing MVP

## Goal

Detect meaningful drift between snapshots.

## Commands

```bash
ctx audit
ctx audit --since-last
```

## Detect first

- README/package command mismatch,
- manifest dependency changes,
- TODO/HACK count changes,
- tests removed or reduced,
- docs changed without code or code changed without docs,
- new files in risky directories,
- stale prompt cache.

## Outputs

```txt
.contextlock/audits/{from_hash}_to_{to_hash}.json
.contextlock/audits/{from_hash}_to_{to_hash}.md
```

## Acceptance criteria

- produces severity-ranked findings,
- includes file paths and evidence,
- computes a drift score,
- distinguishes changed facts from inferred risks.

---

# Phase 4 — Human-readable HTML site

## Goal

Generate a static developer onboarding site from ContextLock artifacts.

## Commands

```bash
ctx site build
ctx site open
ctx site export <dir>
```

## Deliverables

```txt
.contextlock/site/index.html
.contextlock/site/snapshot.html
.contextlock/site/architecture.html
.contextlock/site/prompts.html
.contextlock/site/audit.html
.contextlock/site/claims.html
```

## Acceptance criteria

- site is static and opens offline,
- dashboard shows snapshot, prompt, and audit status,
- onboarding page explains how to run/test/navigate the project,
- stale prompts and high-severity drift are visually obvious,
- generated from JSON/Markdown artifacts, not separately maintained.

---

# Phase 5 — Automation

## Goal

After `ctx init`, ContextLock runs without continued human interaction.

## Add

```bash
ctx daemon start
ctx daemon stop
ctx hooks install
```

## Git hooks

Start with one hook:

```txt
post-commit
```

Post-commit should run:

```bash
ctx snapshot --incremental
ctx audit --since-last
ctx prompt refresh --changed
```

## Later hooks

- post-checkout,
- post-merge,
- pre-push,
- pre-commit optional warning mode.

## Acceptance criteria

- automation never blocks commits by default,
- failures are logged, not destructive,
- generated artifacts are deterministic,
- daemon debounces file changes.

---

# Phase 6 — Hugging Face remote backend

## Goal

Sync snapshots, prompts, audits, and lock metadata to Hugging Face.

## Commands

```bash
ctx remote add hf username/project-context-cache
ctx sync
ctx pull
```

## Acceptance criteria

- local-first operation works without network,
- sync is idempotent,
- credentials come from environment variables,
- remote lockfile points to latest known artifacts,
- artifacts are content-addressed by hash.

---

# Phase 7 — CI integration

## Goal

Run audits automatically on pull requests.

## Deliverables

- GitHub Action template,
- GitLab CI template,
- PR audit markdown report.

## Acceptance criteria

- CI can compare base branch snapshot to PR snapshot,
- outputs markdown summary,
- optional failure threshold is configurable.

---

# Phase 8 — Rule engine and architecture contracts

## Goal

Let projects define explicit architectural rules.

## Example

```json
{
  "rules": [
    {
      "id": "api-no-db-direct",
      "description": "API layer must not import database client directly",
      "match": "src/api/**",
      "forbid_imports": ["src/db/**"],
      "severity": "high"
    }
  ]
}
```

## Acceptance criteria

- rules run in audit,
- findings include evidence,
- rule format is documented,
- false positives can be suppressed with expiration dates.

---

# Phase 9 — Planning engine

## Goal

Add project planning only after snapshot + audit are trustworthy.

## Commands

```bash
ctx plan feature
ctx plan refactor
ctx plan release
```

## Planning output

- task graph,
- affected modules,
- required tests,
- audit checkpoints,
- rollback plan,
- prompt pack references.

## Acceptance criteria

- plans cite snapshot facts,
- plans include acceptance criteria,
- plans are auditable after implementation.

---

# Recommended build order summary

1. `ctx init`
2. `ctx snapshot`
3. `snapshot.md` quality
4. `ctx prompt onboarding`
5. `ctx audit --since-last`
6. `ctx site build`
7. post-commit automation
8. Hugging Face sync
9. CI audit
10. rules/contracts
11. planning engine
