# 14 — Audit Scoring Formula and Versioning Policy

## Goal
Keep drift scoring transparent, reproducible, and evolvable.

## Scoring model v1
> The drift score is a transparent, configurable **weighted heuristic** (`scoring_model: "weighted_heuristic"`), not a statistical measurement. Per-finding weights are configurable via `config.audit.severity_weights`.

- Base: `0`
- High finding: `+25`
- Medium finding: `+10`
- Low finding: `+3`
- Stale prompt: `+8` each
- Expired suppression: `+15` each
- Clamp total to `100`

## Bands
- `0–20` low
- `21–50` moderate
- `51–75` high
- `76–100` severe

## Metadata requirements
Every audit artifact must include:
- `scoring_version` (e.g. `1`)
- `scoring_model` (e.g. `"weighted_heuristic"`) — identifies the scoring method. The current model is a transparent, configurable weighted sum of finding severities plus stale-prompt and expired-suppression counts. It is a **heuristic indicator, not a statistical or absolute measurement** of code quality; weights are configurable via `config.audit.severity_weights`.
- `score_breakdown` array with per-rule contributions
- `final_drift_score`

## Rule confidence labeling
Each finding includes:
- `evidence_type`: `factual` or `heuristic`
- `confidence`: `high|medium|low`

Heuristic findings must not claim certainty in markdown summaries.

## Versioning policy
- Weight or formula change => bump `scoring_version`.
- New rule added with zero default weight can stay same version.
- Historical audits are never recomputed in place.

## Validation
- Deterministic score for identical input snapshots.
- Score equals sum of contributions (before clamp).
