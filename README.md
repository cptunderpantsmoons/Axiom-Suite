# Axiom Suite

Monorepo for Audit Intellect Pty Ltd — the three Axiom platforms, maintained as one
repository.

| Directory         | Project                  | Stack | What it does |
|-------------------|--------------------------|-------|--------------|
| `axiom-compile/`  | Axiom Compile            | Rust (Tauri) + TypeScript | Compilation engine, context harness, agent pipeline (peproxy) |
| `axiom-govern/`   | Axiom Govern             | Go    | Management harness: proxy, policy engine, router, audit & provenance, dashboard |
| `axiom-ground/`   | Axiom Ground (ContextLock) | Node.js | Planning/grounding: plans, locks, snapshots, CI gates, human-readable site |

## Root files

- `combined-projects-landing.html` — combined marketing/landing page
- `seed-roadshow-deck.html` — seed roadshow deck
- `PRICING_MODEL.md`, `STRIPE_SUBSCRIPTIONS.md`, `stripe_server.py` — Stripe billing & pricing
- `brand-spec.md` — brand identity spec
- `.env.example` — environment template (Stripe test-mode placeholders only)
- Skill bundles: `9374459d-*.zip` (AI SaaS website skill), `edfa9e15-*.zip` (Stripe
  subscription engine skill), `stripe-agent-1.0.0.tar.gz` (Stripe agent skill)

## Getting started

Each project has its own README with build instructions:

- `axiom-compile/README.md` — Tauri app + Rust core (`app/src-tauri`), TS packages under `packages/`
- `axiom-govern/README.md` — Go module; `make` targets, docker-compose for the full stack
- `axiom-ground/README.md` — Node.js; `npm install && npm test`

## History

This repository merges three previously independent git projects (Axiom Compile,
Management Harness Axiom Govern, contextlock-planning Axiom Ground) into a single
monorepo. Original per-project commit histories are not preserved here; the projects
land as a single initial snapshot.
