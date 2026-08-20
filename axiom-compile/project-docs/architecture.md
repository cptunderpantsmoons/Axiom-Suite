# Axiom — Technical Architecture

> Companion to `PLAN.md`. Everything here is **locked** except the four open
> decisions in section 9, which are resolved concretely in **§9 (Decisions)**.
> This document is buildable as-is; open issues are flagged `[decision]` or `[TBD]`.

---

## 1. System context (C4 Level 1)

```
        ┌──────────────────────────────┐
        │ User (non-dev "the masses")   │
        └──────────────┬───────────────┘
                       │ messy request / numbered-choice answers / corrections
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                    Axiom Desktop App (Tauri)                    │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React/TS Webview UI (thin shell, no domain logic)      │  │
│  └───────────────────────────┬─────────────────────────────┘  │
│                              │ typed IPC (invoke/event) + Zod │
│  ┌───────────────────────────▼─────────────────────────────┐  │
│  │        @axiom/core — headless intent-compiler lib     │  │
│  │   (loaded in-process by the webview; full §3 pipeline)  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌───────────────────┐   ┌────────────────────────────────────┐│
│  │ Tauri Rust shell  │   │ Local SQLite (per-user data dir)   ││
│  │ (windowing, fs,   │──▶│  A prefs / B DNA / C corrections / ││
│  │  packaging, O/S)  │   │  D templates + telemetry            ││
│  └───────────────────┘   └────────────────────────────────────┘│
└───────────────┬───────────────────────────────▲────────────────┘
                │ HTTPS (OpenAI-compatible)      │ subprocess / IPC
                ▼                                │
   DeepSeek V4 Flash API          Claude Code CLI (harness B, optional)
   (direct mode, intent model)                   └ returns report ≤ plan-only
```

- The webview hosts the core library **in-process**; the Tauri Rust side is
  reduced to OS/windowing/storage bootstrap + subprocess spawning.
- `@axiom/core` is a pure, UI-agnostic library and never imports Tauri.

---

## 2. Architecture style & rationale

| Choice | Decision | Why | Trade-off / what we give up |
|---|---|---|---|
| Engine | **Modular monolith, headless TS library** (`@axiom/core`) | Reusable behind UI, future CLI, 3rd-party hooks; one language across engine+UI+eval | No separate scaling; single process (fine for a desktop app) |
| Boundaries | **Layered within core** — `model / context / memory / compiler / harness / telemetry` per §5 | Matches the locked module map | Must enforce inward deps by discipline + tests |
| Seam | **One Zod JSON contract** — `IntentResult`, `MemoryRule`, task packet | Principle 1: "if not valid JSON, it didn't happen" | No free-form shortcuts anywhere |
| UI↔Engine | Typed IPC over `IntentResult` / `Answer` / `Packet` | Deterministic boundary | Extra serialization round-trips (negligible) |
| Storage | SQLite via a thin typed store | Memory is rules, not vectors (locked) | No fuzzy retrieval for hard constraints |
| Model access | OpenAI-compatible HTTPS + provider interface | Unlocks DeepSeek default + demo gateway + router | Network dependency; needs key/config for real mode |

**Non-negotiables enforced at build time:** Zod-validation at every boundary;
dependency direction `compiler → model,memory,context` never the reverse;
deterministic context collection is code, not model output (§2.2).

---

## 3. C4 Level 2 — core containers & responsibilities

```
@axiom/core
│
├─ model/        provider abstraction → one of: deepseek | demoGateway | router
├─ context/      deterministic repo/files/compress/redact collection (code, not AI)
├─ memory/       SQLite: layers A/B/C/D retrieval + learn() from corrections
├─ compiler/     classify → ambiguity → questions → spec → packet
├─ harness/      claudeCode dispatch + planOnly dry-run
├─ telemetry/    local structured logs + eval events
└─ shared/       config, budgets, ids, types
```

**Inward dependency rule:** `compiler/` calls ports on `model/`, `context/`,
`memory/`, `harness/`, `telemetry/`. None of those modules import `compiler/`
or the UI; `context/` and `memory/` are deterministic (mockable/model-free).

---

## 4. The single seam: Zod JSON contract

Everything passes through these three validated documents. They live in
`packages/axiom-core/src/model/schema.ts` and are versioned (`contract_v: 1`) so the
UI and any future consumer can fail loudly rather than parse drifting shapes.

### 4.1 `IntentResult` — the compiled, validated intent (post-question-gate)

