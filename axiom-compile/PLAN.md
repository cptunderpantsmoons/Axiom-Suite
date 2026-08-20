# Axiom — Development Plan

> "A ruthless intent compiler: infer as much as possible, ask only high-leverage
> questions, then emit a scoped, testable, context-compressed one-shot that a
> coding agent can execute with minimal token waste and minimal scope drift."

Status: **brainstorm / greenfield** — nothing built yet, only the design chat.

## LOCKED product decisions (owner-confirmed)

- **Target:** the masses who don't know how to prompt AI.
- **Distribution:** ONE-CLICK install on Windows / Linux / macOS — a real desktop app, not a CLI.
- **App shell:** Tauri (Rust shell + React/TS web UI) — tiny installers, cross-platform packaging built in.
- **Harness modes:** BOTH — dispatch to Claude Code when present, AND a direct mode where the app answers via the model for users without a coding agent.
- **v1 scope:** boring app v1 + the full 4-layer memory + the rewrite-don't-append correction loop.
- **Intent model:** DeepSeek V4 Flash via API (default), provider abstraction for router/frontier/demo fallback later.
- **Memory:** local SQLite, structured rules (no vector DB for hard constraints).

---

## 1. What we're actually building

A **prompt engineering proxy** that sits between a messy human request and a
coding harness (Claude Code / Codex / etc.). It is **not** a chatbot. It is an
**intent compiler**:

```
raw user request
  -> deterministic context collection
  -> memory loader (SQLite)
  -> intent compiler (DeepSeek V4 Flash via API)
  -> ambiguity/risk scoring
  -> question gate (max 3, defaults, ruthlessly gated)
  -> spec compilation
  -> context compression
  -> one-shot task packet (XML-ish, Claude-friendly)
  -> dispatch to Claude Code
  -> telemetry / eval logging
```

The killer loop that makes it useful for non-technical users:

```
user corrects output
  -> extract memory rule (DeepSeek)
  -> update SQLite memory
  -> DISCARD old context
  -> recompile from scratch into a clean context window
```

No context drift. The model never "forgets" because it's never given a growing
context to forget things in.

---

## 2. Core design principles (the non-negotiables)

1. **Structured intent, not freeform text.** One JSON contract seams the whole
   pipeline. Everything validates against it (Zod). If it's not valid JSON, it
   didn't happen.
2. **Deterministic vs. model split.** Runtime facts (repo, files, errors,
   package manifest, git state) are collected by code, NOT invented by the model.
   The model only does the fuzzy work: classify intent, extract constraints,
   decide questions, compile the packet.
3. **The question gate is ruthless.** Only ask if the answer *materially changes
   the final prompt*. Every question needs a default. Prefer single-choice.
4. **Memory is structured rules, not vectors.** Hard constraints (never use
   console.log, delete nothing) must be injected every time — never fuzzy-matched.
5. **Context is compressed and budgeted.** Never dump the repo. Rank what matters.
6. **Corrections rewrite, never append.** Anti-drift is the whole point.
7. **Secrets & injection defense from day one.** Untrusted content is data.
   Private repos never touch anonymous gateways.
8. **Evals from day one.** Without evals, we're just making prompts longer.

---

## 3. Tech stack (proposed)

| Layer | Choice | Why |
|---|---|---|
| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri (Rust)** | Tiny cross-platform installers for Win/Mac/Linux |
| UI | **React/TS** (web inside Tauri) | Fast to build the 'magic-simple' UX for non-devs |
| Core engine | **Rust or TS compiled** | Reusable headless proxy behind the UI |
| Validation | **Zod** (TS) or serde (Rust) | Single source of truth for the intent JSON contract |
| Storage | **SQLite** | Memory layers; no vector DB for v1 |
| Intent model | **DeepSeek V4 Flash via OpenAI-compatible API** | Cheap, fast, structured extraction |
| Harness A | **Claude Code** (when installed) | Full coding executor for devs/power users |
| Harness B | **Direct model output** (default for masses) | App answers itself when no coding agent present |
| Fallback | Provider abstraction, router | Hard/risky/ambiguous -> stronger model or fail-closed |
| Demo mode | Optional free gateway (Kilo/OpenCode/Zen) | Instant try-before-configure; non-private only |

> Core engine should NOT be locked to the UI. Build it as a headless library so
> the same intent-compiler powers the desktop app, a future CLI, and 3rd-party
> hooks. UI is just a shell around it.

---

## 4. The 4 memory layers

| Layer | Contents | Store |
|---|---|---|
| **A. Global prefs** | "likes arrow functions", "keep explanations to 1 sentence" | SQLite `user_preferences` (scope=global) |
| **B. Project DNA** | stack, commands, folder structure | auto-detected, cached |
| **C. Correction log** | negative constraints learned from rejections | SQLite `correction_rules` / `negative_examples` |
| **D. Task templates** | "make a CRUD page" -> multi-step expansion | SQLite `task_templates` |

Retrieval when the intent compiler runs:
```
all global rules
+ all project rules
+ negative examples matching task_type (from C)
=> injected into <constraints> / <non_goals>
```

---

## 5. Pipeline modules (the map)

