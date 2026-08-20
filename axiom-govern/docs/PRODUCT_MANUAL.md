# Helm — Product Manual

**Helm** — the enterprise AI governance control plane.
*Tagline: Command every model. Own the stack.*

> Engineering/codebase name: `management-harness` (Go). This is the operator's
> manual for the product (brand: Helm).

---

## 1. What Helm is

Helm is a single control plane that sits between a company's AI tools (Claude
Desktop/Code, Cursor, Cline, custom agents) and upstream LLM providers (OpenAI,
Anthropic, NVIDIA NIM/Nemotron). It governs every model call in one place:

- **Who** may call (unified, hashed `hk_` API keys + roles)
- **What it costs** (per-user/team/org soft + hard budgets, cost-aware routing)
- **What it is allowed to say** (a security Guardian, a policy engine, PII redaction)
- **And a record it happened** (immutable, hash-chained audit log)

| Pillar | Components |
|--------|-----------|
| Govern & secure | auth, guardian (injection/jailbreak/PII), policy engine |
| Cost & FinOps | budgets, model router, circuit breakers, prompt optimizer |
| Audit & compliance | SHA-256 hash-chained audit + `/verify`, export, SIEM |
| Productivity | reusable "skills", Draft-with-AI wizard, optimizer telemetry |

## 2. Quick start

```bash
go build ./...                  # or: make build
# two services (share a Redis for cross-process state):
MH_REDIS_ENABLED=true ./bin/management-harness-proxy &
MH_MANAGER_ADMIN_TOKEN=... MH_MANAGER_JWT_SECRET=... ./bin/management-harness-manager &
```
- **Proxy** :8080  — OpenAI-compatible `/v1/chat/completions`, `/v1/chat/completions/stream`, `/v1/messages`
- **Manager** :8090 — `/api/v1/...` + embedded dashboard at `/`
- Ready checks: `/healthz`, `/readyz`, `/livez`, `/metrics`

**First dashboard session:** open `http://localhost:8090/`, sign in with the
manager admin token, then (Operators) create a user and mint an `hk_` key, and
call the proxy with `Authorization: Bearer hk_...`.

## 3. Architecture

```
AI Tool ──► PROXY ─ auth ─ guardian(ORIGINAL) ─ [skill expand] ─ guardian(re-scan)
                ─ optimize ─ budget(EstimateCost) ─ router/selectProvider ─► LLM
                  │
                  ├─ Metrics (Prometheus /metrics)
                  ├─ Audit (hash-chained, immutable)
                  └─ Manager API + Dashboard (:8090)
```
Key ordering invariants:
- The **Guardian always scans the original** user prompt (injection/jailbreak/PII).
- If a **skill** is used, its expanded prompt is **re-scanned** before forwarding.
- Optimization runs **after** the guardian, **before** budget/routing, so the
  charge reflects the tokens actually sent.

## 4. Concepts

| Concept | Description |
|---------|-------------|
| Identity | A user/team/org+role resolved from the API key at auth. Drives budgets + authorization. |
| API keys | `hk_`-prefixed, SHA-256 hashed at rest; minted once via the Manager. |
| Budget | Per-identity **soft** (warn) and **hard** (block) USD limits, monthly/quarterly/annual, Redis-backed. |
| Guardian | Blocks prompt injection / jailbreak / tool-escalation; redacts 18 PII patterns. |
| Policy | Priority-ordered, hot-reloadable YAML rules (allow/block/redact/route). |
| Model router | Cost/performance routing + health checks across providers. |
| Circuit breaker | Trips a flapping provider open (configurable max_failures / cooldown). |
| Audit | Immutable SHA-256 hash chain; `/audit/verify` proves integrity. |
| Skill | A reusable prompt contract (system prompt + `{{slot}}` template + typed params + permissions). |
| Optimizer | Lossless (whitespace) or LLM-based prompt compression, skill-scoped. |

## 5. Configuration

Two layers, both reflected in the dashboard **Configuration** page:
- **Static** — `configs/config.yaml` + `MH_*` env vars (see `.env.example`).
- **Runtime** — editable in the dashboard and persisted to `configs/runtime.json`
  (`MH_RUNTIME_CONFIG`). Providers/API keys reload **live**; other settings apply
  on restart. Secrets are masked on read and preserved when left blank.

Key settings:
- `proxy.require_auth`, `proxy.default_provider`, `proxy.max_request_bytes`
- `guardian.{enabled,block_injection,block_jailbreak,redact_pii}`
- `breaker.{max_failures,cooldown}`, `pricing.default_rate`
- `redis` (shared state, budgets, API keys), `optimizer` (LLM assistant)

### Redis (production)
```
MH_REDIS_ENABLED=true MH_REDIS_ADDR=localhost:6379
```
Redis backs API keys + budgets + usage so the proxy and manager share state
across processes/containers.

## 6. Dashboard tour (dark "operators at night" theme)

