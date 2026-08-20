# Brand + Pricing Recommendation

Synthesized 2026-08-16 from four specialists (Brand Guardian, Pricing Analyst,
Product Manager, Visual Storyteller). Full deep-dives: `PRICING_STRATEGY.md`,
`docs/BRAINSTORM-visual-identity-and-art-direction.md`.

> Status: **Helm** brand adopted and applied to the dashboard + README
> (2026-08-16). Pricing structure remains a proposal pending validation.

---

## 1. NAME — ADOPTED: **Helm**

"Management Harness" stays as the engineering/project name; the commercial brand
is **Helm** — the control surface that steers the whole vessel, so the platform
"commands every model" and "owns the stack."

- **Positioning (one line):** *Helm is the enterprise control plane that governs
  every AI model call — who's allowed to make it, what it costs, and what it's
  allowed to say.*
- **Tagline:** *Command every model. Own the stack.*
- **Category (from Product Manager):** an "AI command plane" — the
  `Kong/Envoy + Hashicorp Vault` layer for generative AI. *Observability tells you
  what happened; we stop the bad thing from happening.*
- **Runner-ups considered:** Halter (*Rein in every model*), Sluice (*Control what
  flows to the model*), Custos (*The guardian before every model*), Regrade.
- **Practical hooks:** API key prefix `hk_` → `hx_` (dual-accept briefly); check
  `helm.ai`/`gethelm.com` + trademark classes 9/42. **CAUTION:** "Helm" is also
  the Kubernetes package manager — confirm trademark/discoverability before launch.

**Personality — "the composed operator":** calm, precise, quietly authoritative.
Govern/direct/rein/inspect/enforce/route/verify/trip/redact are the product verbs;
no hype superlatives, no consumer warmth.

## 2. BRAND STORY

> Helm is the one place where enterprise AI meets governance. Every prompt that
> crosses your boundary is authenticated, budgeted, guarded, and counted — routed
> and recorded as an immutable trail, so teams can ship with AI freely and
> security leaders stay in the control room, not on call.

## 3. VISUAL IDENTITY (from docs/BRAINSTORM-visual-identity-and-art-direction.md)

- **Logo metaphor — "Controlled Lane":** a flow line enters left, passes a
  valve/gate, splits into disciplined parallel lanes, routes out (subtle "H"
  monogram). Alternatives: The Verifier, The Router, The Rack.
- **Palette (dark-native control plane):** ink `#0B1220/#101829/#1B2438`,
  slate `#94A3B8/#E2E8F0`; brand accent Control Teal `#2DD4BF` + Signal Blue
  `#38BDF8`; semantic Pass `#34D399` / Warn `#FBBF24` / Deny `#F87171` reserved
  for true state only.
- **Type:** Space Grotesk (display, uppercase) / Inter (UI) / IBM Plex Mono
  (technical: hashes, keys, JSON).
- **Icons:** 24px operator-console line style; chevrons=Router, shield+flag=Guardian,
  gauge=Budget, doc+hash=Audit, sliders=Policy, stacked sheets=Skills; 6px status
  dot. Dense rack-like grids, WCAG AA, reduced-motion respected.
- **Note:** the visual doc proposes a dark "operators at night" skin, while the
  current dashboard is light. Adopting a dark theme is a separate, deliberate step;
  the "governed gate" metaphor applies to either.

## 4. PRICING (from PRICING_STRATEGY.md)

**Model:** hybrid — `platform base + admin seats + per-token governance fee`
(scales with the LLM spend you protect). Target value capture: **2–8% of customer
LLM spend**. Never meter end-users (reward broad rollout).

| Tier | Price | What's included |
|------|-------|-----------------|
| **Community / OSS** | $0 (self-host) | auth, budget, router, circuit breaker, basic audit, basic guardian, lossless optimizer, ≤5 skills, 3 providers |
| **Pro / Scale** | $499/mo (5 seats, $15/extra) + **$0.50/1M tokens** | full guardian + PII (18 patterns), policy engine, immutable hash-chain audit, full optimizer (pruning + LLM summariser, shadow→apply), NVIDIA NIM, ≤50 skills, routing, OIDC, Grafana, 99.5% |
| **Enterprise** | $2,500/mo (20 seats, $20/extra) + **$0.35/1M** (→$0.25 >2B) | SSO/SAML+SCIM, RBAC, on-prem/VPC/air-gap, legal-hold audit + SIEM export, skills marketplace, policy-as-code CI/CD, multi-org chargeback, CSM, 99.9% |

**Anchor:** blended LLM cost ≈ $2–8/1M tokens; a **$0.35–0.50/1M governance fee**
is 2–10% on cheap models, <1% on premium — mirroring our own cost driver.

**Illustrative Pro bill:** $499 + 15×$15 + 200M×$0.50 = ~$824/mo (~4% of a
$15–25k/mo LLM spend team) — paid for several times over by optimization savings.

**Differentiator monetization:**
- Security guardian + PII → Pro gate (compliance-driven willingness-to-pay).
- Immutable audit/SIEM/legal-hold/on-prem → Enterprise (the compliance money feature).
- Skills marketplace + cross-org → Enterprise (future revenue share).
- Prompt optimization → bundled, self-funding proof (ship the "would-have-saved"
  shadow counter first; routing + ~15% compaction pays the fee before security value).

**Market ballpark:** above self-serve gateways (Portkey $43–150/mo, Helicone,
LangSmith), below AI-security suites (Lakera, Robust, Kong $1–10k/mo) — a credible
security-grade gateway number.

**Guardrails:** never meter end-users; optimize proof-then-apply; grandfather OSS
self-hosters; transparent metered fee with Enterprise committed-volume brackets;
track contribution margin, price realization, revenue/token, tokens_saved_total,
guardian blocks.

## 5. GTM proof points (from Product Manager)
1. **Tamper-evident audit in one call** — SHA-256 hash-chained ledger + `/verify`.
2. **Live, in-line governance** — PII redaction (18 patterns), guardian,
   hot-reloadable policies without restarting the proxy.
3. **Provider-neutral + real savings** — OpenAI/Anthropic/NVIDIA NIM/Nemotron,
   cost-aware routing, lossless + LLM optimization with measurable
   `harness_optimizer_*` savings.
