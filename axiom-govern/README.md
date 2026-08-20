# Helm — AI Governance Control Plane

**Helm** (brand name; engineering/codebase remains `management-harness`) is a
production-ready **enterprise AI control plane** — a Go-based proxy gateway that
governs, secures, and optimizes AI tool traffic (Claude Desktop, Claude Code,
Cursor, Cline, custom agents) for enterprise teams.

> Command every model. Own the stack.

It sits between end-user AI tools and upstream LLM providers (OpenAI, Anthropic),
providing:

- **Unified authentication** via `hk_`-prefixed API keys (SHA-256 hashed, never stored raw).
- **Per-user / team / org budget enforcement** with soft/hard limits.
- **Security guardian** — prompt-injection, jailbreak, tool-escalation detection and PII redaction (18 PII patterns).
- **Policy engine** — priority-ordered, hot-reloadable YAML rules.
- **Model router** — cost/performance-based provider selection with health checks.
- **Immutable audit logging** — SHA-256 hash-chained events, tamper-evident.
- **Prompt optimizer** — compression with semantic-preservation safeguards.
- **Observability** — Prometheus metrics and a management dashboard.

## Architecture

```
AI Tool ──► Proxy (auth → budget → guardian → router → provider) ──► LLM
              │
              ├── Metrics (Prometheus)
              ├── Audit (hash-chained, immutable)
              └── Manager API + Web Dashboard
```

Components are modular and independently testable:

| Component | Package |
|-----------|---------|
| Core models / interfaces | `internal/core/models`, `internal/core/interfaces` |
| Config | `internal/core/config` (Viper) |
| Auth | `internal/components/auth` |
| Budget | `internal/components/budget` |
| Guardian | `internal/components/guardian` |
| Policy | `internal/components/policy` |
| Router | `internal/components/router` |
| Optimizer | `internal/components/optimizer` |
| Cache | `internal/components/cache` |
| Providers | `internal/adapters/{openai,anthropic,mcp}` |
| Observability | `internal/observability/{metrics,audit}` |
| Manager API | `internal/api` |
| Proxy / Manager / MCP | `cmd/{proxy,manager,mcp-proxy}` |

## Quick start

```bash
# 1. Install Go 1.25+ and dependencies
go mod download

# 2. Build all binaries
make build            # -> bin/management-harness-{proxy,manager,mcp}

# 3. (Optional) Start local infra (Redis, Prometheus, Grafana)
make docker-up

# 4. Run the proxy + manager
MH_CONFIG_FILE=./configs/config.yaml ./bin/management-harness-proxy &
MH_CONFIG_FILE=./configs/config.yaml ./bin/management-harness-manager &
```

The proxy listens on `:8080` (OpenAI-compatible `/v1/chat/completions`,
`/v1/messages`, streaming at `/v1/chat/completions/stream`). The manager
listens on `:8090` (`/api/v1/...` + embedded dashboard at `/`).

## Axiom stack integration

The proxy accepts an optional gateway-local `axiom` envelope on chat requests.
It validates the `axiom.taskpacket.v1` schema, checks the deterministic packet
hash and packet/intent identifiers, records the Ground snapshot and Compile
references in sanitized hash-chained audit details, and strips the envelope
before forwarding upstream. Existing OpenAI-compatible clients remain unchanged.

```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "<task_contract>...</task_contract>"}],
  "axiom": {
    "schema_version": "axiom.taskpacket.v1",
    "taskpacket_id": "<Compile packet_id>",
    "packet_hash": "sha256:<64 hex characters>",
    "compile": {
      "contract_version": 1,
      "intent_id": "<Compile intent_id>",
      "mode": "one-shot",
      "risk_score": 0.2,
      "dangerous": "none"
    },
    "ground": {
      "project_id": "ctxproj_...",
      "snapshot_hash": "ctxsnap_...",
      "prompt_pack_id": "ctxprompt_...",
      "drift_score": 4,
      "code_index_hash": null
    },
    "task_packet": {}
  }
}
```

The `axiom` object is never sent to the provider. Audit details retain only
identifiers, hashes, risk metadata, and Ground references—not the packet body.

## Configuration

Configuration is loaded from `configs/config.yaml` and overridden by
`MH_*` environment variables (e.g. `MH_SERVER_PORT`, `MH_PROXY_REQUIRE_AUTH`).
See `.env.example` for the full list.

The supplied config defaults normal traffic to the Kilo AI Gateway and keeps
NVIDIA Nemotron as the optimizer/direct-provider path. Kilo and NVIDIA are
registered by default; supply `MH_PROVIDERS_KILO_API_KEY` and
`MH_PROVIDERS_NVIDIA_API_KEY` before sending traffic. Other providers remain
opt-in under `providers:` in `configs/config.yaml` (or from the **dashboard
Configuration page**).

> **Dashboard control plane.** The manager dashboard (`/`) lets you add, edit,
> enable, and remove providers (with their API keys), tweak guardian/proxy/
> breaker/pricing/metrics settings, and rotate secrets — without editing files.
> Changes are persisted to `configs/runtime.json` (override with
> `MH_RUNTIME_CONFIG`). Providers (and their keys) **reload live** on the proxy;
> other settings apply on restart.

## Skills

Skills are named, reusable, governed prompt contracts: a **system prompt** plus
**templated body** with typed `{{slots}}`, declared parameters, and permissions.
They are authored in the dashboard (Skills page) or via the API, persisted to
`configs/skills.json`, and hot-reloaded by the proxy.

