# 13 — Secret Scanning Policy (Local + Pre-Sync)

## Goal
Prevent secrets from entering snapshots, prompts, audits, site output, or remote storage.

## Scan stages
1. **Snapshot stage**: redact/omit sensitive values from extracted content.
2. **Pre-sync stage**: block upload of artifacts containing likely secrets.

## Detection layers
- Pattern-based detectors:
  - API key/token prefixes (`sk-`, `ghp_`, `hf_`, `AKIA`, etc.)
  - private key headers (`BEGIN PRIVATE KEY`)
  - common credential env var names (`*_TOKEN`, `*_SECRET`, `PASSWORD`)
- Entropy heuristic for long high-entropy strings.
- File-path denylist (`.env*`, `*.pem`, `*.key`, `secrets/**`, `credentials/**`).

## Behavior
- Snapshot stage: replace matched value with `[REDACTED]` and record redaction count.
- Sync stage: fail upload with actionable error and queued retry after remediation.
- Never print raw matched secret in logs.

## Allowlist controls
- Project allowlist file: `.contextlock/allowlist-secrets.json` for known false positives.
- Allowlist entries must include reason and reviewer.

## Severity
- High: private key blocks, cloud creds, auth tokens.
- Medium: suspicious high-entropy values.
- Low: weak heuristic-only matches.

## Validation
Fixture tests:
1. `.env` values excluded from snapshot artifacts.
2. embedded fake token is redacted locally.
3. pre-sync blocks artifact with synthetic secret and reports path only.
