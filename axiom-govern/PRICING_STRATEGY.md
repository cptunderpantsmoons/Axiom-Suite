# Management Harness — Pricing Strategy

Product: AI-management/gateway SaaS (auth, budgets, security guardian, policy engine, model router, immutable audit, prompt optimizer, skills, dashboard).
Target buyer: platform/IT/security operators & engineering leads in mid-to-large enterprises.

## Strategy
Hybrid: **per-org platform base fee + admin-seat add-ons + per-token "governance fee"** that scales with LLM spend protected.

Rejected alternatives:
- Pure value-based (annual): strong margin, misprices the usage-linked protection lever.
- Pure usage/token: tokens are cheap at the margin; usage-only feels noncommittal for a security platform.
- Seat-per-end-user: WRONG — end users are agents/developers whose increase on-platform is a win; metering them disincentivizes broad rollout.

Value equation: `Price = PlatformFloor + ValueCapture(governed tokens)`; target capture 2–8% of customer LLM spend.

## Governance fee anchor
- Blended enterprise LLM cost ~ $2–8 / 1M tokens.
- Governance fee $0.35–0.50 / 1M tokens ≈ 2–10% of cheap-model cost, <1% of premium-model cost. Mirrors our own cost driver (scales with requests/tokens) while staying under value ceiling.

## Tiers

### Tier 1 — Community / OSS — $0
Self-hosted. Auth/budget/router/circuit-breaker, basic audit (non-persisted), basic guardian (no PII), lossless optimizer, ≤5 skills, 3 providers, 25 identities, no SSO/SLA, GitHub support.

### Tier 2 — Pro / Scale — $499/mo (5 admin seats, $15/extra) + $0.50/1M tokens
Multi-provider incl. NVIDIA NIM, full guardian (injection/jailbreak/tool-escalation + 18-pattern PII redaction), policy engine, immutable hash-chain audit, full optimizer (lossless+pruning+LLM summariser, shadow→apply), ≤50 skills, cost/health routing, Prometheus/Grafana, OIDC, email support, 99.5% SLA.

### Tier 3 — Enterprise — $2,500/mo (20 admin seats, $20/extra) + $0.35/1M (→$0.25 >2B)
SSO/SAML+SCIM, RBAC, on-prem/VPC/air-gap, long-retention+legal-hold audit + SIEM export, skills marketplace, policy-as-code CI/CD, multi-org hierarchy+chargeback, dedicated CSM, 99.9%.

## Illustrative Pro bill
$499 base + 15×$15 seats + 200M tokens × $0.50 = $824/mo (~$9.9k/yr) for a $15–25k/mo LLM spend team (~4%); paid for several times over by savings.

## Differentiator monetization
- Budget enforcement: core (base); chargeback/ROI attribution = Enterprise up-sell.
- Security guardian: premium gate (full + PII redaction in Pro+); compliance-driven WTP.
- Immutable audit: SIEM/legal-hold/on-prem in Enterprise = the compliance money feature.
- Skills marketplace: Pro bundle (≤50); curated private/public marketplace + cross-org in Enterprise; future revenue share.
- Prompt optimization: bundled but self-funding proof; "would-have-saved" shadow counter sale-enabler; routing + 15% compaction pays the governance fee first.

## Market ballpark
Portkey (~$0.30/1K req, Pro $43–150/mo), Helicone ($0.20–0.50/1K events), LangSmith (~$0.50–1/1K traces+seats), Kong AI GW ($1–10k/mo), Lakera ($200+/mo), Robust (6-fig/yr).
We land between self-serve gateway SaaS and full AI-security suites: premium over open-source (LiteLLM etc.), credible enterprise number, below bespoke security contracting.

## Guardrails
1. Never meter end-users; reward broad rollout.
2. Ship optimizer proof-then-apply (shadow "would-have-saved").
3. Grandfather OSS self-hosters; pull value, don't push fear.
4. Metered, transparent monthly governance fee with Enterprise committed-volume brackets.
5. Track: contribution margin, discount rate (<10%), price realization (>90%), revenue/token, tokens_saved_total, guardian blocks, win-rate by price.
