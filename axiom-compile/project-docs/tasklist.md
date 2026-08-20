# Axiom — Development Task List

> Created by the Senior Project Manager from the locked decisions, the M0–M8
> milestone plan, and the §5 pipeline module map of `PLAN.md`. Exact-requirements,
> no invented luxury features. Pass 1 targets the plan's recommended first task:
> scaffold the **Tauri app + headless core skeleton (M0/M1)**.

## Pipeline Pass Plan

| Pass | Milestones | Proves |
|---|---|---|
| **Pass 1 (THIS pipeline pass)** | **M0 + M1** | M0 exit: "a minimal Tauri app produces a working installer on Win/Mac/Linux." M1 exit: "the core turns 'make auth better' into a valid structured one-shot, tested headless." |
| Pass 2 | M2, M3 | Real DeepSeek provider; question gate + modes in a first minimal UI |
| Pass 3 | M4, M5 | Full 4-layer memory + rewrite loop; both harness modes + compression |
| Pass 4 | M6, M7, M8 | Router/providers/privacy; telemetry + evals; hardening + ship |

---

# PASS 1 — M0 + M1 (FOUNDATION)

> Ordered per the plan's explicit recommendation: headless core first, Tauri shell
> second, before UI or memory.

## M1 — Headless Core Skeleton (most important)

### [x] Task P1-1: Headless core library skeleton, independent of the UI
Stand a compileable module graph up as a **standalone library**, not coupled to
the UI. Module boundaries from §5: `cli.ts`, `config.ts`, `routes.ts`, `model/`,
`context/`, `memory/`, `compiler/`, `harness/`, `telemetry/`.
**Acceptance**: core compiles with zero UI imports; `config.ts` holds modes and
token budgets; module map mirrors §5 exactly.
**Reference**: PLAN.md §3 (core NOT locked to UI), §5.

### [x] Task P1-2: Zod schema for the single JSON contract (IntentResult)
"One JSON contract seams the whole pipeline. If it's not valid JSON, it didn't happen."
Define `IntentResult` (+ shared shapes) with strict Zod schemas in `model/schema.ts`.
**Acceptance**: schema validates a mock structured intent; invalid JSON fails loudly.
**Reference**: §2 #1, §5 `model/schema.ts`.

### [x] Task P1-3: Deterministic context collector
"Runtime facts (repo, files, errors, package manifest, git state) are collected by
code, NOT invented by the model." Implement repo map, git state, manifest reading.
**Acceptance**: collector emits repo map/git/manifest programmatically (no model call);
missing repo handled gracefully.
**Reference**: §2 #2, §5 `context/repo.ts`.

### [x] Task P1-4: Intent → spec → one-shot pipeline, driven by a mock/fake model
Wire `intent -> spec -> one-shot` using a deterministic **mock** provider, with real
validation from P1-2. Implement `compiler/classify.ts`, `compiler/spec.ts`,
`compiler/packet.ts`, `model/provider.ts`.
**Acceptance**: running core on "make auth better" produces a **valid structured
one-shot** (M1 exit); no network/API call in the test; each boundary validates JSON.
**Reference**: §1 pipeline, §5, M1 exit.

### [x] Task P1-5: One-shot packet shape, matching §7 exactly
Emit packet with exact `<tag>` sections from §7: `<task_contract>`,
`<project_context>`, `<constraints>`, `<non_goals>`, `<acceptance_criteria>`,
`<verification>`, `<relevant_code>`, `<untrusted_content>`, `<execution_rules>`,
`<output_contract>`.
**Acceptance**: packet contains every §7 section, in order, no extras; `<non_goals>`
populated to prevent scope expansion; test asserts sections.
**Reference**: §7.

### [x] Task P1-6: Headless test suite for M1 exit criteria
CLI-driven headless test (no Tauri/UI): `axiom --test` exits 0 only when
"make auth better" → valid one-shot, using the mock provider. No background, no server.
**Reference**: M1 exit.

## M0 — Probe & Prove the Plumbing (spike)

### [x] Task P1-7: Tauri hello-world application shell
Scaffold a minimal Tauri app with React/TS web UI that loads in the Rust shell.
**Acceptance**: `tauri dev` opens the React/TS window (no required UI feature);
Rust shell + React/TS confirmed working. UI here is the empty shell only.
**Reference**: §3, M0.

### [ ] Task P1-8: Cross-OS CI smoke build → installer on Win/Mac/Linux
Prove "a real desktop app, not a CLI" ships with one-click installers.
**Acceptance**: CI produces a working installer for each of Windows, Linux, macOS (M0 exit).
**Reference**: M0 exit, §3.

### [ ] Task P1-9: Probe DeepSeek V4 Flash API compatibility
Confirm DeepSeek V4 Flash via API returns OpenAI-compatible output + valid JSON.
**Acceptance**: a single sandbox call returns an OpenAI-compatible JSON response;
results logged; no UI wiring.
**Reference**: M0.

### [ ] Task P1-10: Confirm Claude Code detectability / callability from the app
Verify the app can detect Claude Code and (stub) invoke it. Informs "Harness B hook"
decision — likely `claude` CLI for v1 (§9 #2).
**Acceptance**: app reports present/absent; stub confirms `claude` CLI subprocess can
spawn; no real task executed; foreground & time-boxed, no background processes.
**Reference**: M0, §9 #2.

---

# LATER PASSES (not in this pipeline pass)

- **Pass 2 — M2 + M3**: real DeepSeek provider + fence/JSON stripping + validation +
  retry/repair loop; provider interface + demo-gateway scaffold; `auto`/`interactive`/
  `one-shot` modes, ruthless question gate (`questions.ts`, `ambiguity.ts`), first
  minimal UI (text box + numbered-choice question + result panel). Exit: "make auth
  better" asks 1–3 useful questions, or none if safe.
- **Pass 3 — M4 + M5**: SQLite `store.ts`/`layers.ts`/`learn.ts` (4 layers + rewrite
  loop); both harness modes + context compressor (`compress.ts`); plan-only/dry-run.
- **Pass 4 — M6 + M7 + M8**: router/providers/privacy; telemetry + golden suite;
  hardening + ship.

## What NOT to build (§8)
- Endless intake interviews (≤3 questions); rewriting user intent silently (list
  assumptions); dumping the whole repo; the proxy solving the task itself; vector DB
  for hard constraints; shipping without evals; custom-training a tiny model first.