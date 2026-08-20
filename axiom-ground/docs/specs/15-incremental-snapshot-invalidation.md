# 15 — Incremental Snapshot Invalidation Rules

## Goal
Make `ctx snapshot --incremental` fast without sacrificing correctness.

## Inputs for incremental mode
- Git changed files (`HEAD` vs working tree and index)
- mtime/size fallback when git data unavailable
- previous snapshot index cache

## Incremental eligible when
- previous snapshot exists,
- no config schema/version change,
- no exclude/include rule change,
- no scanner version change affecting extraction behavior.

## Force full snapshot when
- first run,
- branch switch with no baseline snapshot,
- config include/exclude changed,
- scanner/hash spec version changed,
- >20% repo files changed (threshold configurable),
- cache missing/corrupt.

## Incremental behavior
- Recompute facts only for changed files and affected aggregates.
- Rebuild canonical hash from fully materialized normalized model (not partial hash patching).
- Update cache index after successful write.

## Safety fallback
On incremental failure, automatically retry once with full snapshot.

## Metadata
Snapshot should include:
- `generation_mode`: `full|incremental`
- `incremental_base_snapshot_hash` when applicable
- `fallback_to_full`: boolean

## Validation
Fixture tests:
1. small source edit uses incremental and matches full output.
2. config change triggers full snapshot.
3. corrupted cache triggers full snapshot and recovery.
