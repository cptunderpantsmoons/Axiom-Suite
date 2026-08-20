# Architecture Rules Configuration

ContextLock supports declarative architecture rules that are evaluated during audits. Rules are defined in `.contextlock/config.json` under the `architecture_rules` and `suppressions` arrays.

## Quick example

```json
{
  "architecture_rules": [
    {
      "id": "no-db-in-ui",
      "description": "UI modules must not import database clients directly",
      "severity": "high",
      "match": ["src/ui/**"],
      "forbid_imports": ["src/db/**"],
      "recommendation": "Use the service layer (src/services/) instead."
    },
    {
      "id": "require-health-check",
      "description": "Every deployable service must have a health check endpoint",
      "severity": "medium",
      "match": ["src/services/**"],
      "require_files": ["src/services/*/health.js"]
    }
  ],
  "suppressions": [
    {
      "finding_id": "rule:no-db-in-ui:src/ui/admin.js:12",
      "reason": "Admin dashboard needs direct DB access for read-only reports. Tracked in JIRA-456.",
      "expires_at": "2025-09-01T00:00:00Z"
    }
  ]
}
```

## Rule schema

Each rule in `architecture_rules` has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier for the rule |
| `description` | string | ✅ | Human-readable explanation |
| `severity` | string | ✅ | One of: `low`, `medium`, `high`, `critical` |
| `match` | string[] | ✅ | Glob patterns selecting which files to check |
| `forbid_imports` | string[] | no | Glob patterns for imports that must not appear in matched files |
| `require_files` | string[] | no | File paths that must exist for matched modules |
| `recommendation` | string | no | Guidance shown in audit findings |

A rule must define at least one of `forbid_imports` or `require_files`.

### How `match` works

The `match` array uses glob patterns to select files:

- `src/ui/**` — all files recursively under `src/ui/`
- `src/services/*/index.js` — index files one level deep in services
- `**/*.test.js` — all test files

### How `forbid_imports` works

Scans matched files for import/require statements and checks if any resolved import path matches the forbidden patterns. Supports:

- **ESM**: `import ... from '...'`, `import('...')`
- **CommonJS**: `require('...')`
- **Python**: `from ... import ...`, `import ...`

Relative imports (e.g. `../db/client`) are resolved to their full path before matching.

### How `require_files` works

Checks that specified file paths exist in the repository. Useful for enforcing conventions like "every service needs a health check" or "every module needs a README".

## Suppressions

Suppressions temporarily silence a rule finding. They have:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `finding_id` | string | ✅ | The exact finding ID to suppress |
| `reason` | string | ✅ | Why this suppression exists (auditable) |
| `expires_at` | string (ISO 8601) | ✅ | When the suppression expires |

### Finding IDs

Finding IDs follow the format: `rule:{rule_id}:{file}:{line}` for import violations, or `rule:{rule_id}:missing:{path}` for missing files.

### Expiry behaviour

When a suppression expires:

1. The finding becomes **active again**
2. Its severity is **escalated to `high`**
3. The title is prefixed with `[EXPIRED SUPPRESSION]`
4. The original suppression reason is preserved in the evidence

This ensures suppressions are temporary by design — they never become permanent silencing mechanisms.

## Validation

Run `ctx rules validate` to check your rules and suppressions for errors before running an audit.

```bash
ctx rules validate
```

This checks:

- All required fields are present
- Severity values are valid
- Match patterns are non-empty
- At least one check type is defined per rule
- Suppression dates are valid ISO 8601
- Flags any already-expired suppressions

## Workflow

```bash
# 1. Define rules in .contextlock/config.json
# 2. Validate the config
ctx rules validate

# 3. Rules are automatically evaluated during audits
ctx snapshot
ctx audit --since-last

# 4. Findings appear in audit output with the category "architecture_rule"
```