```
src/
  cli.ts                 entrypoint (axiom)
  config.ts              config, modes, budgets
  routes.ts              the question gate / wiring
  model/
    provider.ts          ModelProvider interface
    deepseek.ts          intent compiler provider
    demoGateway.ts       starter/free-gateway provider
    router.ts            choose model/escalate
    parse.ts             JSON strip/fence + repair retry
    schema.ts            Zod schemas (IntentResult, MemoryRule, ...)
    prompts/
      intent_compiler.md
      repair.md
      memory_extract.md
      final_task_packet.md
  context/
    repo.ts              repo map, package.json, git state
    files.ts             relevant path discovery (ripgrep)
    compress.ts          symbol extraction, excerpting, budgets
    redact.ts            secret scan/redaction
  memory/
    store.ts             SQLite access
    layers.ts            A/B/C/D retrieval logic
    learn.ts             extract rule from correction (DeepSeek)
  compiler/
    classify.ts          task_type detection
    ambiguity.ts         ambiguity/risk scoring heuristics
    questions.ts         the question gate policy
    spec.ts              structured spec build
    packet.ts            one-shot packet emission
  harness/
    claudeCode.ts        dispatch to Claude Code
    planOnly.ts          plan-only / dry-run mode
  telemetry/
    logger.ts            structured request/result logs
```

---

## 6. Milestone plan (desktop-app-first)

### M0 — Probe & prove the plumbing (spike)
- Tauri hello-world builds and installs on all three OSes (CI smoke test).
- Hit DeepSeek V4 Flash API, confirm OpenAI-compatible output + JSON.
- Confirm Claude Code is detectable/callable from the app.
- **Exit criteria:** a minimal Tauri app produces a working installer on Win/Mac/Linux.

### M1 — Headless core skeleton (most important)
- Build the intent-compiler as a **standalone library**, independent of the UI.
- Full Zod/serde schema for `IntentResult`.
- Deterministic context collector (repo map, git, package.json, errors).
- `intent -> spec -> one-shot` with real validation, driven by a **mock/fake** model.
- **Exit criteria:** the core turns "make auth better" into a valid structured one-shot, tested headless.

### M2 — Real DeepSeek intent compiler
- Wire the DeepSeek provider + fence stripping + validation + retry/repair loop.
- Write `intent_compiler.md` prompt.
- **Exit criteria:** real requests produce valid structured intent after <=2 retries.

### M3 — Question gate + modes, wired into the UI
- `auto` / `interactive` / `one-shot` modes and the ruthless question policy.
- First Tauri UI: a text box, the numbered-choice question prompt (Enter = default),
  and a result panel.
- **Exit criteria:** typing "make auth better" in the app asks 1–3 *useful* questions, or none if safe.

### M4 — Memory layer (full, as owner chose)
- SQLite store + all 4 layers + retrieval injection.
- Correction -> memory rule extraction (user confirm for high-risk rules).
- The **rewrite-don't-append** loop: reject output -> update memory -> discard
  context -> recompile clean.
- **Exit criteria:** correcting the app once bakes the lesson into future
  constraints/non-goals with zero context drift.

### M5 — Both harness modes + compression
- Harness A: direct model output (default for masses).
- Harness B: Claude Code adapter when present.
- Context compressor (symbols/excerpts/budgets).
- Plan-only / dry-run mode for risky ops.
- **Exit criteria:** tasks run via direct mode; coding tasks route to Claude Code when available.

### M6 — Router, providers, privacy
- Provider abstraction + demo gateway + BYO key + local model placeholders.
- `allowedForPrivateRepos` enforcement (demo never sees private repos).
- Secret redaction across the boundary.
- **Exit criteria:** a private repo can't accidentally reach demo mode.

### M7 — Telemetry + eval harness
- Structured logging: request, compiled packet, questions, tokens, latency,
  user accept/reject, rework, failure category.
- Golden test suite (~20–100 curated requests) + pass/fail + metrics.
- **Exit criteria:** we can measure whether the proxy actually improves output.

### M8 — Hardening + ship
- Prompt-injection defense for untrusted content in packets.
- Dangerous-action gate (delete / drop table / force push / migrate).
- Token-budget enforcement.
- Final one-click installers for Win/Mac/Linux.

> Suggested first real task after this plan is approved: scaffold the **Tauri app
> + headless core skeleton (M0/M1)** so we can prove the loop end-to-end before
> polishing UI or memory.

---

## 7. The one-shot packet (final deliverable shape)

```markdown
<task_contract>
  Objective / Task type / Target area / scope lock
</task_contract>
<project_context>
  language / framework / test runner / relevant paths / repo state
</project_context>
<constraints>  ...from memory + user + model </constraints>
<non_goals>    ...prevent scope expansion </non_goals>
<acceptance_criteria>  observable, testable </acceptance_criteria>
<verification>  command/check hints </verification>
<relevant_code>  compressed only </relevant_code>
<untrusted_content>  data-only marker </untrusted_content>
<execution_rules>  smallest change, stop conditions </execution_rules>
<output_contract>  report: files, commands, tests, assumptions, risks </output_contract>
```

---

## 8. What NOT to build (per the doc)

-  Endless intake interviews (ask >3 questions)
-  Rewriting user intent silently (list assumptions instead)
-  Dumping the whole repo
-  Making the proxy solve the task itself (it compiles, it doesn't code)
-  Vector DB for hard constraints
-  Shipping without evals
-  Custom-training a tiny model first (distill later from real logs)

---

## 9. Remaining open decisions (smaller, decide during M0/M1)

1. **Core-engine language** — Rust (native to Tauri) vs. TS bundle as a sidecar.
   Rust keeps it single-binary; TS sidecar reuses tools/UI code. Verify which is
   easier to package into the Tauri app before committing.
2. **Harness B hook** — shell out to the `claude` CLI, use the SDK, or MCP.
   Likely `claude` CLI for v1 (simplest), upgrade later.
3. **Default provider for direct mode** — DeepSeek as default, but new users need
   an API key at some point. The demo-gateway onboarding funnel resolves this.
4. **Telemetry scope** — local-only logs vs. opt-in cloud metrics. Privacy-first
   until the business model is set.

Everything else in this doc is locked and ready to build against.