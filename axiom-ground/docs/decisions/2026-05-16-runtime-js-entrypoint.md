# Runtime JavaScript CLI Entrypoint

## Context/problem

The initial scaffold included TypeScript files, but Builds 1–6 were implemented as dependency-free Node.js ESM to keep the alpha CLI runnable without installing a toolchain.

## Decision

For the current alpha, `src/cli/main.js` is the executable entrypoint and `src/cli/app.js` contains the implementation. Future refactors should extract domain modules under `src/init`, `src/snapshot`, `src/prompts`, `src/audit`, `src/site`, and `src/utils`.

## Alternatives considered

- Convert all runtime code to TypeScript immediately.
- Keep all logic in `src/cli/main.js`.

## Compatibility impact

No CLI behavior change. `package.json` already points the `ctx` binary at `src/cli/main.js`.

## Migration plan

Gradually extract app logic into domain modules while keeping `src/cli/main.js` stable.

## Rollback plan

Move the contents of `src/cli/app.js` back into `src/cli/main.js` if module extraction causes runtime issues.

## Update (2026-08-15) — `app.js` decomposed into command modules

The "gradual extraction" noted above is now done. `src/cli/app.js` is a thin router
(~190 lines) that imports the command handlers and `printHelp`, builds a `COMMANDS` registry,
and preserves flag handling, exit codes, and the `export async function main` entrypoint that
`src/cli/main.js` depends on.

The extracted command handlers live in `src/cli/commands/`:

- `init.js`, `status.js`, `snapshot.js`, `prompt.js`, `audit.js`, `site.js`, `memory.js`, `code.js`

Shared CLI helpers moved to:

- `src/cli/shared.js` — `hasFlag`, `outputFormat`, `VERSION`, `printHelp` import surface.
- `src/cli/help.js` — help text (`printHelp`).

To prevent regression, `scripts/lint.js` now reports the file-line-limit (`MAX_FILE_LINES`)
violation as an `error` rather than a `warn`, so `app.js` cannot grow past 600 lines again.
The domain modules under `src/init`, `src/snapshot`, `src/prompts`, `src/audit`, `src/site`,
`src/scanner`, `src/codeindex`, and `src/utils` are unchanged in behavior.
