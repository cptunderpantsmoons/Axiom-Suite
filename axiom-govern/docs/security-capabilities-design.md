# Security Capabilities Design — Helmer (management-harness)

Date: 2026 | Author: Security Architect | Scope: (1) cryptographic audit anchoring,
(2) per-skill Ed25519 signing/provenance, (3) air-gap confirmation.

---

## 1. Cryptographic audit anchoring

### Current state (what `hashchain.go` / `logger.go` do)
- `ComputeHash` (hashchain.go) hashes an ordered, canonical `|`-joined slice of
  event fields with SHA-256; `Hash`/`PreviousHash` are excluded from input.
- `HashChain.Next` stamps `PreviousHash` + `Hash` and advances. This is a linear
  chain; `verifyChainIntegrity` re-checks it against a fixed `seed`.
- `AuditLogger.drain()` flushes each batch to sinks, then `persistChain()` writes
  the current chain root to `MH_AUDIT_CHAIN_FILE` (logger.go:200-205, 262-272).
- `/verify` (`handlers_audit.go`) recomputes against the in-memory `MemorySink`.

### The gap
An attacker with DB + file access who also controls `MH_AUDIT_CHAIN_FILE` can
rewrite events, recompute all hashes, run recompute the chain to a new root, and
write that new root to the chain file. `VerifyChain` then passes — the log is
internally consistent but the anchor itself was forgeable. "Tamper-evident"
currently only means *self-consistent*, not *independently witnessable*.

### Options
- **(a) Append-only external anchor** — publish `(root_hash, timestamp, counter)`
  into a write-only, content-addressed store / public transparency ledger / plain
  append-only endpoint that the DB attacker has no write path to.
- **(b) Threshold signatures** — n-of-m independent operators sign each anchor.
  Cryptographically strongest but operationally heavy: n signers must stay online,
  quorum orchestration, key lifecycle + recovery. Overkill here.
- **(c) Time-based anchoring** — RFC 3161 TSA or blockchain timestamp proves
  existence-at-a-time but NOT that a DB attacker couldn't have produced events
  earlier; best used to *complement* (a). A TSA call is itself an external
  network call, which conflicts with the air-gap requirement.

### Recommendation
**Option (a): append-only external anchor of the aggregate chain root — the
cheapest credible primary.** It defeats the "attacker has DB access" threat
exactly as asked: rewrite the log all you like, the recomputed root won't match
the root the outside world witnessed. Implement it as a *pluggable* destination
so the air-gapped deployment swaps in a local append-only target with identical
semantics:

- **Online (not air-gapped):** POST `{root_hash,ts,counter,prev_anchor_hash}`
  to a write-only append-only transparency endpoint (or a content-addressed
  store keyed by the root so writes are idempotent/immutable).