| Page | What it does |
|------|-------------|
| **Overview** | Live counts: proxied requests, threats blocked, operators, active policies, audit records, providers. |
| **Operators** | Create/edit/delete users; mint + revoke `hk_` keys; set per-user budgets. |
| **Cost** | Per-operator budgets + spend (soft/hard, tokens, requests), total spend, optimizer tokens saved, inline budget editing. |
| **Policies** | Create/activate hot-reloadable policies. |
| **Skills** | Library of prompt contracts; create/edit + **Draft with AI**; delete. |
| **Configuration** | Edit providers (incl. NVIDIA key), guardian, proxy, breaker, pricing, metrics, optimizer, secrets, Redis — all live-persisted. |
| **Audit Chain** | Hash-linked, immutable event log with live chain-integrity verification. |

## 7. Skills

A **Skill** = `system_prompt` + `template` (with `{{slot}}` placeholders) +
`parameters` (typed/required/enum) + `permissions` (public / teams / owner).

Create via the dashboard (Skills → New) or **Draft with AI**, which asks the
configured LLM (e.g. NVIDIA Nemotron) to generate a full skill from a description.

Invoke from an AI tool by adding fields to the request body (proxy strips them
before forwarding upstream):
```json
{
  "model": "gpt-4o",
  "skill": "support-reply",
  "skill_params": { "message": "My order hasn't arrived", "tone": "professional" }
}
```
Rules: unknown skill → `404`; unauthorized → `403`; invalid/missing params → `400`.
Skills opt in to prompt optimization with `optimize: true`.

## 7b. Local inference (self-hosted) & GPU-hour accounting

Register a self-hosted engine (vLLM, llama.cpp, custom) as a `type: local`
provider — it routes as OpenAI-compatible and is **costed by GPU-hour, not tokens**:

```yaml
providers:
  local:
    type: local
    base_url: "http://vllm:8000/v1"
    enabled: true
    local:
      gpu_hour_cost: 2.5
      gpu_count: 1
      declared_throughput_tps: 90   # conservative shared operating point
      safety_factor: 1.25
      min_gpu_seconds_per_request: 3
```

A shared H100-70B lands ~$1–3/1M tokens (vs ~$1k+ hosted); the per-request
GPU-second floor prevents tiny requests from evading the budget. Budget pre-check
and post-usage both use this model, so the **Cost** page shows real GPU cost.

## 7c. Default Kilo Gateway + NVIDIA provider

The supplied configuration routes normal requests through Kilo by default and
registers NVIDIA Nemotron as the optimizer/direct provider. Both are
OpenAI-compatible providers; supply credentials through environment variables
or the dashboard rather than committing them to config files.

| Provider | Default role | base_url (exact) | Example model |
|----------|--------------|------------------|---------------|
| **kilo** | **Default request gateway**; API key/credits required by current Kilo docs | `https://api.kilo.ai/api/gateway` | `anthropic/claude-sonnet-4.5` or another allowed Kilo model |
| **nvidia** | Default optimizer/direct provider when enabled | `https://integrate.api.nvidia.com/v1` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| opencode (Zen) | Optional OpenAI-compatible supplier | `https://opencode.ai/zen/v1` | `opencode/hy3-free` |
| nous | Optional paid-key supplier | `https://inference-api.nousresearch.com/v1` | `nousresearch/hermes-4-70b` |

Kilo's current gateway documentation uses the base URL without `/v1` and
requires a Kilo account with API credits. The Go adapter appends
`/chat/completions` and omits `Authorization` only when a provider key is
actually blank, which keeps local keyless mocks working without implying that
production Kilo traffic is anonymous.

### Provider env overrides (also supported)
Any configured provider honors `MH_PROVIDERS_<NAME>_API_KEY`, `MH_PROVIDERS_<NAME>_ENABLED`
and `MH_PROVIDERS_<NAME>_BASE_URL`, e.g. `MH_PROVIDERS_KILO_BASE_URL`.

## 8. Prompt optimization

- **Lossless (default):** collapses redundant whitespace.
- **LLM-based (via `optimizer`):** a provider model (e.g.
  `nvidia/nemotron-3.5-lightning-30b-a3b`) rewrites/compresses the prompt; a
  semantic-preservation gate keeps the result only when content is preserved,
  otherwise it falls back to the original.
- Savings are reported as `harness_optimizer_applied_total{skill}` and
  `harness_optimizer_tokens_saved_total{skill}`.

## 9. NVIDIA Nemotron (build.nvidia.com)

OpenAI-compatible; a ready `nvidia` provider + `optimizer:` block ship in
`config.yaml`. Enable in the dashboard (Providers → NVIDIA → API key) or env:
```bash
MH_PROVIDERS_NVIDIA_API_KEY=nvapi-... MH_PROVIDERS_NVIDIA_ENABLED=true \
MH_OPTIMIZER_ENABLED=true MH_OPTIMIZER_PROVIDER=nvidia \
./bin/management-harness-proxy
```
Used for prompt optimization and the skill Draft-with-AI wizard.

## 9b. Provenance — Proof of Source / Proof of Human

Enterprises can sign data entering critical pipelines with an attested **source**
(`human`, `model`, `unknown`) and **verify it wasn't synthetically altered or
model-poisoned**. Ed25519-signed attestations bind the payload's SHA-256 hash to a
signer + source + timestamp.

