# 18 — Guardrail CI Checklist (Implementation Map)

## Purpose
Concrete CI checklist mapping guardrail requirements to enforceable checks.

## Minimum required checks (phase 1)

1. **spec-link-check**
   - Fails if behavior-changing PR lacks spec references.
2. **determinism-replay-check**
   - Runs snapshot/audit generation twice on same fixture; compares outputs.
3. **secret-scan-check**
   - Fails on high-severity secret findings.
4. **source-test-coupling-check**
   - Fails when guarded source changes occur without relevant tests.
5. **scope-boundary-check**
   - Fails if unsupported ecosystems are treated as fully supported silently.

## Extended checks (phase 2)

6. **spec-update-version-bump-check**
   - For intentional spec changes, requires matching version-field bump.
7. **fixture-coupling-check**
   - Behavior changes require fixture test changes.
8. **dependency-rationale-check**
   - Manifest/lockfile changes require rationale block in PR template.
9. **audit-delta-high-severity-check**
   - Fails on new unacknowledged high-severity drift findings.
10. **broad-refactor-threshold-check**
    - Warn/fail on excessive file churn without approval label.

## Suggested CI job split

- `guardrails-core`:
  - checks 1,2,3,4,5 (required to merge)
- `guardrails-extended`:
  - checks 6,7,8,9,10 (progressive hardening)

## Required artifacts to store in CI

- determinism replay output diffs,
- secret scan report,
- audit report,
- check summary markdown.

## Merge policy

Protected branches require `guardrails-core` pass.
`guardrails-extended` starts as warn-only, then promoted to fail-by-default once stable.
