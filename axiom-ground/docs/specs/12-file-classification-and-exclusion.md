# 12 — File Classification and Exclusion Spec

## Goal
Define what ContextLock scans and how files affect artifacts.

## Default excludes (always)
- `.git/**`
- `.contextlock/**`
- `node_modules/**`
- `dist/**`
- `build/**`
- `coverage/**`
- `.next/**`
- `vendor/**`
- `target/**`
- binary files over size threshold (default 2 MB)

## Configurable excludes
Read from `.contextlock/config.json` `exclude[]` globs (merged with defaults).

## File classes
- `source`: `src/**`, `app/**`, language source extensions.
- `test`: `test/**`, `tests/**`, `**/*.{test,spec}.*`.
- `docs`: `README*`, `docs/**`, `**/*.md`.
- `config`: manifests, CI files, tool configs.
- `generated`: lockfiles optional class, build outputs, codegen artifacts.
- `binary`: images, archives, media, compiled objects.

## Meaningful changes
Affects snapshot hash by default:
- source, test, docs, config content changes.

Does not affect snapshot hash by default:
- excluded files,
- generated/build outputs,
- binary files (unless explicitly included).

## Lockfile policy
- Lockfiles are scanned for audit signals.
- Lockfiles do not change architecture summary by themselves.

## Determinism rules
- Glob matching behavior must be cross-platform.
- Symlinks are not followed by default.
- Hidden files included unless excluded.

## Validation
Fixture tests:
1. `node_modules` ignored.
2. docs-only change updates docs class and snapshot hash.
3. generated output changes do not alter snapshot hash.