Invoke a skill by sending `skill` and `skill_params` on the request body — the
proxy expands the skill, validates the parameters, and strips the skill fields
before forwarding upstream:

```json
{"model":"gpt-4o","skill":"summarize","skill_params":{"text":"…","audience":"associate"}}
```

Skills marked `optimize` have their user prompt optimised before being sent
upstream — losslessly (whitespace-collapsed) by default, or by the configured LLM
(e.g. NVIDIA Nemotron) when `optimizer.enabled` is set. Savings are reported
under the `harness_optimizer_*` metrics.

The skill editor's **Draft with AI** button calls `POST /api/v1/skills/draft` to
generate a skill (system prompt, `{{slot}}` template, parameters) from a plain-
language description using the configured LLM provider.

### Default Kilo Gateway + NVIDIA Nemotron
Normal requests default to the OpenAI-compatible Kilo AI Gateway:

```bash
MH_PROVIDERS_KILO_API_KEY=... \
MH_PROVIDERS_KILO_ENABLED=true \
MH_PROXY_DEFAULT_PROVIDER=kilo \
./bin/management-harness-proxy
```

Kilo's current base URL is `https://api.kilo.ai/api/gateway` (without `/v1`).
The gateway supports model routing, streaming, usage tracking, and organization
controls through one OpenAI-compatible endpoint.

NVIDIA NIM remains the default optimizer and direct provider when its key is
configured:

```bash
MH_PROVIDERS_NVIDIA_API_KEY=nvapi-... \
MH_PROVIDERS_NVIDIA_ENABLED=true \
MH_OPTIMIZER_ENABLED=true MH_OPTIMIZER_PROVIDER=nvidia \
./bin/management-harness-proxy
```

The default Nemotron model is `nvidia/nemotron-3.5-lightning-30b-a3b`.

## Authentication flow

1. Create a user via the Manager API (`POST /api/v1/users`).
2. Mint an API key (`POST /api/v1/users/{id}/keys`) — the raw key is returned **once**.
3. Call the proxy with `Authorization: Bearer hk_...`.

> **Note:** The default `MemoryKeyStore` / `MemoryBudgetStore` are per-process
> state. When running the proxy and manager as **separate processes** (as above),
> they each have their own in-memory stores, so a key minted by the manager is
> not visible to the proxy. For multi-process or production deployments, enable
> **Redis** (`MH_REDIS_ENABLED=true`) so the key/budget stores are shared.

## Testing

```bash
make test    # go test ./... -race
make vet     # go vet ./...
```

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/users` | List users |
| POST | `/api/v1/users` | Create user |
| GET/PUT/DELETE | `/api/v1/users/{id}` | Get/update/delete user |
| GET/POST | `/api/v1/users/{id}/keys` | List/create keys |
| POST | `/api/v1/users/{id}/keys/{key_id}/revoke` | Revoke key |
| GET/PUT | `/api/v1/users/{id}/budget` | Get/set budget |
| GET | `/api/v1/budget/usage` | Budget usage |
| GET/POST | `/api/v1/policies` | List/create policies |
| PUT/POST | `/api/v1/policies/{id}` + `/activate` | Update/activate |
| GET/POST | `/api/v1/skills` | List/create skills |
| POST | `/api/v1/skills/draft` | Draft a skill from a description (LLM) |
| GET/PUT/DELETE | `/api/v1/skills/{name}` | Get/update/delete a skill |
| GET | `/api/v1/audit/events` | Audit events |
| GET | `/api/v1/audit/verify` | Verify hash-chain integrity |

## Docker

```bash
docker build -t management-harness .
# Secrets are required for every binary (the process fails fast otherwise).
export MH_MANAGER_ADMIN_TOKEN=$(openssl rand -hex 16)
export MH_MANAGER_JWT_SECRET=$(openssl rand -hex 32)

# Proxy (gateway) on :8080
docker run -p 8080:8080 \
  -e MH_MANAGER_ADMIN_TOKEN -e MH_MANAGER_JWT_SECRET \
  management-harness

# Manager (admin API + dashboard) on :8090
docker run -p 8090:8090 \
  -e MH_MANAGER_ADMIN_TOKEN -e MH_MANAGER_JWT_SECRET \
  management-harness /app/manager
```

> The image runs the proxy by default; pass `/app/manager` or `/app/mcp` to run
> the other binaries. Secrets must be supplied via environment for every binary
> (see `.env.example`). For shared state across processes, enable Redis (see
> Persistence below).

## Persistence

By default the harness starts with **in-memory** stores — API keys, budgets,
spend counters, and the audit trail live in process memory and are **lost on
restart**. For durable, production operation configure:

| Env var | Purpose |
|---------|---------|
| `MH_AUDIT_FILE` | Append-only NDJSON audit log (tamper-evident). |
| `MH_AUDIT_CHAIN_FILE` | Persists the latest audit hash-chain head across restarts. |
| `MH_REDIS_ENABLED=true` | Shared key/budget/usage store (Redis) across processes. |

Leave these unset only for local development.

## Status

This is a production-ready foundation: a compiling, tested, runnable proxy +
manager with auth, budget, guardian, policy, router, cache, optimizer,
observability, and an embedded dashboard. Provider SDKs are implemented over
`net/http` for transparency. A Redis-backed budget store and a Prometheus
scrape configuration are shipped; `docker-compose.yml` provisions the local
infrastructure (Redis, Prometheus, Grafana).
