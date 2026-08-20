# Helm — Differentiation Roadmap (sovereign / local-inference / agent-swarm)

Source: market-gap analysis (thesis: sovereignty, local-inference cost-awareness,
agent-swarm governance) + a grounded feasibility/effort assessment by the Software
Architect, Autonomous-Optimization Architect, and Security Architect (2026-08-16).

## Strategic stance
Do not compete feature-for-feature with Portkey/TrueFoundry on SaaS breadth. Win on
**sovereign/air-gapped deployment, local-model cost-awareness (GPU-hours), and
agent-swarm governance** — the gaps competitors ignore.

## Key ground truth (from the code)
- **The gateway is already air-gappable today.** No telemetry SDK, phone-home,
  licensing, or auto-update in the tree; Prometheus is pull-scrape; Redis/MCP are
  local/stdin; the only runtime egress is configured LLM providers (all ship
  `enabled:false`). Caveats: the openai/anthropic adapters default `base_url` to the
  public endpoints when empty (inert while disabled); `/readyz` can probe providers;
  skill-draft/optimizer route through configured providers; the Dockerfile pulls base
  images at build time.
- **Local-inference routing is effectively already supported.** vLLM/llama.cpp/NIM
  are OpenAI-compatible; register them as `type: openai` + local `base_url`
  (identical to the existing `nvidia` provider). The real deltas are cost metering,
  identity, and trust.
- **Latent defect:** `openai.Provider.EstimateCost` uses a hardcoded gpt-4o
  placeholder and bypasses `interfaces.Pricing`, so budget pre-check and post-usage
  can disagree. Fixing this wiring is a prerequisite for correct local budgets.

## The six features (feasibility → effort)

| # | Feature | Exists today | Delta | Effort | Risk |
|---|---------|--------------|-------|--------|------|
| A | Local-model-native routing + **GPU-hour cost** | Routing works (openai-compat); cost is per-token only | `type: local` provider; `ComputePricing` (declared- or live-throughput); per-request GPU-second floor; fix `Name()` identity + `EstimateCost` wiring | A1=S, A2=M | Med |
| B | Multi-agent / swarm governance | Budgets are per-identity; MCP proxy goes through governance but hardcodes identity "mcp" | `agent_id` budget keying; real MCP identity; max-hop on spawn chain; anomaly breaker keyed on agent→agent | L | High |
| C | Cryptographic audit anchoring | SHA-256 chain + file-persisted root, but `/verify` is self-referential (trusts the same chain file an attacker could rewrite) | Pluggable `Anchorer` (append-only external, or air-gapped WORM/HSM); verify against anchored root + counter | M | Low |
| D | Policy-as-code: versioned diffs + dry-run | Hot-reload + version numbers exist; no diffs/simulation; past payloads not persisted | `PolicyDiffer` by Rule ID; read-only **shadow evaluate** on live traffic; (later) request-payload capture for replay | S–M | Med |
| E | Per-skill signing / provenance | Skills versioned + hot-reloaded; no content hash/signature verified | `ContentHash` + Ed25519 signature + keyring; verify in `Store.Load`/`Expand`; `/skills/:name/provenance` | M (digest-first = S) | Low–Med |
| — | (low pri) cost forecasting, SIEM export formats, `helmctl` CLI | — | — | — | — |

## Progress
- **2026-08-16 — A (Mode 1) implemented + verified.** `type: local` provider,
  GPU-hour `localPricing` (declared throughput, safety, per-request floor),
  `pricing.Build` strategy map, `NewProvider(name,...)` identity fix, and budget
  pre-check routed through `interfaces.Pricing` (EstimateCost defect fixed).
- **2026-08-16 — Proof of Source / Proof of Human (provenance) built.** Lightweight
  Ed25519 provenance API + ingestion middleware (`X-Helm-Provenance` header,
  `Verdict.HumanProof()`), `/api/v1/provenance/{sign,verify}`. Extends the
  trust/anchoring theme (C/E).
  Next: live-utilization (Mode 2) → C (audit anchoring) → D (policy diff+shadow).

## Recommended build order

1. **A — Local-inference cost-awareness (Mode 1: declared throughput).** Day-one:
   register local vLLM/llama.cpp as an openai-compat provider + fix `Name()`/`EstimateCost`
   wiring (already ~free). Next: `localPricing` (gpu_hour_cost, gpu_count, declared
   throughput, safety factor, per-request GPU-floor) behind the existing `Pricing`
   seam — no budget/store engine changes. (~3–4 staff-days.) A shared H100 70B lands
   ~$1–3/1M; the declared-throughput knob doubles as the anti-fraud dial.
2. **C — Audit anchoring.** Move the `/verify` trust root away from the locally-writable
   chain file to an append-only external/anchor destination (air-gapped WORM default,
   public ledger optional). Converts audit from self-authenticating to genuinely
   adversarial; S–M effort, low risk.
3. **D — Policy version diff + shadow dry-run.** Cheapest credible governance win
   around existing hot-reload.
4. **E — Skill digest + signing.** Cheap, opportunistic next to A's identity work.
5. **B — Agent/swarm governance LAST** (highest effort/risk; agent spawn-graph is
   greenfield). Start with the one cheap lever: make the MCP proxy carry real identity
   so per-identity governance already applies to agents; then agent_id budget keying,
   and an alarm-first anomaly breaker.

## The one thing to do first (strongest effort→differentiation)
Ship **A Mode 1** — it directly serves both "sovereign/local" and "local cost-
awareness", plugs into existing seams (`interfaces.Pricing`, budget, metrics), and is
the lowest-risk capture of the exact niche competitors ignore. Fix the `EstimateCost`
wiring as part of it.

## Air-gap note
Because the gateway is already offline-capable, we can market sovereign/air-gapped
today; the audit-anchoring (C) and per-skill signing (E) are the two credibility
deliverables that make that claim world-class (offline verification + provenance
that holds even against DB access).

Full security drill-down: `docs/security-capabilities-design.md` (from the Security
Architect). Cost model worked example: see the Autonomous-Optimization Architect's
response (H100 $2.50/hr; ~$78/1M single-stream → ~$1–3/1M well-shared).