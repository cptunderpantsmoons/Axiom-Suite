# Schemas

Versioned JSON schemas for ContextLock artifacts.

- `config.schema.json` — `.contextlock/config.json` (validated on write by `writeConfigJson`).
- `lock.schema.json` — `.contextlock/lock.json` (validated on write by `writeLockJson`).
- `snapshot.schema.json` — snapshot artifacts (validated in `writeSnapshotArtifacts`).
- `prompt.schema.json` — prompt metadata.
- `audit.schema.json` — audit artifacts.
- `site.schema.json` — site metadata (validated in `buildSiteArtifacts`).
- `plan.schema.json` — `ctx plan` artifacts.
- `planning-progress.schema.json` — `docs/planning/contextlock-progress.json` (validated in CI via `npm run lint`).

Schemas should align with `docs/04-data-models.md` and the spec files under `docs/specs/`.

The bundled validator in `src/utils/schema.js` supports `type` (including unions),
`const`, `enum`, `required`, `properties`, `items`, and `additionalProperties`;
schemas are validated on write so malformed artifacts are rejected before they persist.
