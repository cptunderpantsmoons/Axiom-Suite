# 09 — Human-Readable HTML Layer

## Decision

ContextLock should generate a human-readable HTML onboarding layer alongside JSON and Markdown artifacts.

The JSON is for machines. The Markdown is for prompts and plain-text portability. The HTML is for developers, reviewers, managers, and new contributors who need to understand the project quickly without reading raw artifact files.

## Why this matters

A context tool cannot be only machine-readable. If humans cannot inspect, trust, and navigate the generated context, they will not rely on it.

The HTML layer turns ContextLock from a hidden automation utility into an onboarding surface.

## Core principle

The HTML site must be generated from the same source artifacts as JSON and Markdown.

```txt
Repo State
  ↓
snapshot.json
  ↓
snapshot.md
  ↓
context.html
```

Do not maintain separate human docs manually. The HTML view is a rendered projection of ContextLock artifacts.

## Output location

Recommended local layout:

```txt
.contextlock/
  site/
    index.html
    snapshot.html
    architecture.html
    prompts.html
    audit.html
    drift.html
    claims.html
    progress.html
    plans.html
    assets/
      contextlock.css
      contextlock.js
```

Optional static export:

```bash
ctx site build
ctx site open
ctx site export ./contextlock-site
```

## MVP HTML pages

### 1. Dashboard

`index.html`

Should show:

- project name,
- current branch,
- current commit,
- latest snapshot hash,
- latest drift score,
- prompt cache status,
- last sync status,
- top risks,
- stale areas.

Example sections:

```txt
Project Health
Snapshot Status
Prompt Cache Status
Latest Drift Findings
Recommended Next Actions
```

### 2. Project Snapshot

`snapshot.html`

Human-readable version of `snapshot.json` and `snapshot.md`.

Should show:

- project summary,
- languages,
- frameworks/tools detected,
- entrypoints,
- build/test commands,
- important files,
- module map,
- documentation map,
- debt markers.

### 3. Architecture View

`architecture.html`

Should show:

- inferred architecture layers,
- module boundaries,
- dependency map,
- risky imports,
- declared architecture rules,
- boundary violations.

V1 can render this as tables and nested lists. Later versions can add graphs.

### 4. Prompt Cache View

`prompts.html`

Should show:

- available prompt types,
- snapshot hash for each prompt,
- freshness status,
- dependencies,
- created time,
- direct links to prompt files.

Important visual distinction:

```txt
Fresh
Stale
Missing
Regeneration recommended
```

### 5. Drift Audit View

`audit.html`

Should show:

- drift score,
- severity breakdown,
- findings by category,
- evidence snippets,
- recommended actions,
- stale prompts,
- changed assumptions.

### 6. Claim Ledger View

`claims.html`

Should show extracted project claims:

- claim text,
- source file,
- evidence status,
- supporting evidence,
- contradicting evidence,
- confidence,
- last verified snapshot.

This could become one of the strongest onboarding features.

### 7. Plans View

`plans.html`

Renders every generated `ctx plan` artifact with its quality gates and detailed tasks:

- plan summary, snapshot hash, drift score, and validation summary,
- **whole-plan quality gates** — the definition of done for the plan,
- **per-task gates** — named, command-backed checkpoints each task must pass,
- **detailed steps** — the ordered sub-steps for executing each task,
- acceptance criteria and rollback criteria per task.

Gates render as checkbox checklists with their command and description, so a plan is auditable at a glance without reading raw JSON. Checkboxes are interactive and persisted in `localStorage` (via `assets/contextlock.js`), keyed by plan id, task id, and gate name, so checked-off gates survive a page reload without a backend. Each plan section shows a live `done/total` gate-completion counter and a filling progress bar that update as checkboxes toggle, plus a per-plan "Clear checked gates" button that resets that plan's progress. The summary table links each plan id to its section via in-page anchors.

## HTML artifact model

Add to `lock.json`:

