## Summary

- What changed:
- Why:
- Scope:

## AI-assisted change metadata (required when AI-assisted)

- ai_assisted: <!-- true|false -->
- snapshot_hash_used:
- prompt_type_used:
- change_class: <!-- conformance_fix | intentional_spec_change | scope_expansion -->
- affected_specs:
- risk_level: <!-- low | medium | high -->
- rollback_plan: <!-- required for medium/high -->

## Spec compliance (required for behavior changes)

- Spec links:
- Is this a conformance fix or intentional spec change?
- Version field bumps (if any):
- Migration/compatibility notes (if any):

## Evidence and verification

- [ ] Fixture tests added/updated
- [ ] Determinism replay run twice with identical artifact outputs
- [ ] Secret scan passed (no high findings)
- [ ] Source-test coupling verified
- [ ] Audit delta reviewed (no unacknowledged new high-severity findings)
- [ ] Dependency rationale provided (if manifests/lockfiles changed)

## Artifact diff evidence (required for behavior changes)

- Before:
- After:
- Why this is correct:

## Checklist

- [ ] I reviewed `docs/specs/11-snapshot-canonicalization-and-hash.md`
- [ ] I reviewed `docs/specs/12-file-classification-and-exclusion.md`
- [ ] I reviewed `docs/specs/13-secret-scanning-policy.md`
- [ ] I reviewed `docs/specs/14-audit-scoring-versioning.md`
- [ ] I reviewed `docs/specs/15-incremental-snapshot-invalidation.md`
- [ ] I reviewed `docs/specs/16-alpha-ecosystem-support-boundary.md`
- [ ] I reviewed `docs/specs/17-ai-change-guardrails.md`
- [ ] Docs/specs/tests are consistent with implementation
