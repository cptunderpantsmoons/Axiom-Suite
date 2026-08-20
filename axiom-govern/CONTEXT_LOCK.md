# Context Lock — Management Harness

Single source of truth for project state, quality-gate evidence, and open items.
Last verified: **2026-08-16** (Review & Rectification session).

## Identity

- **Repo**: `/home/moonbuggy/Documents/Management Harness` (git)
- **Module**: `github.com/laiw/management-harness`
- **Brand**: **Helm** — "Command every model. Own the stack." (see
  `docs/BRAND-AND-PRICING-recommendation.md`, `PRICING_STRATEGY.md`). Applied to
  the dashboard + README; engineering identifiers stay `management-harness`.
- **UI theme**: dark "operators at night" (ink-900 `#0B1220` paper, ink-800 fields,
  slate-100 text, Control Teal `#2DD4BF` actions, Signal Blue `#38BDF8` focus,
  semantic Pass/Warn/Deny) applied to the dashboard.
- **QA + docs**: `go test -race` → 18 packages; Playwright browser QA on :8090
  PASS (zero console errors, dark theme confirmed); 7 screenshots in
  `docs/screenshots/`; operator manual at `docs/PRODUCT_MANUAL.md`.
- **Language/Toolchain**: Go 1.25.13 (linux/amd64)
- **Binaries**: `cmd/proxy`, `cmd/manager`, `cmd/mcp-proxy`

## Quality Gates (all PASS — verified with evidence this session)

| Gate | Command | Result |
|------|---------|--------|
| Compile | `go build ./...` |  clean (all 3 binaries build) |
| Static analysis | `go vet ./...` |  clean |
| Unit/integration tests | `go test ./... -count=1` |  17 packages `ok` |
| Race detector | `go test ./... -race -count=1` |  17 packages `ok`, **0 data races** |

> `go test ./... -race -count=1` is the README's canonical `make test`. This gate
> was previously **not** run (prior sessions used `-count=1` only), which is why a
> latent data race went undetected until this session.

## Defects found & fixed this session

### DEFECT-1 — Data race in audit hash chain (CRITICAL correctness)
- **What**: `AuditLogger.persistChain()` read `HashChain.previous` via `Current()`
  *after* `drain()` released `l.mu`, while `Log()` wrote it via `Next()` *under*
  `l.mu` — a write/read race caught by `-race` in `TestAuditLoggerNoDropAndPersist`.
- **Fix**: `internal/observability/audit/logger.go` — `persistChain()` now reads
  `Current()` under `l.mu`.
- **Evidence**: `go test ./... -race -count=1` now clean (was `WARNING: DATA RACE`
  in `internal/observability/audit`).

### DEFECT-2 — Manager audit trail was dead
- **What**: The manager's `/api/v1/audit/events`, `/audit/verify`, `/audit/export`,
  and `/overview` (audit counts) read from a disconnected `s.auditSink` (a
  `MemorySink` created in `NewServer` that **nothing ever wrote to**). Manager
  handlers never called `d.Audit.Log()`. Result: audit endpoints returned empty
  and `verified:true` vacuously even after admin actions.
- **Fix**:
  - `internal/observability/audit/logger.go`: added `Events()` accessor (returns
    the real hash-chained memory-sink snapshot).
  - `internal/api/server.go`: removed the disconnected `auditSink`; overview now
    uses the real logger.
  - `internal/api/handlers_audit.go`: list/export read `s.auditEvents()`; verify
    delegates to `s.deps.Audit.VerifyChain()`.
  - `internal/api/audit.go` (new): `auditEvent()` helper (records admin actions
    with actor identity) + nil-safe `auditEvents()`/`auditVerified()`.
  - Wired `auditEvent` into all mutating admin handlers: `handlers_users.go`,
    `handlers_keys.go`, `handlers_budget.go`, `handlers_policies.go`.
  - `internal/api/handlers_audit_test.go` (new): regression test.
