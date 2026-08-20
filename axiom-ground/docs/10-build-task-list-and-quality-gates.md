# 10 — Build Task List and Strict Quality Gates

This document breaks the 11 recommended builds into concrete tasks and strict quality gates. A phase should not be considered complete until every gate passes.

## Global quality rules

These apply to every build phase.

### Mandatory engineering gates

- CLI commands must return deterministic exit codes.
- Generated artifacts must be valid JSON/Markdown/HTML as applicable.
- No command may destroy user files without explicit confirmation.
- `.contextlock/` output must be excluded from its own scans.
- Secrets must never be copied into snapshots, prompts, audits, site output, or remote storage.
- Every artifact must include schema version, project id, creation timestamp, source commit where available, and artifact hash where applicable.
- Every user-facing error must include a recovery action.
- Every phase must include at least one fixture repo test.
- Key commands must support machine-readable output through `--format=json` or equivalent.
- Semantic fingerprints must normalize line endings where appropriate to avoid CRLF-only drift.
- Large and binary files must be skipped, fingerprinted, or streamed rather than read fully into memory.

### Definition of done for any command

A command is not done until it has:

- help text,
- success output,
- quiet mode if used by automation,
- JSON output option where relevant,
- nonzero failure exit code,
- test coverage for success and failure cases,
- documented artifact outputs.

---

# Build 1 — `ctx init`

## Goal

Initialize ContextLock in any Git repository with safe defaults.

## Tasks

- Create CLI entrypoint.
- Implement repo root detection.
- Detect whether current directory is inside a Git repo.
- Create `.contextlock/` directory structure.
- Write `.contextlock/config.json`.
- Write initial `.contextlock/lock.json`.
- Add default include/exclude patterns.
- Add `--yes` non-interactive mode.
- Add `--force` guarded reinitialization mode.
- Add `ctx status` minimal output.
- Document generated files.

## Required output

```txt
.contextlock/
  config.json
  lock.json
  snapshots/
  prompts/
  audits/
  site/
  cache/
  queue/
  logs/
```

## Strict quality gates

- Running `ctx init` twice must not corrupt existing config.
- Running outside a Git repo must fail clearly unless `--no-git` is explicitly supported.
- Generated config must be valid JSON.
- Generated lockfile must be valid JSON.
- `.contextlock/` must be included in default excludes.
- Command must complete in under 2 seconds on a small repo.
- No network calls are allowed during init unless user explicitly configures remote sync.
- Test fixture: empty Git repo.
- Test fixture: Node repo.
- Test fixture: Python repo.

---

# Build 2 — `ctx snapshot`

## Goal

Generate the first machine-readable and human-readable project snapshot.

## Tasks