- **Air-gapped (fits requirement #3):** the same record appended to a physically
  separate append-only log — a WORM NAS share mounted read-mostly, an append-only
  file owned by a different `uid` with `chattr +i`/SELinux enforce-append, or a
  TPM/HSM-maintained monotonic counter. The property we rely on is identical:
  the destination is outside the attacker's write path.

Threshold (b) and time (c) are optional; recommend adding (b) only if the audit
is a regulatory obligation needing multi-party notarization, and (c) only if
an existence-at-time proof is a hard requirement.

### What to anchor
Anchor the **chain root** (not every event) plus:
- `root_hash` — hex SHA-256 of the latest event = `HashChain.Current()`.
- `timestamp` — RFC 3339 UTC at anchor time.
- `counter` — cumulative event count anchored so far (N).
- `prev_anchor_hash` — hash of the previous anchor record (optional but cheap;
  makes truncation of the log detectable: any deleted tail shifts counter/root).
- `alg: "sha256"`, `version: 1`.

Anchoring every flush batch is fine (a few records/second max); a hardened
variant anchors every N events or on a cadence to amortize cost.

### Flush-path integration
The hook point is already clean: `drain()` calls `flush()` then `persistChain()`.
Add an `Anchor(ctx, root, counter, ts)` call immediately after `persistChain()`
(or as a second "sink" invoked in the same place). Changes needed in `logger.go`:
- New optional `AnchorSink` interface + `Anchor` field on `AuditLogger`.
- In `drain()`: read `HashChain.Current()` + a running `anchoredCounter`; build +
  write the anchor record; on failure log an "anchoring backlog" warning and
  retry on the next drain (never block the write path).
- Extend verification so `/verify` also re-fetches anchored roots from the anchor
  store and compares the recomputed root at `counter` against the anchored root.

**Effort: M** (medium). The chain logic already exposes `Current()`; the work is
a new interface + one state counter + the verification cross-check, all internal.

---

## 2. Per-skill Ed25519 signing / provenance

### Current state (skill.go, store.go, expand.go, engine.go, proxy main.go)
- `models.Skill` (skill.go) has `Name`, `Version`, `Description`, `SystemPrompt`,
  `Template`, `Parameters`, ownership/permission fields — **no Author, no
  ContentHash, no Signature**.
- `Store.Load` (store.go) reads `configs/skills.json` and hot-reloads it; nothing
  is verified.
- The single execution choke point is `skills.Expand(...)` called from
  `cmd/proxy/main.go:286` inside `resolveRequest`. `Engine.Resolve` authorizes
  but does not cryptographically authenticate content.
- Skills can enter via admin `handleCreateSkill`/`handleUpdateSkill` or be
  drafted by an LLM; no signing exists.

Threat: a skill's `SystemPrompt`/`Template` is a prompt template — tampering it
can inject instructions into the model. An attacker who can modify the file or
swap a marketplace artifact changes behavior with no detection.

### Design
**Content hash over the immutable payload.** Define a canonical, ordered encoding
of the fixed fields (`Name`, `Version`, `Description`, `SystemPrompt`,
`Template`, `Parameters`) — same technique `ComputeHash` already uses — and
`contentHash = SHA-256(canonical)`. HashMaping the *content* (not just metadata)
is what makes tamper-evident verification meaningful.

**Sign over the provenance tuple.** `signature = Ed25519.Sign(signer_key,
 "name|version|author|contentHash|alg=ed25519")`. Including `author` inside the
signed tuple prevents a tamperer from merely restating an authorship claim.
Stored on the Skill: `Author`, `ContentHash`, `Signature`, `SignatureAlgo`.

**Verification:** recompute `contentHash` from the current in-memory fields,
confirm `name/version/author` equal the signed values, then `Ed25519.Verify`
with the trusted public key from the keyring. Double check: model fields cannot
be touched without changing `contentHash`; changing the signed tuple breaks the
signature; a forged signature fails the key check.

**Keyring / trust model.**
- `skills.Keyring` maps `platformID -> ed25519.PublicKey` (a marketplace/platform
  key may legitimately sign many skills; per-author keys optional later).
- Trust roots are **operator-established out-of-band** — keys live in a
  root-owned `configs/keyring.json` / config block (`chmod 600`), NOT auto-trusted
  via TOFU/TOFU-on-first-use (TOFU is MITM-able). Adding/revoking a key is itself
  an audited admin action.
- Marketplace namespaces: require signed skills to carry a platform prefix
  (e.g. `vendorx/...`) so a marketplace key only vouches for its own namespace.
- Policy knob: `skills.require_signed` (fail-closed — reject unverifiable) vs
  `prefer_signed` (block tampered, log unsigned). Marketplace-sourced skills
  should be `require_signed`; locally-authored admin skills can be unsigned.

### Hooks into store.go / expand path
- **Authoritative gate (execution):** inside `skills.Expand`, after the existing
  `skill == nil` guard, call `verifySkill(skill)` when `Signature != ""`. Because
  `Expand` is the single choke point for turning a skill into messages, any
  tampering between load and use is caught at the last safe point before the
  prompt is assembled and forwarded (mirrors the existing guardian re-scan).
  Optionally also verify in `Engine.Resolve` for fail-fast at authorization time.
- **Fail-fast at ingestion:** in `Store.Load` (store.go), after `json.Unmarshal`,
  run a verification pass and honor the `require_signed`/`prefer_signed` policy —
  reject the reload on a hard violation so a poisoned file is never hot-reloaded
  into the registry. Cache `Verified` on the model to avoid re-hashing the map.
- **Compute + sign at ingestion:** `handleCreateSkill`/`handleUpdateSkill` compute
  `ContentHash` and, when the keyring has the author's key, sign; an LLM-drafted
  skill stays unsigned until a marketplace signer signs it.

**Effort: M** (medium). Ed25519 is one stdlib/`crypto/ed25519` sign+verify; the
change touches the model (4 fields), a ~100-line `signing.go`/`keyring.go`, the
`Expand` gate, and a `Store.Load` validation pass.

---

## 3. Air-gap confirmation

**Verdict: the gateway is genuinely air-gappable today.** The only runtime
outbound network calls are to **configured LLM providers**, and all are disabled
by default. There is no telemetry, no phone-home, no licensing/activation, no
auto-update/version check, and no metrics push.

### The complete outbound surface (all of it)
| Call | File | Nature |
|------|------|--------|
| OpenAI-compatible provider HTTP calls | `internal/adapters/openai/provider.go` (`http.Client`, POST `/chat/completions`, GET `/models`) | configured provider |
| Anthropic provider HTTP calls | `internal/adapters/anthropic/provider.go` (POST `/messages`, GET `/models`) | configured provider |
| NVIDIA NIM (same openai adapter) | config `providers.nvidia.base_url: https://integrate.api.nvidia.com/v1` | configured provider |
| Redis client | `internal/bootstrap/bootstrap.go:75`, `go-redis/v9` | internal / optional `redis.enabled:false` |
| HTTP listeners (inbound) | `cmd/proxy/main.go`, `internal/api/server.go` (`ListenAndServe*`) | inbound only |
| Prometheus metrics | `internal/observability/metrics/metrics.go` (`promhttp.HandlerFor`) | **pull/scrape** on `/metrics`, no pushgateway |

### What would violate "no external call, no telemetry, offline-capable"
1. **Provider adapters hardcode default public endpoints** when `base_url` is
   empty — `api.openai.com` and `api.anthropic.com`
   (`internal/adapters/openai/provider.go:29`, `anthropic/provider.go:28`).
   Currently inert because every provider ships `enabled:false`
   (`configs/config.yaml`), but enabling any provider without an explicit
   `base_url` pointing at an in-network LLM would dial out. Air-gapped
   deployments must keep all providers disabled or point them at internal NIM/vLLM.
2. **Proxy readiness does a live provider health check** (GET `/models`)
   — `cmd/proxy/main.go` `handleReady`. This is outbound *only to configured
   providers* and is skipped when none are enabled; it is safe in air-gap but
   worth noting as the one place a health path performs an egress.
3. **Guardian/skill-draft/optimizer use configured providers** — `handleDraftSkill`
   (`handlers_skills.go`) and `optimizer/llm.go` call `provider.ChatCompletion`;
   same carve-out (configured + disabled by default).
4. **Build-time image pull** — `Dockerfile` uses `gcr.io/distroless/...` base
   image; that is a build-time registry pull, not a runtime call, but a fully
   offline build needs the base image pre-cached in the local registry.

No package in `go.mod` pulls an outbound SDK (only chi, jwt, uuid, prometheus,
**go-redis/v9**, rs/cors, viper, zap, testify — all local/in-process; viper's
legacy `hashicorp/hcl` and `spf13/afero` do no networking). The word "telemetry"
appears only in docs describing the optimizer feature, not as an SDK call.

### Reconciliation with the two capabilities
- Anchoring option (a) **online** would add an outbound call, so it must be
  implemented as a pluggable destination whose **air-gapped default is a local
  append-only/WORM target** (Section 1), keeping egress zero.
- Skill signing has **no network dependency** — keys are operator-local and
  verification is a pure in-process Ed25519 check. Fully offline-compatible.

### Bottom line
Offline-capable today with providers disabled and Redis off. The two caveats to
enforce at deployment are (1) no provider enabled without an internal `base_url`,
and (2) using the air-gapped anchor destination rather than a public ledger.