- **Evidence**: runtime + unit test (see Runtime smoke test below).

### Review hardening (from second-opinion code review)
- `VerifyChain()` now returns `false` (not misleading `true`) when no `MemorySink`
  is configured.
- Read handlers use nil-safe `auditEvents()` / `auditVerified()` helpers (matching
  the guard already on `auditEvent`).

## Runtime smoke-test evidence (real binaries, real HTTP)

Manager (`MH_CONFIG_FILE=./configs/config.yaml`, on :8090) and proxy (:8080)
booted and exercised with curl:

| Endpoint | Expected | Observed |
|----------|----------|----------|
| manager `/healthz`,`/readyz`,`/livez` | 200 | 200 / 200 / 200 |
| manager `/metrics` | 200 | 200 (see *Known limitations*) |
| manager `/api/v1/users` (no token) | 401 | 401 |
| manager `/api/v1/users` (admin token) | 200 | 200 |
| manager `POST /api/v1/users` (admin) | 201 | 201 (JSON user returned) |
| manager `/api/v1/audit/events` after create | ≥1 event | 1 event: `admin.user.create`, `user_id=admin`, `previous_hash=harness-genesis-v1` |
| manager `/api/v1/audit/verify` | true | `{"verified":true}` |
| manager `/api/v1/overview` | counts | `audit_events_count:1, users_count:1` |
| manager `/api/v1/audit` file sink (NDJSON) | persisted | `admin.user.create success admin` written |
| manager audit chain file | persisted | hash written to chain file |
| proxy `/healthz`,`/readyz`,`/livez`,`/metrics` | 200 | 200 / 200 / 200 / 200 |
| proxy `POST /v1/chat/completions` (no auth) | 401 | 401 |
| proxy completion with `require_auth=false`, no provider | 503 | `{"error":"no provider available"}` 503 |
| proxy `/metrics` after traffic | populated | `harness_proxy_requests_total{...status="unavailable"} 1` (1858 bytes) |

Full chain (auth→guardian→budget→breaker→metrics, P95<50ms) is additionally
covered by `cmd/proxy/proxy_integration_test.go`, which passes under `-race`.

## Deferred / known limitations (not gate-blocking)

1. **REM-005** — unify proxy/manager middleware chain (deferred; proxy needs only
   identity for budget keying, not per-role gating).
2. **Manager `/metrics` always empty** — the manager exposes `/metrics` but records
   no metric of its own (only the proxy calls `RecordRequest`/`RecordTokens`/
   `RecordCost`). Endpoint is valid but has no data.
3. **Cross-process audit/overview visibility** — the audit log is per-process (no
   shared audit sink); `handleOverview`'s `requests`/`threats_blocked` stay 0 in the
   manager when the proxy and manager run as separate processes. (API keys and
   budgets are now shared via Redis — see client-readiness section.)
4. **No default TLS / no container HEALTHCHECK** — proxy/manager serve plaintext on
   `0.0.0.0`; the Dockerfile has no `HEALTHCHECK`. Terminate TLS at a reverse proxy
   and add orchestrator-level probes.

## Client-readiness completion (2026-08-16)

Packaging + deployment hardening completed on top of the two code defects above:

- **Docker** — build stage `golang:1.25-alpine` (fixed an unbuildable image);
  `CMD ["/app/proxy"]` (overridable) so proxy/manager/mcp run from one image.
  Verified: `docker build` succeeds; proxy and manager containers both boot with
  `/healthz` 200.
- **docker-compose** — dropped the unused Postgres service; Prometheus now scrapes
  the real `/metrics` endpoints (proxy :8080, manager :8090, `extra_hosts` for Linux).
- **README / .env.example** — corrected Go version + status, removed the phantom
  Kubernetes/Terraform claim, added Docker run instructions and a Persistence
  section; `.env.example` placeholder secrets now fail-fast in `Validate()`.