```ts
// packages/axiom-core/src/model/schema.ts (excerpt)
const TaskType = z.enum([
  "feature", "fix", "refactor", "test", "docs",
  "setup", "investigate", "migration", "other",
]);

export const IntentResult = z.object({
  contract_v: z.literal(1),
  intent_id: z.string().uuid(),                         // traceability across pipeline
  task_type: TaskType,
  summary: z.string().min(1),
  target_area: z.string(),                              // component/module path
  scope_lock: z.string(),                               // explicit "what's in" sentence
  assumptions: z.array(z.string()),                     // never silently rewrite intent
  constraints: z.array(z.string()),                     // supplied by user + memory
  non_goals: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  verification_hints: z.array(z.string()),
  risk: z.object({
    score: z.number().min(0).max(1),                    // ambiguity/risk heuristic + model
    dangerous: z.enum(["none", "destructive", "require_plan"]),
    needs_questions: z.boolean(),
  }),
  questions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    kind: z.enum(["single_choice", "boolean", "free_text"]),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    default: z.string(),                                // RFC: every question has a default
    rationale: z.string(),                              // why this materially changes output
  })).max(3),                                           // ruthless gate ceiling
});

export type IntentResult = z.infer<typeof IntentResult>;
```

- Validation: `IntentResult.parse()` after every model call, up to **2 repair
  retries** (§6), then fail-closed (surface to user, never emit a half packet).
- Everything the UI shows (questions) and the compiler emits (packet) is this
  object — one source of truth.

### 4.2 `MemoryRule` — one row in any memory layer

```ts
export const MemoryRule = z.object({
  contract_v: z.literal(1),
  rule_id: z.string().uuid(),
  layer: z.enum(["global_prefs", "project_dna", "correction", "task_template"]),
  scope: z.enum(["global", "project"]),
  project_path: z.string().optional(),                  // required if scope=project
  rule_type: z.enum(["positive", "negative", "template"]),
  text: z.string().min(1),                              // the rule itself
  source_task_type: z.string().optional(),              // for layer C matching
  confidence: z.number().min(0).max(1),
  requires_confirmation: z.boolean().default(false),    // high-risk rules prompt user
  created_at: z.string().datetime(),
  last_used_at: z.string().datetime().nullable(),
});

export type MemoryRule = z.infer<typeof MemoryRule>;
```

Retrieval (matches §4 injection): machine query returns
`all global rules + all project rules + negative examples where source_task_type == task_type`,
flattened into `constraints` / `non_goals` before the packet is built.

### 4.3 Task packet — final deliverable (§7 as data)

```ts
export const TaskPacket = z.object({
  contract_v: z.literal(1),
  packet_id: z.string().uuid(),
  intent_id: z.string().uuid(),
  emitted_at: z.string().datetime(),
  mode: z.enum(["direct", "claude_code", "plan_only"]),

  task_contract: z.object({
    objective: z.string(),
    task_type: TaskType,
    target_area: z.string(),
    scope_lock: z.string(),
  }),
  project_context: z.object({
    language: z.string().optional(),
    framework: z.string().optional(),
    test_runner: z.string().optional(),
    relevant_paths: z.array(z.string()),
    repo_state: z.string(),                              // git/package manifest snapshot
  }),
  constraints: z.array(z.string()),                      // memory + user + model
  non_goals: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  verification: z.array(z.string()),
  relevant_code: z.string(),                             // <<< compressed excerpts (§5/§7)
  untrusted_content: z.array(z.string()),                // data-only marker for prompt-injection defense (§8)
  execution_rules: z.array(z.string()),                  // smallest change, stop conditions
  output_contract: z.object({                            // report the agent must return
    files: z.array(z.string()),
    commands: z.array(z.string()),
    tests: z.array(z.string()),
    assumptions: z.array(z.string()),
    risks: z.array(z.string()),
  }),
  token_budget: z.object({ relevant_code_budget: z.number(), context_budget: z.number() }),
});

export type TaskPacket = z.infer<typeof TaskPacket>;
```

The packet is emitted as the §7 XML-ish markup for agent readability;
**the Zod object is the canonical form**, the markup is a rendering.

---

## 5. Package layout (monorepo)

Grounding §5's `src/` map in a buildable package structure:

```
axiom/
├─ packages/
│  ├─ axiom-core/                  # @axiom/core — headless intent compiler (all §5 logic)
│  │  ├─ src/
│  │  │  ├─ index.ts              # public API: compileIntent(), answer, applyCorrection()
│  │  │  ├─ config.ts             # config, modes (auto/interactive/one-shot), budgets
│  │  │  ├─ routes.ts             # pipeline wiring / orchestrator (question gate + flow)
│  │  │  ├─ model/
│  │  │  │  ├─ provider.ts        # ModelProvider interface (port)
│  │  │  │  ├─ deepseek.ts        # DeepSeek V4 Flash (OpenAI-compat) adapter
│  │  │  │  ├─ demoGateway.ts     # starter/free gateway adapter (non-private only)
│  │  │  │  ├─ router.ts          # escalate/fail-closed on risk/ambiguity
│  │  │  │  ├─ parse.ts           # strip JSON fences + repair retry
│  │  │  │  ├─ schema.ts          # Zod: IntentResult, MemoryRule, TaskPacket (§4)
│  │  │  │  └─ prompts/           # intent_compiler.md, repair.md, memory_extract.md, final_task_packet.md
│  │  │  ├─ context/
│  │  │  │  ├─ repo.ts            # repo map, package.json, git state (deterministic)
│  │  │  │  ├─ files.ts           # relevant-path discovery (ripgrep)
│  │  │  │  ├─ compress.ts        # symbol extraction, excerpting, budget (§7 relevant_code)
│  │  │  │  └─ redact.ts          # secret scan/redaction on the boundary
│  │  │  ├─ memory/
│  │  │  │  ├─ store.ts           # SQLite access (Drizzle/Zod-typed rows)
│  │  │  │  ├─ layers.ts          # A/B/C/D retrieval logic
│  │  │  │  └─ learn.ts           # extract MemoryRule from a correction (DeepSeek)
│  │  │  ├─ compiler/
│  │  │  │  ├─ classify.ts        # task_type detection
│  │  │  │  ├─ ambiguity.ts       # ambiguity/risk scoring heuristics
│  │  │  │  ├─ questions.ts       # the ruthless question policy (≤3, defaults, single-choice-first)
│  │  │  │  ├─ spec.ts            # structured spec build from IntentResult
│  │  │  │  └─ packet.ts          # TaskPacket emission + §7 markup rendering
│  │  │  ├─ harness/
│  │  │  │  ├─ claudeCode.ts      # dispatch to `claude` CLI (Harness B) — §9.2
│  │  │  │  └─ planOnly.ts        # plan-only / dry-run mode (risky ops)
│  │  │  ├─ telemetry/
│  │  │  │  └─ logger.ts          # local structured logs (§9.4)
│  │  │  └─ shared/
│  │  │     ├─ ids.ts             # uuid helpers, intent/packet correlation
│  │  │     └─ error.ts           # FailClosedError, RepairLimitExceeded
│  │  └─ test/                    # headless unit + integration + golden eval suite
│  ├─ ui-react/                   # @axiom/ui — React/TS webview (no domain logic)
│  └─ cli/                        # @axiom/cli — headless CLI (axiom) — future/optional
├─ src-tauri/                     # Tauri Rust shell: window, IPC bridge, subprocess, packaging
├─ project-docs/                  # this doc + ADRs
└─ package.json                   # npm workspaces
```

Loading strategy (`[decision 9.1]`): `@axiom/core` runs **in-process inside
the webview**; the Tauri Rust shell is a thin native boundary. Confirm at M0 the
webview has Node/fetch + file access needed for SQLite (see §9.1 trade-off: if
native SQLite in Rust is strictly required by Tauri permissions, `memory/store.ts`
becomes an IPC call into the Rust side while everything else stays TS).

---

## 6. Pipeline flow (with validation gates)

```
raw request
  └▶ context/ (repo, files, git, redact)        [deterministic, code]
  └▶ memory/ retrieveA/B/C/D                     [rules → constraints/non_goals]
  └▶ model/intent_compiler.md  ──parse──▶ IntentResult.parse()
        ↺ repair.md (≤2 retries)  ──parse── IntentResult.parse()   [fail-closed]
  └▶ compiler/ambiguity + custom heuristics → risk.score
  └▶ routes.ts question gate
        auto        → defaults, 0 questions
        interactive → up to 3 single-choice w/ defaults, Enter=default
        one-shot    → compile immediately from defaults
  └▶ compiler/spec + packet → TaskPacket.parse() → §7 markup
  └▶ route dispatch
        mode=direct      → model/deepseek answers in-app (§9.3)
        mode=claude_code → harness/claudeCode `claude -p <packet>` (§9.2)
        risk=require_plan→ harness/planOnly dry-run first
  └▶ telemetry/logger.ts → local structured row (§9.4)
```

**Correction loop (rewrite, never append):**
```
user rejects output
  → memory/learn.ts  DeepSeek extracts MemoryRule (layer=C, source_task_type set)
  → requires_confirmation if high-risk → user confirm in UI
  → store rule to SQLite
  → DISCARD all pipeline context (no retained window)
  → recompile from scratch → fresh context window
```