- Implement file walker with exclude handling.
- Detect Git branch, commit, dirty state.
- Detect languages by file extensions and manifests.
- Detect manifests: `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, etc.
- Detect README/docs files.
- Detect basic test/build commands from manifests.
- Extract TODO/FIXME/HACK comments.
- Generate `snapshot.json`.
- Generate `snapshot.md`.
- Compute snapshot hash.
- Update `lock.json`.
- Add `ctx snapshot --full`.
- Add `ctx snapshot --json`.

## Strict quality gates

- Snapshot JSON must validate against schema.
- Snapshot hash must be stable for unchanged repo state.
- Snapshot hash must change when meaningful source files change.
- Snapshot must not include contents of excluded directories.
- Snapshot must not include secret-looking values from `.env` or credential files.
- Large files must be skipped, streamed, or summarized, not embedded raw.
- Binary files must be fingerprinted or skipped without full text reads.
- CRLF-only changes must not create semantic snapshot drift unless configured.
- Command must complete in under 10 seconds on a repo with 5,000 files excluding vendor/build folders.
- Test fixture: repo with `node_modules` verifies exclusion.
- Test fixture: repo with TODO markers verifies extraction.
- Test fixture: dirty working tree verifies dirty state.

---

# Build 3 — `snapshot.md` quality

## Goal

Make the Markdown snapshot genuinely useful for AI and human onboarding.

## Tasks

- Design readable `snapshot.md` template.
- Add project summary section.
- Add run/test/build command section.
- Add entrypoints section.
- Add module/directory map.
- Add docs map.
- Add known debt markers.
- Add detected risks.
- Add recent git context.
- Add “files to read first” section.
- Add “do not assume” section when contradictions/unknowns exist.

## Strict quality gates

- `snapshot.md` must be under a configurable size limit by default.
- Must include source commit and snapshot hash at top.
- Must clearly distinguish known facts from inferred context.
- Must include enough information to onboard an AI without reading raw JSON.
- Must avoid dumping huge file trees.
- Must produce stable section ordering.
- Manual review gate: snapshot from three fixture repos must be understandable in under 5 minutes.
- AI prompt gate: feeding only `snapshot.md` to an AI should let it answer how to run/test the fixture project correctly.

---

# Build 4 — `ctx prompt onboarding`

## Goal

Compile snapshot-derived prompts tied to exact snapshot hashes.

## Tasks

- Create prompt compiler module.
- Implement onboarding prompt template.
- Include snapshot hash and source commit.
- Include project summary, commands, entrypoints, risks, constraints.
- Include AI instructions for avoiding assumptions.
- Write prompt markdown to `.contextlock/prompts/{snapshot_hash}/onboarding.md`.
- Write prompt metadata JSON.
- Add stale/fresh prompt detection.
- Add `ctx prompt onboarding --stdout`.

## Strict quality gates

- Prompt must reference an existing snapshot hash.
- Prompt must not regenerate if identical snapshot already has valid prompt.
- Prompt metadata must validate against schema.
- Prompt must include explicit task boundary: onboarding only, no code changes unless asked.
- Prompt must include known risks and unknowns.
- Prompt must be deterministic for same snapshot/template version.
- Stale prompt detection must trigger when snapshot hash changes.
- Test fixture: prompt generated from snapshot includes correct run/test command.

---

# Build 5 — `ctx audit --since-last`

## Goal

Detect meaningful drift between snapshots.

## Tasks

- Implement snapshot comparison engine.
- Create audit artifact schema.
- Add drift scoring.
- Add finding severity levels.
- Detect stale prompt cache.
- Detect TODO/FIXME/HACK count changes.
- Detect manifest and dependency changes.
- Detect README/package command mismatch.
- Detect tests removed or source changed without tests.
- Generate `audit.json` and `audit.md`.
- Add `ctx audit --from <hash> --to <hash>`.

## Strict quality gates

- Audit must always cite evidence with file paths.
- Drift score must be explainable from findings.
- Audit must not claim certainty when only heuristic evidence exists.
- Audit must distinguish high/medium/low severity.
- Audit JSON must validate against schema.
- Audit artifact must include `schema_version` and `artifact_type`.
- Audit scoring must handle null, undefined, or empty findings safely.
- Audit must handle missing previous snapshot gracefully.
- False positives from generated/vendor files must be excluded.
- Test fixture: changed README command produces documentation drift finding.
- Test fixture: changed source without changed tests produces test drift warning.
- Test fixture: new TODO produces debt drift finding.

---

# Build 6 — `ctx site build`

## Goal

Generate a static human-readable HTML onboarding and audit site.

## Tasks

- Create static site generator.
- Create base HTML layout.
- Create CSS theme.
- Generate dashboard `index.html`.
- Generate `snapshot.html`.
- Generate `architecture.html`.
- Generate `prompts.html`.
- Generate `audit.html`.
- Generate `claims.html` placeholder if claim ledger not implemented yet.
- Add `ctx site open`.
- Add `ctx site export <dir>`.
- Add site metadata JSON.

## Strict quality gates

- Site must be fully static and open offline.
- HTML must be generated from artifacts, not separate manual docs.
- Dashboard must show snapshot hash, commit, prompt status, and drift score.
- Stale prompts and high-severity findings must be visually obvious.
- Site must not include secrets or excluded file contents.
- Site must work with JavaScript disabled.
- Site generation must be deterministic for same artifact inputs.
- HTML must pass basic validity checks.
- Test fixture: generated site links to all expected pages.

---

# Build 7 — Post-commit automation

## Goal

Keep snapshots, prompts, audits, and site current without continued human interaction.

## Tasks

- Implement `ctx hooks install`.
- Install post-commit hook safely.
- Preserve existing user hook by chaining or wrapper strategy.
- Add `ctx hooks uninstall`.
- Add quiet mode for automation commands.
- Add automation logs.
- Add failure-safe behavior.
- Run post-commit sequence:

```bash
ctx snapshot --incremental --quiet
ctx audit --since-last --quiet
ctx prompt refresh --changed --quiet
ctx site build --quiet
```

## Strict quality gates

- Hook must not block commit by default.
- Hook must exit 0 on ContextLock internal failure unless configured as strict.
- Existing Git hooks must not be overwritten silently.
- Automation failures must be logged.
- Hook must not create infinite commit loops.
- Hook must not include `.contextlock/` generated artifacts in snapshot unless configured.
- Test fixture: post-commit creates a new snapshot.
- Test fixture: failing audit logs error but commit succeeds.

---

# Build 8 — Hugging Face sync

## Goal

Sync versioned artifacts to Hugging Face as a remote context cache.

## Tasks

- Implement storage backend interface.
- Implement local backend explicitly.
- Implement Hugging Face backend.
- Add `ctx remote add hf <repo>`.
- Add `ctx sync`.
- Add `ctx pull`.
- Add remote lockfile support.
- Add retry queue for failed uploads.
- Add secret scanning before upload.
- Add `auto_sync` config.

## Strict quality gates

- ContextLock must work fully without network.
- Sync must be idempotent.
- Credentials must come from environment variable, not config plaintext.
- Failed sync must not corrupt local state.
- Remote `latest.json` must update only after artifact uploads complete.
- Same hash must never be overwritten with different content.
- Secret scan must run before upload.
- Test fixture: mocked HF backend upload.
- Test fixture: network failure creates retry queue item.

---

# Build 9 — CI audit

## Goal

Run ContextLock automatically in pull requests and report drift.

## Tasks

- Create GitHub Action template.
- Create GitLab CI example.
- Add `ctx snapshot --ci`.
- Add `ctx audit --pr`.
- Detect base branch snapshot when available.
- Generate PR markdown report.
- Add configurable fail threshold.
- Add artifact upload option.

## Strict quality gates

- CI must run without interactive prompts.
- CI output must be readable in PR logs.
- PR report must include drift score and top findings.
- CI must not require HF credentials unless sync is enabled.
- Fail threshold must be opt-in or clearly configured.
- Must handle shallow checkout with actionable error or fetch guidance.
- Test fixture: simulated PR diff produces audit markdown.
- Test fixture: threshold exceeded returns nonzero exit code only when strict mode is enabled.

---

# Build 10 — Rules/contracts

## Goal

Let projects define explicit architectural contracts that audits can enforce.

## Tasks

- Add `architecture_rules` to config schema.
- Implement simple path match rules.
- Implement forbidden import rules.
- Implement required file/touch rules.
- Add severity configuration.
- Add suppression model with expiration.
- Add `ctx rules validate`.
- Add rule findings to audit output.
- Add rule findings to HTML site.

## Strict quality gates

- Invalid rules must fail validation with clear errors.
- Rule findings must include exact evidence.
- Suppressions must require reason and expiration date.
- Expired suppressions must become findings.
- Rule engine must not scan excluded files.
- Path matching must behave consistently across operating systems.
- Test fixture: API imports DB directly triggers rule.
- Test fixture: active suppression hides finding.
- Test fixture: expired suppression produces high-severity finding.

---

# Build 11 — Planning engine

## Goal

Generate auditable project plans from snapshots, audits, and rules.

## Tasks

- Add `ctx plan feature`.
- Add `ctx plan refactor`.
- Add `ctx plan release`.
- Define plan artifact schema.
- Generate task graph.
- Include affected modules.
- Include required tests.
- Include audit checkpoints.
- Include rollback plan.
- Reference relevant prompts.
- Add `ctx audit --against-plan <plan_id>`.

## Strict quality gates

- Plans must cite snapshot facts and audit findings.
- Plans must not invent files/modules not present unless marked as proposed.
- Every task must have acceptance criteria.
- Every task must have expected touched areas.
- Every plan must include validation commands.
- Every plan must include rollback/abort criteria.
- Plan output must be JSON and Markdown.
- Plan must be auditable after implementation.
- Test fixture: feature plan references correct modules and tests.
- Test fixture: audit against plan detects missing test task.

---

# Plan-generated quality gates

`ctx plan` (Build 11) embeds the same gate discipline into every generated plan artifact (`schema_version: 2`):

- **Whole-plan gates** (`plan.quality_gates`) — the definition of done for the entire plan, derived from the project's detected commands: tests pass, no new high-severity drift, secret scan passes, determinism preserved, and build succeeds (when a build command exists).
- **Per-task gates** (`task.quality_gates`) — named, command-backed checkpoints that must pass before that task is complete (e.g. `Baseline recorded`, `TDD red confirmed`, `No new debt markers`, `No architecture rule violations`, `Docs match reality`).
- **Detailed tasks** (`task.steps`) — each task breaks down into granular, ordered sub-steps with concrete commands.
- **Enforcement** — `ctx audit --against-plan` emits a low-severity `plan-task-ungated` finding for any task that lacks quality gates and a `plan-task-undetailed` finding for any task without steps, so a task cannot silently ship without its gates being checkable.

A task should not be considered done until its `quality_gates` all pass; a plan should not be considered complete until the whole-plan gates pass.

---

# Release readiness checklist

Before any public release:

- All commands documented.
- Schemas versioned.
- Fixture repo test suite passing.
- Secret exclusion tested.
- Artifacts deterministic across repeated runs.
- HTML site generated successfully.
- No network required for core workflow.
- HF sync tested with mock backend and real dry run.
- CI template validated in a real repository.
- README includes quickstart and artifact examples.

## Minimum public alpha scope

The smallest credible alpha is builds 1 through 6:

1. init,
2. snapshot,
3. readable snapshot,
4. onboarding prompt,
5. audit,
6. HTML site.

Do not market automation or remote sync until builds 7 and 8 pass their gates.
