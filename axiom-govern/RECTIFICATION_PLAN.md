# Rectification Plan — Management Harness

Status as of **2026-08-15**. Scope: pre-production gate review hardening of the
proxy + manager + core components. Severity tiers: **Critical** (must-fix before
any deploy), **High** (must-fix before production traffic), **Remaining** (post-hardening
polish / verification that was explicitly deferred).

Legend: ✅ Done · 🟡 Partial · ⬜ Not started

---

## Status Overview

| ID | Item | Status |
|----|------|--------|
| CRIT-001 | Request timeouts + TLS hardening | ✅ Done |
| CRIT-002 | Request body size limit | ✅ Done |
| CRIT-003 | Secrets via env (remove PostgresConfig) | ✅ Done |
| CRIT-004 | CORS restriction | ✅ Done |
| CRIT-005 | Input validation | ✅ Done |
| CRIT-006 | In-memory store hardening / memory warnings | ✅ Done |
| CRIT-007 | PII redaction (audit + responses) | ✅ Done |
| CRIT-008 | Budget enforcement wired into proxy | ✅ Done |
| CRIT-009 | Router / `selectProvider` wired | ✅ Done |
| CRIT-010 | Audit no-drop + chain persistence + proxy rate limit + X-Request-ID | ✅ Done |
| HIGH-001 | Realistic `/readyz` (detached ctx + BudgetStore.Ping) | ✅ Done |
| HIGH-002 | Manager `/metrics` + `/readyz` + `/livez` parity | ✅ Done |
| HIGH-003 | Accurate request durations on all handlers | ✅ Done |
| HIGH-004 | Circuit breaker component + wiring | ✅ Done |
| HIGH-005 | Richer metrics (breaker state, budget-exceeded, cost) | ✅ Done |
| HIGH-006 | MCP governance (guardian + budget + audit) | ✅ Done |
| HIGH-007 | Manager RBAC (role/permission enforcement) | ✅ Done |
| HIGH-008 | PostgresConfig removed (verify no refs) | ✅ Done |
| HIGH-009 | Budget monthly/quarterly/annual rollover | ✅ Done |
| REM-001 | Wire `RecordCost` (per-identity cost) into proxy handlers | ✅ Done |
| REM-002 | Make circuit-breaker thresholds configurable via config | ✅ Done |
| REM-003 | Integration / E2E test for full proxy pipeline | ✅ Done |
| REM-004 | Performance re-baseline (P95 < 50ms) | ✅ Done |
| REM-005 | Unify shared middleware chain (proxy vs manager) | ⬜ Deferred |

---

## Done (verified)

### Critical batch (CRIT-001..010)
- **CRIT-001** — Per-request client/server timeouts and TLS config hardened.
- **CRIT-002** — Hard request body size limit on proxy + manager.
- **CRIT-003** — All secrets sourced from env (`MH_*` vars, `.env.example`); dead
  `PostgresConfig` removed (HIGH-008 confirms zero postgres references in Go).
- **CRIT-004** — CORS restricted to configured origins.
- **CRIT-005** — Request payloads validated before use.
- **CRIT-006** — In-memory store hardened; memory-pressure warnings.
- **CRIT-007** — PII redaction applied to audit records and streamed responses.
- **CRIT-008** — Budget `Check`/`RecordUsage` enforced in proxy after auth.
- **CRIT-009** — `selectProvider` wired so a configured provider is actually used.
- **CRIT-010** — Audit writer made non-blocking (no-drop) with chain-file
  persistence; proxy rate limiter + `X-Request-ID` correlation.

### High batch (HIGH-001..009)
- **HIGH-001** — `handleReady` uses a detached 2s context and pings `BudgetStore.Ping`
  (added to the `BudgetStore` interface; implemented for memory + redis stores).
- **HIGH-002** — Manager `server.go` now serves `/metrics` (`MetricsCollector.Handler()`),
  `/readyz` (`handleReady` pings BudgetStore), `/livez`. Smoke-tested: all 200.
- **HIGH-003** — `handleChatCompletion`, `handleChatStream`, `handleAnthropicMessages`
  record real durations + status. Fixed a real gap: the no-provider 503 path in
  `handleChatCompletion` was not recording a metric — now records
  `("none", model, "unavailable")` so `/metrics` populates even with no upstreams.
- **HIGH-006** — `internal/adapters/mcp/proxy.go` `handleToolsCall` runs the guardian
  scan (block injection/jailbreak, PII redact), budget check/record when `RequireAuth`,
  audit log, and response redaction. `audit()` made nil-safe.
- **HIGH-007** — `internal/api/middleware/auth.go` resolves `*models.Identity` from JWT
  claims / admin token; `RequireRole`/`RequireAdmin`/`hasAnyRole`/`IdentityFromContext`
  added; manager mutating routes gated by `RequireAdmin`. Tests added.
- **HIGH-008** — `grep -rin "Postgres\|postgres"` across Go sources returns nothing.
- **HIGH-009** — `internal/components/budget/period.go` (`PeriodStart`, `rolloverUsage`)
  applied to `GetUsage`/`IncrementUsage` (memory) and `GetUsage`/`resetUsage` (redis, Lua).
  Tests added.

---

## Done — finish work (HIGH-004 / HIGH-005 / REM-001..004)