---

## 7. Model provider interface & selection

`model/provider.ts`:

```ts
export interface ModelProvider {
  id: string;                                  // "deepseek", "demo-gateway", "router"
  readonly privateSafe: boolean;               // demoGateway=false
  complete<T>(req: CompletionRequest, schema: z.ZodType<T>): Promise<T>;
  stream?(): ...;                              // later
}
```

- **Default (direct mode + intent model):** `deepseek` — config-gated API key.
- **Onboarding:** `demoGateway` — free, non-private, stub/gateway; marked
  `privateSafe:false` so `allowedForPrivateRepos` (M6) hard-blocks any private
  repo. Uses the same `complete` + Zod contract, so no dual code paths.
- **Router:** escalates on `risk.score`/`dangerous` thresholds, or fail-closed.
- `parse.ts`: strips code-fence/whitespace wrapper, runs `schema.parse`, returns
  JSON on success; on failure returns the raw model text for `repair.md` retry
  (≤2), then `FailClosedError`.

---

## 8. Quality attributes

| Attribute | Approach |
|---|---|
| **Security / injection defense** | Untrusted content is *data*: redacted at boundary (`redact.ts`), placed only in `packet.untrusted_content` with a data-only marker; `<task_contract>` etc. are built by code, never echoed raw. Secrets never enter demo gateway (`privateSafe`). Dangerous-action gate (delete/drop/force-push/migrate) forces `plan_only` (M8). |
| **Reliability** | Model call + Zod validation with ≤2 repair retries; fail-closed: never emit a half-valid packet; harness subprocess timeout + captured stderr. |
| **Maintainability** | One Zod seam; dependency direction tested; modules mirror §5 exactly; mono-repo workspaces. |
| **Observability** | Local structured telemetry (§9.4): per-request request/packet/questions/tokens/latency/accept-reject/rework/failure category. |

---

## 9. Resolved decisions (the four open questions from PLAN §9)

Status: **all four resolved for build.** Each tagged M0/M1 where it must be
verified.

### 9.1 Core-engine language → **standalone TypeScript library (`packages/axiom-core`)**

**Context.** `PLAN §9.1` : Rust (native to Tauri, single binary) vs TS sidecar
(reuses tools/UI code). The locked §3 sanity note already says the core must be
a *headless library* powering desktop app + future CLI + 3rd-party hooks.

**Decision.** Build `@axiom/core` as a **framework-agnostic TypeScript
library**, run in-process in the React webview. Tauri's Rust shell is reduced to
window creation, IPC, subprocess spawning, and packaging — no domain logic.

**Why TS over a Rust sidecar:**
1. **The pipeline is TS-shaped already.** Zod (locked), the compiler prompts,
   and the React UI all speak the same JSON contract. One language across
   engine, UI, and the eval suite kills the biggest cross-language cost (dual
   schema validation in Zod *and* serde). `PLAN §3` lists validation as "Zod
   **or** serde" — TS makes it *just* Zod.
2. **Reusable single artifact.** The same lib backs webview, CLI, and 3rd-party
   hooks without compiling the Rust core a second way.
3. **Faster iteration on hard parts.** The value here is the prompt/validate/
   repair loop and the question gate — logic that changes often. TS iterates
   faster than Rust for this.

**Trade-offs (what we give up):**
- **Not a single Rust binary.** Tauri bundles a JS asset, so the "one binary"
   purity of Rust-native is ceded. Acceptable: Tauri still produces one-click
   cross-platform installers (locked), and the JS engine is the *content* of the
   app, not a second runtime of consequence.
- **Runtime host:** webview must provide enough of Node (fetch, file/SQLite
   access via the Tauri IPC). **M0 verification:** if Tauri permissions force
   native SQLite/Rust, keep `memory/store.ts` and `harness/claudeCode.ts` as the
   *only* modules that talk across IPC — everything else stays pure TS. This
   isolates the boundary rather than rewriting the engine.
- **Perf ceiling:** lower than Rust for heavy compression. Deferred — v1
   context budgets are modest.

**ADR pointer:** `project-docs/ADR-001-core-language.md` (status Accepted).

### 9.2 Harness B hook (Claude Code) → **call the `claude` CLI for v1**

**Context.** `PLAN §9.2`: shell out to `claude` CLI, SDK, or MCP.

**Decision.** `harness/claudeCode.ts` spawns the `claude` CLI as a subprocess
(via the Tauri Rust shell) and hands it the §7 task-packet markup.

