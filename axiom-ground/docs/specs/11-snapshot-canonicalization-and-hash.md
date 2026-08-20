# 11 — Snapshot Canonicalization and Hash Spec

## Goal
Ensure identical repo state produces identical snapshot hashes.

## Canonical hash input
Hash only `machine_facts`, `project_map`, `debt_markers`, and `content_fingerprints`.

Exclude from hash:
- `created_at`
- `volatile_state`
- any runtime timing/perf fields
- non-deterministic ordering artifacts

## Normalization rules
1. UTF-8 encoding.
2. Line endings normalized to `\n`.
3. JSON serialized with:
   - sorted object keys (lexicographic),
   - stable array order (see below),
   - no insignificant whitespace.
4. Paths normalized to POSIX-style `/`, relative to repo root.

## Array ordering rules
- Paths: lexicographic ascending.
- Dependencies: lowercased then lexicographic.
- Debt markers: `(file, line, marker, text)` tuple sort.
- Directory map: by `path`.
- Important files: by `path`.

## Hash algorithm
- `sha256` over canonical JSON bytes.
- Rendered as `ctxsnap_<first_16_hex>` for ID.
- Store full hash in artifact metadata for collision safety.

## Versioning
- Add `hash_spec_version` in snapshot metadata.
- Any normalization change must bump `hash_spec_version`.

## Validation
- Re-running `ctx snapshot` twice without repo changes must produce identical hash.
- Fixture test for CRLF/LF equivalence must pass.