### HIGH-004 — Circuit breaker (configurable thresholds) ✅
- ✅ `internal/components/circuitbreaker/breaker.go` wraps `LLMProvider`
  (closed/half-open/open, trips after N consecutive failures, cooldown probe);
  `HealthCheck`/`EstimateCost` bypass the breaker. Wired in `bootstrap.Build`.
- ✅ Thresholds are now config-driven: `Config.Breaker` (global) + per-provider
  `ProviderConfig.Breaker` override, read in `internal/bootstrap/bootstrap.go`
  instead of `circuitbreaker.DefaultConfig()`. Added `Config()` accessor to the
  breaker so tests can inspect resolved thresholds.

### HIGH-005 — Richer metrics (cost now recorded) ✅
- ✅ `breakerState` gauge (0/1/2), `budgetExceeded` counter, token counters
  (`RecordTokens`) all wired and emitting.
- ✅ `MetricsCollector` switched to a dedicated `*prometheus.Registry` + `Handler()`
  so exposition is independent of the global default registry.
- ✅ **REM-001:** `RecordCost` is now invoked from the proxy completion, stream, and
  Anthropic success paths via a `recordCost(d, r, provider, model, usage)` helper that
  prices `resp.Usage` through `deps.Pricing` (new `internal/core/pricing` package with
  a built-in rate table + `PricingConfig.default_rate` fallback).

### REM-002 — Configurable circuit-breaker thresholds ✅
- Added `BreakerConfig` (`max_failures`, `cooldown`) to `Config` and `ProviderConfig`,
  plus `setDefaults` (5/10s) and a `breaker` section in `configs/config.yaml`.
- `internal/bootstrap/bootstrap_test.go` asserts both the global value and the
  per-provider override are honoured.

### REM-003 — Integration / E2E test for the full proxy pipeline ✅
- `cmd/proxy/proxy_integration_test.go` (package `main`, uses the real `setupRouter`)
  covers: unauth→401, success+cost metric, injection→403, PII redact, budget
  exceeded→402, breaker trips→`StateOpen`. Uses an in-process fake upstream
  `LLMProvider`.

### REM-004 — Performance re-baseline (P95 < 50ms) ✅
- `TestProxyLatencyBaseline` in `cmd/proxy/proxy_integration_test.go` drives 200
  authenticated requests through the full hardened chain and asserts P95 < 50ms
  (loop repeats until the baseline is stable).

---

## ⬜ What Is Left To Do (explicit)

1. **REM-005 — Unify shared middleware chain (deferred).**
    - Proxy applies `d.Auth.Middleware` (auth) but not `RequireRole`; manager applies
      `RequireAdmin`. Consider a shared identity/RBAC middleware package so role checks
      are consistent across both binaries. Deferred — proxy does not currently need
      per-role gating, only identity for budget keying. (No other outstanding items.)

---

## Verification (last run, 2026-08-15 — Session 6)
- `go build ./...` → clean
- `go vet ./...` → clean
- `go test ./... -count=1` → all packages pass
  (new this session: `internal/core/pricing` unit tests, `internal/bootstrap`
  config-driven breaker tests, `cmd/proxy` integration + P95 latency baseline).
- `cmd/proxy/proxy_integration_test.go` asserts the full chain: auth→guardian
  (injection block + PII redact)→budget (allow + exceed)→circuit breaker (trip)→
  metrics (cost + breaker state), and P95 < 50ms across 200 requests.
- `internal/bootstrap/bootstrap_test.go` asserts global `breaker.max_failures`/
  `cooldown` and per-provider `providers.<name>.breaker` overrides are honoured.
- Manager smoke (unchanged): `/healthz`,`/readyz`,`/livez` → 200; `/api/v1/users`
  without token → 401; with admin token → 201.

## Session 7 (2026-08-16) — review & rectify (two new defects)

| ID | Item | Status |
|----|------|--------|
| RV-001 | Audit hash-chain data race (`persistChain` vs `Log`) | Fixed |
| RV-002 | Manager audit trail dead (disconnected sink; no manager audit logging) | Fixed |

- **RV-001** — `go test ./... -race` (the README's `make test`, previously un-run)
  caught a write/read race between `AuditLogger.Log` (`chain.Next` under `l.mu`)
  and `persistChain` (`chain.Current` outside the lock). `persistChain` now reads
  `Current()` under `l.mu` (`internal/observability/audit/logger.go`).
- **RV-002** — The manager audit endpoints (`/audit/events`, `/audit/verify`,
  `/audit/export`, overview counts) read from an orphaned `MemorySink` that nothing
  wrote to; manager mutating handlers never logged audit events. Fixed by exposing
  `AuditLogger.Events()`, pointing the endpoints at the real `deps.Audit`, adding an
  `auditEvent` helper (`internal/api/audit.go`) wired into all admin handlers, and a
  regression test. `VerifyChain` now returns `false` when no memory sink is present.

Final gates this session: `go build` clean, `go vet` clean,
`go test ./... -race -count=1` → 17 packages pass, 0 data races.

## Out of scope / explicitly dropped
- **Postgres stores** — removed dead `PostgresConfig` rather than implementing
  Postgres backends (HIGH-008). Redis + in-memory remain the only BudgetStore impls.
