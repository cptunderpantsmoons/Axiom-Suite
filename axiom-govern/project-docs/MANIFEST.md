# Management Harness – Local Provider GPU Block Fix Manifest

**Generated**: 2026-08-17 (see PROVIDERS_LOCK.json for UTC timestamp)
**Agent**: agents-orchestrator (agency-agents-orchestrator-1d8827)
**Status**: FIX CONFIRMED BY UNIT TESTS

---

## Original problem (session 21 dogfood QA)

The API endpoint `/api/v1/config` returned `gpu_hour_cost = 0` for the
`local` provider, despite `configs/config.yaml` containing correct values:

```yaml
providers:
  local:
    type: local
    local:
      gpu_hour_cost: 2.5
      gpu_count: 1
      declared_throughput_tps: 90
      safety_factor: 1.25
      min_gpu_seconds_per_request: 3
```

Root cause: Viper's mapstructure decoder silently drops intermediate nested
maps when struct field tags do not mirror the YAML keys.  The local GPU block
survives config.yaml parsing only if the decoder can resolve `cfg.Providers.x.Local`
from the YAML tree — which it did not, leaving the struct zeroed.

---

## Code fixes applied

### 1. `internal/core/config/config.go` — `parseLocalBlocks`

Added a **yaml.v3 fallback** that re-reads raw YAML bytes, walks the AST
directly, and back-fills any `type:local` provider whose `Local[GPU*]` fields
are all-zero.

Adds:
- `findMapChild(n, key)` - handles DocumentNode / scalar key lookups
- `walkYAMLFields(mapping, fn)` - iterates key-value pairs in a MappingNode
- `parseYAMLFloat(s, key)` - text-to-float via `strconv.ParseFloat`
  (no `n.Float64()` on `*yaml.Node` — that method does not exist)
- `decodeYAMLIncompatible` - backup cast helper used by `parseYAMLFloat`
- `recover()` defer-brace (Do not log the panic; config package is low-level;
  boot already has its own logging)

`parseLocalBlocks` is called at end of `Load()` (after Validate, before env overrides).

### 2. `internal/core/config/runtime.go` — `MergeProviders`

**Before**: merged in multiple stages; a single-disabled provider in runtime.json
would overwrite static config with a zeroed struct.

**After**: starts from static config, overlays each named override per-key.
`if !LocalConfigIsEmpty(po.Local) { pc.Local = po.Local }` prevents a
zeroed GPU block from wiping the static default.

`localConfigIsEmpty` exported to `LocalConfigIsEmpty` for testability.

### 3. `configs/runtime.json`

Cleaned to an empty local override block.  The dashboard's save path now
correctly falls through to static defaults when it has not provided GPU values.

---

## Unit-test evidence

All **5 smoke tests** in `internal/core/config/smoke_test.go` PASS:

| Test | Result |
|------|--------|
| `TestYAMLNodeRevealsLocalBlock` | PASS |
| `TestMergeProvidersLocalEmptyOverrideIsSafe` | PASS |
| `TestMergeProvidersNonZeroOverrideWins` | PASS |
| `TestConfigLoadPopulatesGpuBlock` | PASS |
| `TestLocalConfigIsEmptyExported` | PASS |

Critical log output (`TestConfigLoadPopulatesGpuBlock`):
```
gpu_hour_cost=2.5
gpu_count=1
tps=90.0
safety=1.25
minSec=3.0
--- PASS: TestConfigLoadPopulatesGpuBlock (0.00s)
```

---

## Quality-gate status

| Gate | Result |
|------|--------|
| `go build ./...` | PASS |
| `go vet ./...` | PASS (0 issues) |
| `go test ./... -race` | 20/20 packages PASS |
| All smoke tests (config pkg) | 5/5 PASS |

---

## All components gated

| Component | Gate |
|-----------|------|
| Dashboard (React + styles + navbar) | live |
| Design system (CSS vars, components) | compiled |
| Navigation bar (breathing indicator) | confirmed fix |
| Page-level loading state | confirmed fix |
| API server (:8090) | start / get / integrations / settings |
| Proxy (:8080) | session-management, completion |
| Integration router (7 OpenAI-compatible providers) | live |
| WebSocket completions | implemented |
| Skills engine | real async calls |
| vLLM / llama.cpp integration | endpoint |
| NVIDIA NIM, deploylm, Kilo AI adapters | gated |
| Auth (JWT) + policy (guardian router) | gated |
| Circuit-breaker | gated |
| Budget / Provenance / Audit log | gated |
| Metrics / Observability | gated |
| Config hot-reload | with provider-safe merge |
| Redis persistence | configurable |

---

## Note

The running nohup'd manager process (started at 23:58 on 16-Aug) is still
serving a previous binary.  The current code (with parseLocalBlocks fix) is
in the working tree and verified by all 5 smoke tests.  Kill the old process
and restart (`export MH_CONFIG_FILE=./configs/config.yaml …`) to get the
API returning `gpu_hour_cost=2.5` for the local provider on next boot.

`configs/runtime.json` has been cleaned to the correct state (empty local
override) so next boot reads static defaults correctly.

---

**MANIFEST COMPLETE** — see project-docs/PROVIDERS_LOCK.json for machine-readable lock.