- **Redis-backed API keys (RV-005)** — new `auth.RedisKeyStore` wired in
  `bootstrap.go`; `MH_REDIS_ENABLED=true` now shares keys + budgets + usage across
  processes, so the manager→proxy key flow works in multi-process/container
  topologies (verified end-to-end: minted key authenticates across processes; bogus
  key → 401).

## Dashboard configuration control plane (2026-08-16)

The manager dashboard (`/` → Configuration) is now a full control plane:
- **Providers + API keys**: add/edit/enable/remove providers and their keys; they
  **reload live** on the proxy (no restart).
- **Settings**: guardian, proxy (require_auth/default_provider/max bytes),
  breaker, pricing, metrics, Redis, and manager secrets (`admin_token`/
  `jwt_secret`) — persisted and applied on restart.
- Persisted to `configs/runtime.json` (`MH_RUNTIME_CONFIG` override); secrets are
  masked on read and preserved when left blank on update. Admin `PUT /api/v1/config`
  writes; a file watcher in `bootstrap` hot-reloads the provider registry.

## Skills & prompt optimisation (2026-08-16)

- **Skills** — reusable, versioned prompt contracts (system prompt + `{{slots}}`
  template + typed params + permissions). Stored in `configs/skills.json`
  (`MH_SKILLS_FILE`), hot-reloaded; invoked via `skill`/`skill_params` on the
  request body; admin CRUD at `/api/v1/skills`; dashboard Skills page.
- **Prompt optimisation** — the old lowercasing `DefaultCompressor` was replaced
  with a lossless whitespace normaliser; optimisation is skill-scoped
  (`skill.Optimize`) and reported under `harness_optimizer_*` metrics.
- **NVIDIA Nemotron integration** — `optimizer.LLMCompressor` (lossy LLM prompt
  optimisation) and `POST /api/v1/skills/draft` (skill-creation wizard / "Draft
  with AI") both call an OpenAI-compatible provider; an `nvidia` provider entry
  (`https://integrate.api.nvidia.com/v1`) + `optimizer:` block ship in `config.yaml`
  (default model `nvidia/nemotron-3.5-lightning-30b-a3b`). Verified against a mock
  NIM endpoint; enable with `MH_OPTIMIZER_ENABLED=true` + a real `nvapi-` key.
- `go test ./... -race` → 18 packages, 0 data races.

## How to re-verify

```bash
go build ./...
go vet ./...
go test ./... -count=1
go test ./... -race -count=1   # matches README `make test`
```

Run services for smoke testing (secrets must be non-insecure, see
`internal/core/config/config.go`):
```bash
export MH_MANAGER_ADMIN_TOKEN=... MH_MANAGER_JWT_SECRET=... MH_CONFIG_FILE=./configs/config.yaml
```
---

## Deep Review & Commit (2026-08-17)

Independent deep review before commit. Verified:

- `go build ./...`, `go vet ./...`, `go test ./... -race -count=1` (20 pkgs) — clean, 0 races.
- `govulncheck ./...` — **No vulnerabilities found**.
- `docker build` — **succeeds** (`mh-review:test` built), confirming DEFECT-1 resolved.
- DEFECT-2/3 verified: README no longer claims committed K8s/Terraform/Postgres;
  docker-compose has only redis/prometheus/grafana.
- Secrets audit: configs carry placeholder API keys only; runtime/skills JSON clean.
- Fixes made in this review:
  1. `internal/core/config/smoke_test.go` — replaced machine-specific absolute
     config path (`/home/moonbuggy/…`) with a cwd-relative portable path resolved
     from the package dir + graceful `t.Skip` when absent.
  2. `internal/core/config/config.go` — consolidated two redundant `defer recover()`
     blocks in `parseLocalBlocks` into one; surface failures on stderr (previously
     swallowed silently, which hampered earlier debugging).
  3. `gofmt -w` on both files.
