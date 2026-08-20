# 16 — Alpha Ecosystem Support Boundary

## Goal
Prevent scope creep by defining exact alpha ecosystem support.

## Alpha supported manifests
- Node: `package.json`
- Python: `pyproject.toml`, `requirements.txt`

## Alpha supported lockfiles (audit signals only)
- Node: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`
- Python: `poetry.lock`

## Alpha command extraction
- Node: scripts from `package.json` (`test`, `build`, `start`, `dev`)
- Python:
  - `pyproject.toml` tool script sections where straightforward
  - fallback heuristics from README/docs

## Alpha language detection
- TypeScript/JavaScript by extension + manifest presence
- Python by extension + manifest presence
- Other languages: detect presence only, no deep extraction guarantees

## Out of scope for alpha
- Full multi-language semantic parsing
- Deep Rust/Go/Java build graph support
- Universal command inference across all ecosystems
- AST-level architecture checks beyond simple import/path rules

## User-facing behavior
- Unsupported ecosystems should emit `partial_support` notices, not hard failures.
- `ctx status` should list support level: `full`, `partial`, or `unknown`.

## Validation
Fixture tests:
1. Node repo extracts scripts/deps correctly.
2. Python repo extracts deps and basic run/test hints.
3. Mixed repo reports partial support for unsupported manifest types.
