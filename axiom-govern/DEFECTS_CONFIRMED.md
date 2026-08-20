# Confirmed Defects — Management Harness

Prepared by the Integration Agent (TestingRealityChecker) during a
deployment-readiness assessment on 2026-08-16. Every item below was
**reproduced with direct evidence**, not inferred from documentation.

## Verification baseline (all gates run personally)

| Gate | Command | Result |
|------|---------|--------|
| Compile | `go build ./...` | clean (3 binaries) |
| Static analysis | `go vet ./...` | clean |
| Unit/integration tests | `go test ./... -race -count=1` | 17 packages `ok`, 0 data races |
| Runtime smoke | manager + proxy boot; healthz/readyz 200; auth 401/200 correct | passed |
| Container build | `docker build -t management-harness:test .` | **FAILED** |

---

## DEFECT-1 — Docker image does not build (CRITICAL)

**Severity**: Critical — blocks all containerized deployment.

**Evidence**:
```
go: go.mod requires go >= 1.25.13 (running go 1.23.12; GOTOOLCHAIN=local)
The command '/bin/sh -c go mod download' returned a non-zero code: 1
```

**Root cause**: Toolchain version mismatch.
- `Dockerfile` build stage: `FROM golang:1.23-alpine AS build`
- `go.mod` directive: `go 1.25.13`

Go 1.23 refuses to build a module requiring `go >= 1.25.13`, so the image
cannot be produced at all. The README's `docker build` → "run in production"
path is currently non-functional.

**Fix**: Bump the build-stage base image to a Go ≥ 1.25.13 image
(e.g. `golang:1.25-alpine`), then re-run `docker build` to confirm success.

---

## DEFECT-2 — README claims deliverables that do not exist (HIGH)

**Severity**: High — inaccurate client-facing documentation.

**Evidence**: `README.md` line 125 states:
> "Redis budget store, Kubernetes manifests, and Terraform are provided for
> production rollout."

A full-tree search for Kubernetes manifests and Terraform files finds
**nothing**. The only deployment artifact present is
`deployments/prometheus/prometheus.yml`:

```
$ find . \( -name "*.tf" -o -name "*.yaml" -o -name "*.yml" \) ...
./configs/policies/default.yaml
./deployments/prometheus/prometheus.yml
./docker-compose.yml
```

**Fix**: Either ship the Kubernetes manifests and Terraform modules the README
promises, or remove that sentence. Do not claim deliverables that are absent.

---

## DEFECT-3 — docker-compose provisions a dropped component (MEDIUM)

**Severity**: Medium — misleading/dead infrastructure.

**Evidence**: `docker-compose.yml` defines a `postgres:16-alpine` service with
healthcheck and a persistent volume, but the project explicitly dropped all
Postgres support (RECTIFICATION_PLAN HIGH-008: no Postgres references remain in
Go code). The container boots and idles, doing nothing.

**Fix**: Remove the `postgres` service (and its `pgdata` volume) from
`docker-compose.yml`, or document why it remains.

---

## DEFECT-4 — Default config loses audit/budget state on restart (LOW, acknowledged)

**Severity**: Low for correctness of running code, but material for a client in
production.

**Evidence** (runtime smoke-test logs):
```
"msg":"no MH_AUDIT_FILE configured: audit events are kept only in memory and are lost on restart"
"msg":"no MH_AUDIT_CHAIN_FILE configured: the audit hash chain is not persisted across restarts"
"msg":"redis disabled: budgets and usage counters use in-memory storage and will not survive restarts"
```

Out of the box (no `MH_AUDIT_FILE` / `MH_AUDIT_CHAIN_FILE` / Redis), the
tamper-evident audit chain and budget/usage counters are memory-only and vanish
on restart. This is acknowledged in the project docs, but the default path
silently discards state a client would expect to be durable.

**Fix**: Document this prominently for operators, or enable a persistent
default (audit file + Redis) for production-oriented defaults.

---

## Summary

| ID | Severity | Summary | Blocker for client use? |
|----|----------|---------|-------------------------|
| DEFECT-1 | Critical | Docker image does not build (Go 1.23 vs 1.25.13) | Yes |
| DEFECT-2 | High | README claims K8s manifests + Terraform that don't exist | Yes |
| DEFECT-3 | Medium | docker-compose runs a dropped PostgreSQL service | No |
| DEFECT-4 | Low | Default config loses audit/budget state on restart | No |

**Overall deployment readiness**: **RESOLVED** — see resolution below.

---

## Resolution (2026-08-16)

All four defects were fixed and verified with direct evidence, and a team
review surfaced three additional issues that were also fixed.

| ID | Resolution | Evidence |
|----|-----------|----------|
| DEFECT-1 | Dockerfile build stage `golang:1.23-alpine` → `golang:1.25-alpine`; entrypoint `ENTRYPOINT ["/app/proxy"]` → overridable `CMD ["/app/proxy"]` | `docker build` succeeds; proxy + manager containers both boot and serve `/healthz` 200 |
| DEFECT-2 | Removed the false K8s/Terraform claim; README now states what is actually shipped | grep for kubernetes/terraform/postgres/1.23 in README → 0 hits |
| DEFECT-3 | Removed the dropped `postgres` service + `pgdata` volume from docker-compose | `docker compose config --services` → redis, prometheus, grafana |
| DEFECT-4 | Added a "Persistence" section documenting audit/budget durability env vars; updated `.env.example` | README Persistence section + `.env.example` |

Additional issues found & fixed during team review:

| ID | Finding | Fix |
|----|---------|-----|
| RV-003 | `insecureSecrets` blocklist did not contain `.env.example` placeholders (`change-me-admin-token`, `change-me-jwt-secret`), so a copied template could boot with guessable secrets | Added the placeholders to the blocklist in `config.go` |
| RV-004 | Prometheus scraped a dead `host.docker.internal:9091` (metrics actually served on :8080/:8090 `/metrics`) | Repointed `prometheus.yml` to :8080 + :8090; added `extra_hosts` for Linux |
| RV-005 | Redis backed budget/usage but **not** API keys — keys minted by the manager were invisible to the proxy in any multi-process/container topology (broke the core auth flow) | Implemented `auth.RedisKeyStore` and wired it in `bootstrap.go` when Redis is enabled |

**Final readiness verdict: READY FOR CLIENT USE.**

Verified end-to-end: a key minted via the manager is authenticated by a
separate proxy process over shared Redis (503 "no provider" = auth passed;
bogus key → 401). `go build`, `go vet`, `go test ./... -race` (17 packages),
and `docker build` are all clean.