- `claude` CLI is present on power-user machines exactly when this mode is
  useful; it's the simplest, most well-trodden integration, requires no SDK
  wiring or MCP handshake, and is easy to upgrade later without touching the
  contract.
- Detection at M0: presence-check `claude --version`; app auto-routes to direct
  mode when absent (`M5` routing rule).

**Trade-offs:** less control than the SDK (we get stdout/exit code, not a
programmatic session); no in-process streaming in v1. Fine for a one-shot
`-p <packet>` invocation returning the `output_contract` report.

**ADR:** `project-docs/ADR-002-harness-b-cli.md` (Accepted).

### 9.3 Default provider for direct mode → **DeepSeek, config-gated, with demo-gateway onboarding stub**

**Context.** `PLAN §9.3`: DeepSeek default but new users need an API key at some
point; demo-gateway onboarding resolves the funnel.

**Decision.**
- **Configured production default = `deepseek`** (DeepSeek V4 Flash,
  OpenAI-compatible) for both the intent model and direct-mode answers. Gated on
  a stored API key.
- **Onboarding path = `demoGateway` stub**: free, non-private, marked
  `privateSafe:false`. A fresh user gets instant try-before-configure through
  the demo gateway; the moment they enter their own key, the provider router
  flips to `deepseek`. `allowedForPrivateRepos` (M6) hard-blocks any private
  repo from touching the demo gateway — no excuse, enforced by provider flag.

**Trade-off:** demo mode is a free/stub gateway → must be fail-closed for
private data (enforced) and clearly labeled in UI; it is an onboarding funnel,
not a production cost path.

**ADR:** `project-docs/ADR-003-direct-mode-provider.md` (Accepted).

### 9.4 Telemetry scope → **local-only structured logs first**

**Context.** `PLAN §9.4`: local-only logs vs opt-in cloud metrics.

**Decision.** `telemetry/logger.ts` writes **local structured logs** only (into
the per-user SQLite data dir). No cloud egress in v1. Privacy-first until the
business model is set (`PLAN §2.7`).

- **Per-request row schema:** `intent_id, packet_id, mode, provider, risk,
  questions_asked, default_used, tokens_in, tokens_out, latency_ms,
  user_accept, user_reject, rework, failure_category, timestamp`.
- These rows double as **the eval corpus** (M7): the golden suite replays
  curated requests against these fields; no separate instrumentation needed.

**Trade-off:** we defer aggregate/cohort metrics and cannot measure against a
remote population yet — deferred intentionally. Lifting to opt-in cloud later is
a small addition to `telemetry/logger.ts`, not a re-architecture.

**ADR:** `project-docs/ADR-004-telemetry-local-only.md` (Accepted).

---

## 10. Build order mapped to milestones

1. **M0 (probe):** Tauri hello-world + CI smoke; DeepSeek call + JSON confirm;
   `claude` CLI detect. **Verifies §9.1 (runtime host), §9.2 (CLI spawn), §9.3
   (gateway call).**
2. **M1 (headless core):** scaffold `packages/axiom-core`; full Zod §4; deterministic
   `context/`; `intent → spec → packet` against a mock model, tested headless.
3. **M2:** real `deepseek` provider + `parse.ts` repair loop + `intent_compiler.md`.
4. **M3:** `routes.ts` question gate + `auto/interactive/one-shot` + first Tauri UI.
5. **M4:** SQLite `memory/store.ts` + layers A/B/C/D + `learn.ts` + rewrite-not-append loop.
6. **M5:** both harness modes + `compress.ts` + `planOnly`.
7. **M6:** router + `demoGateway` + `privateSafe` + redaction.
8. **M7:** local telemetry (§9.4) + golden eval suite.
9. **M8:** injection defense, dangerous-action gate, token budgets, final installers.

**First task after approval:** scaffold Tauri + headless `packages/axiom-core` skeleton
(M0/M1) to prove the loop end-to-end.

---

## 11. Decisions register (ADR index)

| ADR | Title | Status | Milestone |
|---|---|---|---|
| ADR-001 | Core engine as TypeScript library (not Rust sidecar) | Accepted (build) | M0/M1 |
| ADR-002 | Harness B via `claude` CLI in v1 | Accepted (build) | M0/M5 |
| ADR-003 | Direct-mode provider: DeepSeek config-gated + demo gateway onboarding | Accepted (build) | M6 |
| ADR-004 | Telemetry local-only structured logs first | Accepted (build) | M7 |

> ADR files under `project-docs/` use the standard Context / Decision /
> Consequences template from the agency spec.