```json
{
  "latest_site": {
    "site_hash": "ctxsite_123",
    "snapshot_hash": "ctxsnap_789",
    "index_path": ".contextlock/site/index.html",
    "generated_at": "2026-05-16T00:00:00Z"
  }
}
```

Add site metadata:

```json
{
  "schema_version": 1,
  "artifact_type": "site",
  "site_hash": "ctxsite_123",
  "project_id": "ctxproj_abc123",
  "snapshot_hash": "ctxsnap_789",
  "audit_id": "audit_456",
  "generated_at": "2026-05-16T00:00:00Z",
  "pages": [
    "index.html",
    "snapshot.html",
    "architecture.html",
    "prompts.html",
    "audit.html",
    "claims.html"
  ]
}
```

## CLI additions

```bash
ctx site build
ctx site open
ctx site export <dir>
ctx site serve
```

### `ctx site build`

Generates static HTML from current artifacts.

### `ctx site open`

Opens `.contextlock/site/index.html` in the default browser.

### `ctx site export <dir>`

Copies the static site to a shareable directory.

### `ctx site serve`

Starts a local read-only server.

```bash
ctx site serve --port 4123
```

## Automation integration

Post-commit automation should eventually include:

```bash
ctx site build --quiet
```

Recommended order:

```bash
ctx snapshot --incremental --quiet
ctx audit --since-last --quiet
ctx prompt refresh --changed --quiet
ctx site build --quiet
ctx sync --quiet
```

## Hugging Face storage

HTML can also be synced as static artifacts:

```txt
/{project_id}/site/{site_hash}/index.html
/{project_id}/site/{site_hash}/snapshot.html
/{project_id}/site/{site_hash}/architecture.html
/{project_id}/site/{site_hash}/prompts.html
/{project_id}/site/{site_hash}/audit.html
/{project_id}/site/{site_hash}/claims.html
/{project_id}/site/latest.json
```

This allows a remote human-readable context packet to exist alongside machine artifacts.

## Design requirements

The HTML layer should be:

- static,
- dependency-light,
- readable offline,
- easy to archive,
- safe to share when configured,
- generated deterministically,
- visually obvious when stale.

## Do not build first

Avoid starting with a complex dashboard app.

V1 should be static HTML with minimal CSS and optional tiny JavaScript for filtering/search.

No database. No login system. No backend server required.

## Recommended visual model

Use a simple project health cockpit:

```txt
┌─────────────────────────────────────────┐
│ ContextLock                             │
│ Project: my-app                         │
│ Branch: main                            │
│ Snapshot: ctxsnap_789                   │
│ Drift Score: 38/100                     │
│ Prompt Cache: 2 stale, 4 fresh          │
└─────────────────────────────────────────┘

High Priority
- README test command mismatch
- Auth prompt stale after session rewrite
- API layer imports database client directly

Onboarding
- How to run
- How to test
- Main entrypoints
- Architecture map
- Known debt
```

## Elevation opportunity: onboarding mode

Add a dedicated page for new developers:

`onboarding.html`

It should answer:

1. What does this project do?
2. How do I run it?
3. How do I test it?
4. What files should I read first?
5. What areas are risky?
6. What should I not change casually?
7. What is currently stale or contradictory?
8. What prompts can I hand to an AI assistant?

This page could be one of the most valuable artifacts in the product.

## Elevation opportunity: shareable handoff bundle

Add:

```bash
ctx bundle onboarding
```

Outputs:

```txt
contextlock-onboarding-{snapshot_hash}.zip
  site/
  snapshot.json
  snapshot.md
  prompts/
  audits/
```

This becomes a portable AI + human handoff packet.

## Strategic value

The HTML layer makes ContextLock useful even when no AI is involved.

That matters because it broadens adoption:

- developers use it for onboarding,
- reviewers use it for PR context,
- leads use it for drift visibility,
- AI agents use the JSON/prompt artifacts.

The best version of ContextLock is not only AI memory. It is project continuity infrastructure.