- **Sign:** `POST /api/v1/provenance/sign` `{source, payload_base64}` → a signed `record`.
- **Verify:** `POST /api/v1/provenance/verify` `{record, payload_base64}` →
  `{"verdict":{...},"proof_of_human":true|false}`. Payload change or source
  re-attribution fails the verdict.
- **Middleware:** mount `provenance.Middleware(pub, requireValid)` on ingestion
  routes; it verifies an `X-Helm-Provenance` header against the body and rejects
  tampered data (fail-closed 403) or exposes `Verdict.HumanProof()` to gate
  synthetic content.
- **Key:** `GET /api/v1/provenance` returns the verifier public key; set
  `MH_PROVENANCE_PRIVATE_KEY` (base64) for a persistent signing key across
  restarts/air-gap.

Use case: gate RAG/enterprise ingestion on `proof_of_human`, or quarantine any
payload signed as `model` (synthetic) until reviewed.

## 10. Security & compliance

- Keys hashed at rest; secrets never leave as plaintext (masked in the dashboard).
- Guardian blocks prompt injection, jailbreaks, tool escalation; redacts PII.
- Immutable audit chain: `GET /api/v1/audit/verify` cryptographically proves no
  event was altered; `GET /api/v1/audit/export` for SIEM ingest.

## 11. API reference (Manager, `/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/users` | List / create users |
| GET/PUT/DELETE | `/users/{id}` | Get / update / delete |
| GET/POST | `/users/{id}/keys` | List / create keys |
| POST | `/users/{id}/keys/{key_id}/revoke` | Revoke key |
| GET/PUT | `/users/{id}/budget` | Get / set budget |
| GET | `/budget/usage` | Usage |
| GET/POST | `/policies` | List / create |
| PUT/POST | `/policies/{id}` + `/activate` | Update / activate |
| GET/POST | `/skills` | List / create skills |
| POST | `/skills/draft` | Draft a skill from a description (LLM) |
| GET/PUT/DELETE | `/skills/{name}` | Get / update / delete |
| GET/PUT | `/config` | Read (masked) / write runtime config |
| GET | `/audit/events` | Audit events |
| GET | `/audit/verify` | Verify hash chain |
| GET | `/overview` | Dashboard counts |
| GET | `/cost` | Aggregate cost, savings, per-operator budgets |
| GET / POST | `/provenance`, `/provenance/sign`, `/provenance/verify` | Proof of Source / Proof of Human |

## 12. Operations

- **Metrics:** Prometheus on `/metrics` (proxy :8080 and manager :8090);
  `prometheus.yml` in `deployments/`. Alerts on `harness_guardian_*`,
  `harness_budget_*`, `harness_optimizer_*`, `harness_proxy_requests_total`.
- **Readiness:** `/readyz` verifies Redis + a healthy provider.
- **Docker:** `docker build -t management-harness .`; run the proxy (default) or
  manager via `docker run ... /app/manager`. Secrets are env-only.

## 13. Troubleshooting

| Symptom | Likely cause / fix |
|---------|-------------------|
| Proxy returns `503 no provider available` | No provider enabled — add one in Configuration → Providers. |
| Proxy returns `401 invalid API key` | Key minted in Manager isn't visible to the Proxy — enable `MH_REDIS_ENABLED=true` to share keys. |
| `manager.admin_token is using an insecure default` | Set real `MH_MANAGER_ADMIN_TOKEN`/`MH_MANAGER_JWT_SECRET`. |
| Audit events empty | Manager audit-trail is per-process; confirm you're creating users/keys after startup and enabling Redis/persistence. |
| Settings "saved" but proxy unchanged | Providers/keys reload live; other settings apply on restart. |
| `fails fast if not provided` panic | Provide the documented env secrets. |

## 14. Editions (see `PRICING_STRATEGY.md`)

Community (self-host, $0) → Pro/Scale ($499/mo + per-token governance fee) →
Enterprise ($2,500/mo + fees, SSO/RBAC/air-gap/SIEM). Feature gates are tiers;
core governance (auth, budget, router, audit) ships in every edition.

## 15. Screenshots (Playwright QA pass)

Captured with Playwright on the current dark "operators-at-night" theme. The QA
run passed: every page rendered with **zero console errors**, the dark palette
was confirmed (bg `#0B1220`, panels `#101829`, text `#E2E8F0`, teal `#2DD4BF`
actions), and there were no contrast or layout regressions.

| Example | File |
|---------|------|
| Login | `docs/screenshots/01-login.png` |
| Overview | `docs/screenshots/02-overview.png` |
| Operators | `docs/screenshots/03-operators.png` |
| Policies | `docs/screenshots/04-policies.png` |
| Skills | `docs/screenshots/05-skills.png` |
| Configuration | `docs/screenshots/06-configuration.png` |
| Audit Chain | `docs/screenshots/07-audit.png` |
| Cost | `docs/screenshots/08-cost.png` |
| Configuration (deep) | `docs/screenshots/09-configuration.png` |