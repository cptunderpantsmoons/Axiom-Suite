# 17 — AI Change Guardrails (Anti-Pattern Prevention Spec)

## Goal
Prevent common AI-assisted coding failure modes from entering the codebase by enforcing explicit PR/CI guardrails.

## Scope
Applies to all AI-assisted or AI-generated changes in ContextLock implementation and related automation/templates.

---

## A. High-risk bad patterns and required controls

### 1) Spec drift coding
**Failure mode**: behavior changes without spec updates/tests.

**Required controls**:
- PR must declare change type: `conformance_fix` or `intentional_spec_change`.
- Behavior-changing PRs must link affected spec files.
- If intentional spec change, update spec in same PR and bump relevant version fields.
- Add/adjust fixture tests proving new behavior.

**CI checks**:
- Fail if behavior changed but no spec/test files changed.

---

### 2) Hallucinated architecture
**Failure mode**: introduces abstractions/modules not aligned with repo structure or roadmap.

**Required controls**:
- New top-level module/directory requires rationale section in PR.
- PR must reference architecture doc and where new component fits.

**CI checks**:
- Warn/fail on unauthorized new top-level directories (policy-configurable).

---

### 3) Local fix / global break
**Failure mode**: local patch violates boundaries/invariants elsewhere.

**Required controls**:
- PR includes impacted domains/modules list.
- Boundary-sensitive changes require at least one integration/fixture test.

**CI checks**:
- Run drift audit against base and require no new high-severity boundary findings.

---

### 4) Silent dependency creep
**Failure mode**: unnecessary new dependencies or tooling added without justification.

**Required controls**:
- Any manifest/lockfile change must include dependency rationale.
- Must classify dependency: runtime/dev/build/test.
- Must include basic risk note (maintenance/security footprint).

**CI checks**:
- If dependency files changed and rationale missing -> fail.

---

### 5) Test theater
**Failure mode**: tests that only assert trivial behavior, not risk-bearing paths.

**Required controls**:
- Behavior change must include meaningful assertions tied to acceptance criteria.
- At least one negative-path or edge-case assertion for non-trivial logic.

**CI checks**:
- Fail when source changes in guarded areas but no corresponding test changes.

---

### 6) Prompt-stale implementation
**Failure mode**: code generated from stale snapshot/prompt context.

**Required controls**:
- PR must include snapshot hash used for AI generation (when applicable).
- If current snapshot differs, regenerate prompts/snapshot before merge.

**CI checks**:
- Fail/warn when prompt metadata hash != latest snapshot hash for AI-assisted changes.

---

### 7) Security regression by snippet reuse
**Failure mode**: copied insecure patterns, secret leakage, unsafe defaults.

**Required controls**:
- Run secret scan and security lint checks on changed files.
- No hardcoded credentials/tokens/secrets.
- Validate inputs for new external interfaces.

**CI checks**:
- Block on secret scan high findings.

---

### 8) Overbroad refactors
**Failure mode**: unrelated file churn increases risk and obscures intent.

**Required controls**:
- PR must explain unrelated-touch exceptions.
- Prefer split PRs: behavior change vs cleanup.

**CI checks**:
- Warn/fail when changed-file count exceeds threshold without label `broad-refactor-approved`.

---

### 9) Fake certainty in docs/comments
**Failure mode**: assertions presented as facts without evidence.

**Required controls**:
- Claims in docs must map to evidence source (file/rule/test).
- Unverified claims must be labeled as assumptions.

**CI checks**:
- Lint for required claim metadata in designated docs sections (when enabled).

---

### 10) No rollback-safe changes
**Failure mode**: risky changes lack migration/rollback path.

**Required controls**:
- For medium+ risk changes: include rollback/abort criteria in PR.
- For schema/version changes: include migration and compatibility note.

**CI checks**:
- Fail if versioned artifact behavior changes and migration section absent.

---

### 11) Naming/domain inconsistency drift
**Failure mode**: duplicate concept vocabulary and inconsistent naming patterns.

**Required controls**:
- Conform to established naming conventions.
- Introduce new canonical term only with rationale.

**CI checks**:
- Convention drift checks in audit; medium+ findings require acknowledgement.

---

### 12) Workflow bypass
**Failure mode**: skipping required spec/audit/fixture/determinism gates.

**Required controls**:
- Required PR template sections cannot be removed.
- Protected branch requires passing quality gates.

**CI checks**:
- Hard fail when mandatory checks are missing.

---

## B. Required PR metadata for AI-assisted changes

PRs marked AI-assisted must include:
- `ai_assisted: true`
- `snapshot_hash_used`
- `prompt_type_used` (if any)
- `change_class` (`conformance_fix` | `intentional_spec_change` | `scope_expansion`)
- `affected_specs`
- `risk_level` (`low` | `medium` | `high`)
- `rollback_plan` (required for medium/high)

---

## C. Guardrail check matrix (minimum)

1. **Spec-link check**: behavior changes linked to spec.
2. **Spec-update check**: intentional changes include spec edit + version bump.
3. **Fixture-coupling check**: behavior changes include fixture test deltas.
4. **Determinism replay**: repeated runs produce identical artifacts.
5. **Secret scan**: no high-severity secret findings.
6. **Dependency rationale check**: manifest/lockfile diffs require rationale.
7. **Source-test coupling**: guarded source change requires tests.
8. **Audit delta check**: no unacknowledged new high-severity drift.
9. **Scope-boundary check**: unsupported ecosystems yield partial-support notices, not assumptions.

---

## D. Enforcement levels

Each guardrail can be configured as:
- `off`
- `warn`
- `fail`

Recommended default for protected branches:
- spec-link: fail
- spec-update/version-bump: fail
- fixture-coupling: fail
- determinism replay: fail
- secret scan high: fail
- dependency rationale: fail
- source-test coupling: fail
- audit delta high severity: fail
- scope-boundary: fail

---

## E. Drift incident protocol

When a bad pattern is detected post-merge:
1. Open `spec-drift` incident.
2. Classify root cause by pattern ID (1–12 above).
3. Add regression fixture test.
4. Patch code or spec intentionally (with versioning/migration as needed).
5. Record decision in `docs/decisions/`.

---

## F. Quality gates for this guardrail spec itself

This spec is only considered active when:
- PR template includes required AI metadata fields.
- CI implements at least checks 1, 4, 5, 7, and 9 from section C.
- Branch protection requires these checks for merge.
