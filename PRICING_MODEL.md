# Axiom pricing model

**Recommendation date:** 20 August 2026
**Positioning:** Axiom is the reliability and governance layer around AI-assisted
software development—not another model or editor subscription. Price the
self-serve plans per active developer, then reserve policy, deployment, and
compliance controls for an annual enterprise contract.

## Recommended plans

| Plan | Monthly | Annual | Best for | Included boundary |
|---|---:|---:|---|---|
| **Ground** | Free | Free | Individual developers evaluating Axiom | 1 repository, local ContextLock snapshots, drift audits, and community support |
| **Builder** | **$19 / active developer** | **$190 / developer / year** | Small teams that need repeatable AI task context | Everything in Ground, up to 5 repositories, Axiom Compile task packets, risk gates, 30-day history, and 2,000 compiled tasks/month |
| **Team** | **$49 / active developer** | **$490 / developer / year** | Engineering teams operating agents in shared environments | Everything in Builder, Govern gateway policies, pooled team budgets, 20 repositories, 90-day audit history, usage analytics, and priority support |
| **Enterprise** | Custom | **From $18k / year** | Regulated or high-scale organizations | Private deployment, SSO/SCIM, custom retention, policy packs, audit exports, procurement support, SLA, and dedicated onboarding |

Annual pricing is intentionally set at ten months of monthly billing, giving a
clear two-month-free incentive without introducing a complicated discount
matrix. Usage caps protect gross margin and create a natural upgrade path; model
provider charges should remain included only within defined plan allowances or
be passed through as a separately visible usage line item.

## Why these prices

- **Lower anchor:** GitHub Copilot Pro is $10/user/month, while Claude Pro is
  $20/month when billed monthly. Axiom Builder at $19 is affordable beside the
  tools developers already buy, but it is not positioned as a commodity
  autocomplete tool.
- **Team anchor:** Cursor Teams is $40/user/month, Claude Team is $25/seat/month
  when billed monthly, and CodeRabbit Pro is $24/user/month when billed
  annually. Axiom Team at $49 is a credible premium for shared budgets,
  governed routing, and tamper-evident auditability.
- **Platform anchor:** Portkey's production plan is $49/month with 100k
  recorded logs, Langfuse Core is $29/month with 100k units, and Helicone Pro is
  $79/month. Axiom Team should therefore combine a seat floor with pooled
  platform usage rather than charge only per request.
- **Enterprise anchor:** Sourcegraph Enterprise starts at $16k and includes
  credits for AI features. Axiom's $18k annual starting point is competitive
  for a governance layer with private deployment and compliance controls, while
  keeping larger accounts sales-assisted.

## Packaging rules

1. **Do not sell model tokens as the core product.** Axiom's value is context,
   intent compilation, policy enforcement, and auditability. Include a fair
   allowance, expose usage, and charge overages only when the cost is material.
2. **Bill active developers, not every viewer.** A developer is active when they
   compile or govern at least one task in a billing month. Admins, auditors, and
   read-only stakeholders should not consume paid seats.
3. **Keep Ground genuinely useful.** The local-first ContextLock workflow is the
   acquisition channel and makes Axiom easier to evaluate without a credit card.
4. **Make Team the default CTA.** Builder is the conversion plan; Team is the
   plan that monetizes the differentiated governance layer.
5. **Use Enterprise for deployment and control requirements, not arbitrary
   feature gating.** SSO/SCIM, private networking, custom retention, audit
   export, SLA, and procurement are legitimate enterprise boundaries.
6. **Review after 90 days of usage data.** Revisit task and request allowances,
   active-seat definitions, and overage pricing only after observing actual
   support and provider costs.

## Competitive source index

All sources are official pricing pages accessed for this recommendation:

- [Cursor pricing](https://cursor.com/pricing) — Hobby free, Individual Pro
  $20/month, Teams $40/user/month, Enterprise custom; teams include admin,
  SSO/OIDC, analytics, shared context, and audit/security controls.
- [GitHub Copilot plans](https://github.com/features/copilot/plans) — Pro
  $10/user/month, Pro+ $39/user/month, Max $100/user/month; paid tiers include
  agent mode, code review, cloud agent, CLI, and usage credits.
- [Claude pricing](https://claude.com/pricing) — Pro $20/month monthly, Team
  $25/seat/month monthly, Enterprise $20/seat plus usage at API rates; Team and
  Enterprise include admin, SSO, audit, and organizational controls.
- [CodeRabbit pricing](https://www.coderabbit.ai/pricing) — Pro $24/user/month
  billed annually, Pro Plus $48/user/month, Enterprise custom; AI code review,
  CLI, pre-merge checks, integrations, and enterprise governance.
- [Portkey pricing](https://portkey.ai/pricing) — Developer free, Production
  $49/month with 100k recorded logs, Enterprise custom; gateway, observability,
  guardrails, RBAC, budget/rate limits, and private deployment.
- [Langfuse pricing](https://langfuse.com/pricing) — Hobby free, Core $29/month,
  Pro $199/month, Enterprise $2,499/month; usage units, tracing, prompt
  management, evaluations, retention, RBAC, and audit controls.
- [Helicone pricing](https://www.helicone.ai/pricing) — Hobby free, Pro $79/month,
  Team $799/month, Enterprise custom; usage-based observability, alerts,
  reports, retention, SSO, and compliance.
- [Sourcegraph pricing](https://sourcegraph.com/pricing) — Enterprise starts at
  $16k and includes AI-feature credits; code context, search, MCP/API/CLI,
  single-tenant cloud, and enterprise security.

Prices and features change frequently. Recheck source pages before publishing
final commercial terms or creating live Stripe Prices.
