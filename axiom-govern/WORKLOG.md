# Worklog — Management Harness Rectification

Chronological record of work. All dates 2026-08-15 unless noted.

## Session 1 — Critical batch (CRIT-001..010)
- Hardened request timeouts + TLS (CRIT-001).
- Added hard request body size limit (CRIT-002).
- Moved all secrets to env vars; removed dead `PostgresConfig` (CRIT-003 / HIGH-008).
- Restricted CORS to configured origins (CRIT-004).
- Added request payload validation (CRIT-005).
- Hardened in-memory store; added memory-pressure warnings (CRIT-006).
- Applied PII redaction to audit records and streamed responses (CRIT-007).
- Wired budget `Check`/`RecordUsage` into proxy after auth (CRIT-008).
- Wired `selectProvider` so a configured upstream is actually used (CRIT-009).
- Made audit writer non-blocking (no-drop) with chain-file persistence; added proxy
  rate limiter + `X-Request-ID` correlation (CRIT-010).

## Session 2 — High batch part 1 (HIGH-001, HIGH-002, HIGH-003, HIGH-006, HIGH-007, HIGH-009)
- HIGH-001: `handleReady` uses detached 2s context and pings `BudgetStore.Ping`
  (added `Ping` to `BudgetStore` interface; impl'd memory + redis).
- HIGH-002: manager `server.go` serves `/metrics`, `/readyz`, `/livez` (parity with proxy).
- HIGH-003: added real `start := time.Now()` + `RecordRequest(time.Since(start))` to
  `handleChatStream` and `handleAnthropicMessages`.
- HIGH-006: routed MCP `handleToolsCall` through guardian + budget + audit + response
  redaction; made `audit()` nil-safe; updated `proxy_test.go` with full deps.
- HIGH-007: rewrote manager auth middleware to resolve `*models.Identity` (roles from
  JWT claims / admin token); added `RequireRole`/`RequireAdmin`/`hasAnyRole`;
  gated mutating manager routes with `RequireAdmin`; added `auth_test.go`.
- HIGH-009: added `internal/components/budget/period.go` (period rollover) for
  memory + redis stores; added `period_test.go`.

## Session 3 — Circuit breaker + richer metrics (HIGH-004, HIGH-005)
- HIGH-004: created `internal/components/circuitbreaker/breaker.go` (closed/half-open/
  open, consecutive-failure trip, cooldown probe; `HealthCheck`/`EstimateCost` bypass);
  wired into `bootstrap.Build` for every provider; breaker state reporter → metrics.
- HIGH-005: switched `MetricsCollector` to a dedicated `*prometheus.Registry` +
  `Handler()`; added `breakerState` gauge, `budgetExceeded` counter; added
  `SetBreakerState`/`RecordBudgetExceeded`; record budget-exceeded in proxy handlers.
  Added `circuitbreaker/breaker_test.go`.

## Session 4 — Metrics investigation + build fix
- Investigated `/metrics` returning 0 bytes: root cause was that a Prometheus
  `CounterVec`/`GaugeVec` only emits a family after the first `.WithLabelValues()`
  (i.e., after real traffic). The earlier "promauto not registered" was a false alarm.
- Found a genuine defect: `handleChatCompletion`'s no-provider 503 path did NOT call
  `RecordRequest`, so a no-upstream proxy never populated metrics. Fixed by recording
  `("none", model, "unavailable")` on that path.
- Fixed compile error: duplicate `start` declaration in `handleChatCompletion`
  (`cmd/proxy/main.go`) — inner `start := time.Now()` changed to `start = time.Now()`.
- Smoke-tested proxy: `/metrics` now returns 1860 bytes / 19 harness series after one
  request, including the recorded request.

## Session 5 — Verification + plan/worklog
- `go build ./...`, `go vet ./...`, `go test ./... -count=1` all green.
- Manager smoke: `/healthz`,`/readyz`,`/livez` → 200; `/api/v1/users` without token →
  401; with admin token → 201; `/metrics` exposed (0 bytes pre-traffic, expected).
- Verified gaps for the plan:
  - `RecordCost` (per-identity cost) is defined in `metrics.go:118` but **never called**
    by the proxy → REM-001.
  - Circuit-breaker thresholds hardcoded via `DefaultConfig()` at
    `internal/bootstrap/bootstrap.go:82` → REM-002.
  - No integration/E2E test for the full pipeline → REM-003.
  - No performance re-baseline (P95 < 50ms) → REM-004.
  - Proxy vs manager middleware not unified → REM-005 (deferred).
- Wrote `RECTIFICATION_PLAN.md` and this `WORKLOG.md`.

## Summary of remaining work
- REM-001: wire `RecordCost` into proxy completion/stream handlers.
- REM-002: make circuit-breaker thresholds configurable via config.
- REM-003: integration / E2E test for full proxy pipeline (auth→guardian→budget→breaker→metrics).
- REM-004: performance re-baseline (P95 < 50ms).
- REM-005: unify shared middleware chain (deferred).

## Session 6 — Finish HIGH-004/HIGH-005 + REM-001..004
- REM-001 (cost metric): created `internal/core/interfaces/pricing.go` (`Pricing`
  interface) and `internal/core/pricing/price.go` (`DefaultPricing`, `Default()`,
  built-in `rateTable` keyed by `"provider:model"` with `default_rate` fallback via
  `PricingConfig`). Added `deps.Dependencies.Pricing` and wired `pricing.Default()` in
  `bootstrap.go`. Added `recordCost(d, r, provider, model, usage)` helper in
  `cmd/proxy/main.go` and called it from the completion, stream, and Anthropic success
  paths. `internal/core/pricing/price_test.go` added.
- REM-002 (configurable breaker): added `BreakerConfig` (`max_failures`, `cooldown`) to
  `Config` and `ProviderConfig`; `setDefaults` (5/10s); `bootstrap.go` now reads config
  instead of `circuitbreaker.DefaultConfig()`. Added `Config()` accessor to the breaker
  and a top-level `breaker` section in `configs/config.yaml`.
- REM-003 + REM-004 (integration + perf): added `cmd/proxy/proxy_integration_test.go`
  (package `main`, uses `setupRouter`) covering auth→guardian (injection block + PII
  redact)→budget (allow + exceed)→circuit breaker (trip)→metrics (cost + breaker
  state), plus `TestProxyLatencyBaseline` asserting P95 < 50ms over 200 requests. All
  passing.
- REM-002 test: added `internal/bootstrap/bootstrap_test.go` asserting global and
  per-provider breaker overrides are honoured. Fixed a template bug (missing newline
  between `enabled: true` and the appended `breaker:` block) that produced
  `enabled: truebreaker:` and a YAML parse panic.
- `go build ./...`, `go vet ./...`, `go test ./... -count=1` all green. Updated
  `RECTIFICATION_PLAN.md` (HIGH-004/005 + REM-001..004 → Done; REM-005 deferred) and
  this worklog.

## Final state (end of Session 6)
- All CRIT/HIGH items done. REM-001..004 done. REM-005 deferred (no per-role proxy gating needed).
- Nothing outstanding except the deferred REM-005.

## Session 7 (2026-08-16) — Review & rectify: two defects found + fixed
- Ran the full gate suite including `go test ./... -race` (the README's `make test`).
  Found a latent **data race** the prior sessions missed (they only ran `-count=1`):
  `AuditLogger.persistChain()` read `HashChain.previous` via `Current()` after
  `drain()` released `l.mu`, racing with `Log()` writing it via `Next()` under
  `l.mu`. Fixed `persistChain()` to read `Current()` under `l.mu`
  (`internal/observability/audit/logger.go`).
- Runtime smoke-tested manager + proxy (built both binaries, curl against live
  endpoints). Found the **manager audit trail was dead**: `/audit/events`,
  `/audit/verify`, `/audit/export`, and `/overview` read from a disconnected
  `s.auditSink` MemorySink that nothing wrote to, and manager handlers never
  called `d.Audit.Log()`. Fixed by:
  - adding `AuditLogger.Events()` accessor;
  - removing the orphaned `auditSink` and pointing the audit endpoints/overview at
    the real `deps.Audit`;
  - adding `internal/api/audit.go` (`auditEvent` helper + nil-safe `auditEvents`/
    `auditVerified`) and wiring `auditEvent` into all mutating admin handlers
    (users, keys, budget, policies);
  - adding `internal/api/handlers_audit_test.go` (regression test).
- Second-opinion code review (agency-engineering-code-reviewer) confirmed both
  fixes; applied two robustness follow-ups: `VerifyChain` returns `false` when no
  MemorySink is configured (was a misleading `true`), and read handlers now use
  nil-safe helpers.
- Final gates: `go build ./...` clean, `go vet ./...` clean,
  `go test ./... -race -count=1` — 17 packages pass, 0 data races.
- Created `CONTEXT_LOCK.md` (canonical state + quality-gate evidence + open items).

## Session 8 (2026-08-16) — Client readiness: packaging + deployment hardening
- Summoned a 3-agent team (reality-checker, code-reviewer, devops-automator) to
  review `DEFECTS_CONFIRMED.md` (4 confirmed defects) + full client readiness.
- Fixed DEFECT-1 (Dockerfile `golang:1.23-alpine` → `1.25-alpine`; entrypoint →
  overridable `CMD`), DEFECT-2 (README false K8s/Terraform claim), DEFECT-3
  (dropped Postgres from docker-compose), DEFECT-4 (README Persistence section +
  `.env.example` audit-chain var). Verified `docker build` + both containers boot
  (`/healthz` 200).
- Team review surfaced 3 more issues, all fixed:
  - `insecureSecrets` blocklist did not contain `.env.example` placeholders → added
    (`change-me-admin-token`, `change-me-jwt-secret`).
  - Prometheus scraped dead `host.docker.internal:9091` → repointed to :8080/:8090
    `/metrics` + `extra_hosts` (Linux).
  - Redis did **not** back API keys (only budget/usage) → implemented
    `auth.RedisKeyStore` and wired it in `bootstrap.go`; `MH_REDIS_ENABLED=true` now
    shares keys + budgets + usage across processes.
- End-to-end evidence: key minted via manager authenticated by a separate proxy
  process over shared Redis (503 "no provider" = auth passed; bogus key → 401).
- Final gates: `go build`, `go vet`, `go test ./... -race` (17 packages), `docker
  build` all clean. Updated `DEFECTS_CONFIRMED.md` (resolved), `CONTEXT_LOCK.md`,
  and this worklog.

## Session 9 (2026-08-16) — Dashboard config control plane (providers/keys/settings)
- Made the dashboard Configuration page fully editable (was read-only).
- Backend: added `config.RuntimeStore` (JSON-file persisted runtime settings with
  secret-preserving merge + pointer sections so partial updates never clobber),
  a concurrency-safe `providers.Registry`, and provider hot-reload via a file
  watcher in `bootstrap`. Added admin `PUT /api/v1/config` and enhanced `GET
  /api/v1/config` (masked, runtime-aware).
- Switched `deps.Providers` from `map[...]` to `*providers.Registry`; updated
  proxy `selectProvider`/`handleReady`, router, manager overview, mcp, and tests.
- Frontend: rewrote the Config page into editable forms (providers + API keys +
  guardian/proxy/breaker/pricing/metrics/secrets/redis), Save → `PUT /config`.
- Verified end-to-end: `PUT /config` adding a provider hot-reloaded the live proxy
  (real completion returned from a mock upstream, HTTP 200); settings/secret
  preservation confirmed; `go test ./... -race` → 17 packages clean.

## Session 10 (2026-08-16) — Prompt optimisation fix + Skills MVP (build order 1–4)
Per the brainstorm (docs/BRAINSTORM-…md), implemented the recommended build order:
1. **Optimizer correctness fix** — replaced the harmful `DefaultCompressor`
   (lowercasing + substring filler removal) with a lossless whitespace normaliser;
   added case-preservation + normalisation tests.
2. **Skills MVP** — new `models.Skill`/`SkillParam`, `components/skills` package
   (file-backed `Store`, atomic `Registry`, `Engine` resolve/authorize, strict
   `{{slot}}` interpolator with required/enum/maxlength validation); wired into
   `bootstrap` + `deps`; admin CRUD routes (`/api/v1/skills`) + dashboard Skills
   page; `ChatRequest` gained `skill`/`skill_params`.
3. **Pipeline integration** — skill resolve+expand+optimise in the shared
   `resolveRequest` (already the single point all 3 handlers call).
4. **Optimisation telemetry** — skill-scoped (`skill.Optimize`) lossless normalisation
   wired to new `harness_optimizer_applied_total` / `harness_optimizer_tokens_saved_total`.
- Verified end-to-end: created a skill via API, invoked it through the proxy → the
  upstream saw the assembled system prompt + filled+whitespace-normalised template
  (echoed by a mock provider); unknown skill → 404; optimizer metrics emitted.
  `go test ./... -race` → 18 packages, 0 races.
- Review-driven hardening (code-reviewer + reality-checker): added a **guardian
  re-scan** of the expanded skill prompt (`guardianGate`) so client-controlled
  `skill_params` cannot smuggle injection/PII past the guardian; added
  `TestProxySkillExpansionAndStripping` in `proxy_integration_test.go` covering
  expansion, whitespace optimisation, upstream stripping, unknown-skill 404, and
  injection-via-skill_params → 403. Full suite still 18 packages, 0 races.

## Session 11 (2026-08-16) — NVIDIA Nemotron for optimisation + skill wizard
- Added `OptimizerConfig` (`provider`, `model`, `enabled`, `shadow_mode`) + an
  `nvidia` OpenAI-compatible provider entry (base_url `https://integrate.api.nvidia.com/v1`).
- `optimizer.LLMCompressor` — lossy rewrite/compress via an `interfaces.LLMProvider`
  (e.g. Nemotron); wired in `bootstrap.buildOptimizer` (LLM when `optimizer.enabled`+provider
  configured, else lossless default), gated by the semantic-preservation enforcer.
- Skill-creation wizard: `POST /api/v1/skills/draft` + `draftSkill` helper call the
  configured LLM to generate a Skill from a description; dashboard “Draft with AI” button.
- `configs/config.yaml` + `.env.example` document the NVIDIA NIM provider + optimizer block.
- Verified against a mock OpenAI-compatible NIM endpoint: Draft with AI returned a
  generated skill; invoking an `optimize:true` skill applied Nemotron whitespace/
  filler compression before upstream (`harness_optimizer_applied_total` incremented).
  Unit tests: LLM compressor + gate. `go test ./... -race` → 18 packages, 0 races.

## Session 12 (2026-08-16) — Dashboard-configured NVIDIA key + professional styling
- Made the NVIDIA/optimizer settings editable from the dashboard: added
  `RuntimeOptimizer` to the runtime config (provider/model/enabled/shadow_mode),
  surfaced an **Optimiser / NVIDIA** block on the Configuration page, and made the
  skill-draft handler read the live optimizer config (`optimizerConfig`). The NVIDIA
  provider API key is entered on Configuration → Providers (masked on read).
  Verified: `PUT /config` entering the key + enabling the provider/optimizer makes
  `POST /api/v1/skills/draft` immediately use that provider.
- Professional styling pass on the dashboard: layered elevations (panels, rail, modal),
  card shadows, backdrop blur on the modal, refined page headers, button/row hover +
  active states, focus rings, and tidier typography/letter-spacing.
- `go test ./... -race` → 18 packages, 0 races. App rebuilt + restarted clean.
- **HTML + PDF product manual:** `docs/PRODUCT_MANUAL.html` (self-contained, all 7
  dashboard screenshots base64-embedded) and `docs/PRODUCT_MANUAL.pdf` (8 pages,
  ~628KB) generated via headless Chromium `--print-to-pdf`.

## Session 17 (2026-08-16) — Differentiator A: local-model GPU-hour cost accounting
Per the differentiation roadmap (docs/DIFFERENTIATION-ROADMAP.md), implemented the
first/strongest differentiator:
- **`type: local` provider** (self-hosted vLLM/llama.cpp/custom) — registers as an
  OpenAI-compatible provider (bootstrap `wrapProviders`), hot-reloadable like any
  provider.
- **GPU-hour pricing (Mode 1):** `pricing.LocalProviderConfig` (+ `ProviderConfig.Local`)
  and `pricing.localPricing` — cost = GPU-hour rate at a conservative declared
  throughput (safety factor) with a per-request GPU-second floor; `pricing.Build`
  maps `type: local` providers to it, all others to the per-token table.
- **Fixed the EstimateCost/budget defect:** `openai.Provider` now takes the registry
  key as its name (so local vs cloud price identically), and `enforceBudget` prices
  the pre-check through `interfaces.Pricing` (`estimatedCost`/`estimateUsage`) instead
  of the hardcoded gpt-4o placeholder — so budget pre-check and post-usage agree.
- Added `providers.local` example + tests in `pricing/price_test.go`.
- Verified end-to-end: local provider routed a request; `/cost` recorded GPU-hour cost
  (~$0.0025 = floor + tokens), not per-token placeholder. `go test ./... -race` → 18,
  0 races. Local shipped disabled by default.

## Session 18 (2026-08-16) — Provenance: Proof of Source / Proof of Human
- New `internal/components/provenance` package (Ed25519): `Signer`/`GenerateSigner`/
  `Verify` over a canonical `Attestation` (version, signer, source, content hash,
  timestamp). Attestation sources: `human`/`model`/`unknown`. `Verdict.HumanProof()`
  = valid AND source=="human".
- `provenance.Middleware` (lightweight ingestion guard): reads `X-Helm-Provenance`
  header, verifies against request body, attaches a Verdict to context, fail-closed
  403 when `requireValid` and invalid.
- API: `GET /api/v1/provenance` (public key info), `POST /api/v1/provenance/sign`,
  `POST /api/v1/provenance/verify` (returns `verdict` + `proof_of_human`).
- Wired a server signer via `provenance.LoadOrGenerateServerKey`; optional persistent
  key via `MH_PROVENANCE_PRIVATE_KEY` (else ephemeral). Travels the same trust story as
  audit anchoring + skill signing.
- Tests: `provenance/provenance_test.go` (round-trip, tampered payload, re-attributed
  source, wrong key, HumanProof, middleware fail-closed). Verified end-to-end via API.
  `go test ./... -race` → 19 packages, 0 races.

## Session 19 (2026-08-16) — Integration QA + free/open-source providers
- Orchestrated a QA/integration team:
  - **QA Kitten (Playwright):** 7/7 pages PASS, **0 console errors**, dark theme
    intact; **Cost page correctly integrates with the Operators budget store**
    (set soft/hard on Operators → shows on Cost; per-row Budget pre-fills). Captured
    `08-cost.png` + `09-configuration.png`.
  - **Code reviewer:** primary HTTP path integrated soundly (all deps set, routes
    registered, NewProvider(name,…) propagated, no double-count). Fixed 3 findings:
    M-2 provenance `sign` is now **admin-gated** (only admins mint "human"
    attestations); L-1 provenance info/verify are **nil-safe** (503 if no key);
    M-1 the **MCP proxy now prices through `d.Pricing`** (GPU-hour for local
    providers) so agent/HTTP paths agree. (Remaining Low: `/cost` spend is
    estimate-based — documented.)
  - **web-retriever:** verified free/open-source supplier endpoints.
- **Added free/open-source providers** to `config.yaml` (OpenAI-compatible):
  `nous` (https://inference-api.nousresearch.com/v1, Hermes models),
  `kilo` (https://api.kilo.ai/api/gateway, $0/forever + `:free` models),
  `opencode` (https://opencode.ai/zen/v1, always-free models e.g. opencode/hy3-free).
  All shipped `enabled:false`; enable + add an API key in the dashboard to test open
  models at low/no cost. Full research in `/home/moonbuggy/research_llm_providers.md`.
- `go test ./... -race` → 19 packages, 0 races.
- **Regenerated `docs/PRODUCT_MANUAL.html` + `.pdf`** with all new sections (local
  GPU-hour accounting, free/open-source suppliers, Provenance/Proof-of-Human,
  Cost) and all 9 screenshots (incl. Cost + deep Configuration) base64-embedded;
  8-page PDF via headless Chromium.

## Session 20 (2026-08-16) — Free-tier provider integration + integration QA team
- **Team**: agency-web-retriever (live-verified suppliers) + agency-quality-code-reviewer
  (provider-wiring audit). Findings:
  - **Kilo Gateway = TRULY keyless free** (`$0/forever`, 200 req/h/IP anon); base
    `https://api.kilo.ai/api/gateway` (no /v1 in host — added `/v1` for /models+
    /chat/completions). Free ids like `tencent/hy3:free`, `openrouter/free`.
  - **OpenCode Zen = keyless free** over `/chat/completions` (`opencode/hy3-free`,
    `deepseek-v4-flash-free`, etc.); `/v1` required.
  - **Nous = NOT free**: API needs a portal key OR on-chain Solana USDC (x402). Its
    “free tier” is only the Nous Chat web app. Kept as a paid-key provider; comment fixed.
  - **OpenCode Go = PAID subscription** ($10/mo, own endpoint `opencode.ai/zen/go/v1`,
    models `opencode-go/*`). Added as disabled/openai with clear “not free” note.
- **Audit-driven fixes**: (1) `openai` adapter now trims trailing `/` from base_url;
  (2) **omits `Authorization` when no key** so keyless free tiers don’t send `Bearer ""`;
  (3) wired the documented `MH_PROVIDERS_<NAME>_API_KEY/_ENABLED/_BASE_URL` env
  overrides (viper can’t resolve dynamic map keys) via `applyProviderEnvOverrides`.
- **Verified end-to-end**: env-overrode `kilo` → mock OpenAI-compat server; manager-minted
  key shared via Redis; proxy routed keyless request to the mock which logged
  `auth: null` and replied `FREE-TIER-OK`. `go test ./... -race` = 19 pkgs, 0 races.
- Added regression test `TestKeylessFreeTierOmitsAuthHeader` (keyless + trailing-slash).

## Session 13 (2026-08-16) — Applied the Halter brand
- Per the brand/pricing recommendation (docs/BRAND-AND-PRICING-recommendation.md),
  applied the **Halter** brand to user-facing surfaces:
  - Dashboard: `<title>` → "Halter — AI Governance Control Plane"; rail + login
    brand → Halter; login tagline → "Rein in every model. Direct every prompt.";
    rail eyebrow → "AI GOVERNANCE · CONTROL PLANE".
  - Added a Control-Teal `--brand` accent (light-theme) to the rail/login brand
    and the login-card top border.
  - README retitled to "Halter — AI Governance Control Plane" (engineering/codebase
    stays `management-harness`).
- Engineering identifiers (Go module, binaries, config files, log lines) intentionally
  unchanged — the brand is Halter; the project name stays `management-harness`.
- Deferred: API key prefix `hk_` → `hx_` migration (would touch auth/tests).
- Later the same session, the founder chose **Helm** over Halter; the brand was
  switched to Helm end-to-end (Helm = the control surface that steers the vessel;
  tagline "Command every model. Own the stack."). Collision note: "Helm" is also
  the Kubernetes package manager, so trademark/discoverability should be checked.

## Session 14 (2026-08-16) — Dark "operators at night" theme
- Summoned the UI Designer to implement the visual-identity dark theme; applied a
  dark `:root` + override block to the dashboard stylesheet (appended last, so it
  wins the cascade; JS unaffected).
- Palette: ink-900 `#0B1220` paper, ink-800 `#101829` fields, slate-100 `#E2E8F0`
  text, Control Teal `#2DD4BF` actions, Signal Blue `#38BDF8` focus; semantic Pass
  `#34D399` / Warn `#FBBF24` / Deny `#F87171`; dark panels/modals/backdrop, badges,
  and AA-safe teal buttons (`#06251F` text). `color-scheme: dark` set.
- Verified: JS `node --check` OK; dark tokens served on :8090; app green.

## Session 15 (2026-08-16) — Playwright QA + screenshots + product manual
- Installed Playwright Chromium (was missing; that was blocking browser QA).
- Orchestrated the QA Kitten for a real-browser pass on :8090 (login + all 6 nav
  pages): **PASS** — zero console errors, seeded data verified (3 operators,
  policy, "support-reply" skill, audit chain INTACT), dark theme confirmed exact
  (bg #0B1220, panels #101829, text #E2E8F0, teal #2DD4BF), no contrast or layout
  regressions. One Low/cosmetic note: active rail highlight uses Signal Blue
  (#38BDF8) vs Control Teal — intentional accent.
- Captured 7 full-page screenshots to `docs/screenshots/` (01-login … 07-audit;
  valid 1280px PNGs).
- Created `docs/PRODUCT_MANUAL.md` — operator manual: overview, quick start,
  architecture, concepts, config, dashboard tour, skills, optimisation, NVIDIA,
  security/compliance, API reference, ops, troubleshooting, editions, screenshots.

## Session 16 (2026-08-16) — Cost management view + NVIDIA-key discoverability
- **NVIDIA key discoverability:** removed the fake `nvapi-your-key` placeholder from
  `config.yaml` so the nvidia provider shows as "not set" (inviting API-key field);
  added a hint in the Configuration → Providers panel ("paste your nvapi-… key…").
- **Cost & Savings page (`/api/v1/cost` + dashboard Cost nav):** per-operator
  budget + usage table (soft/hard limits, spend, tokens, requests, over-budget
  status) with inline Budget edit; summary readouts (total spend, tokens, optimizer
  tokens saved, users over budget).
- **Cross-process savings:** new `observability/savings` store (memory default,
  Redis when enabled); the proxy records optimizer token savings into it; the
  dashboard reads them back. Verified end-to-end: optimized skill call → `/cost`
  returned `optimizer_tokens_saved=2`, `total_spend=$0.00785`.
- `go test ./... -race` → 18 packages, 0 races. App rebuilt + restarted clean.
