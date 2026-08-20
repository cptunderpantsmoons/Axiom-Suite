# Design Tokens

ContextLock ships a single, dependency-free design system for its HTML site
(`.contextlock/site/`) and the standalone planning dashboard
(`docs/planning/progress-page.template.html`). It is deliberately lightweight: tokens are
plain CSS custom properties — no build step, no framework.

All tokens live in a single `:root` block (in `src/site/index.js` for the generated site, and
mirrored inline in the planning template). Two layers follow the primitive → semantic pattern:

1. **Primitive tokens** — raw values (palette, spacing scale, typography, radii, elevation).
2. **Semantic tokens** — named, intent-based variables mapped from primitives (`--bg`, `--panel`,
   `--text`, `--muted`, `--accent`, `--good`, `--warn`, `--bad`, `--border`).

## Color

| Primitive        | Value    | Semantic usage        |
|------------------|----------|-----------------------|
| `--gray-900`     | `#0f1220`| `--bg` (page surface) |
| `--gray-800`     | `#171b2e`| `--panel` (cards)     |
| `--gray-700`     | `#27304a`| `--border`            |
| `--indigo-300`   | `#7aa2ff`| `--accent` (links)    |
| `--bluegray-200` | `#98a2c7`| `--muted` (secondary) |
| `--text-100`     | `#e8ecff`| `--text` (primary)    |
| `--green-400`    | `#39d98a`| `--good`              |
| `--amber-400`    | `#ffcc66`| `--warn`              |
| `--red-400`      | `#ff6b6b`| `--bad`               |

## Spacing

`--space-1` 0.25rem · `--space-2` 0.5rem · `--space-3` 0.75rem · `--space-4` 1rem ·
`--space-5` 1.25rem · `--space-6` 1.5rem · `--space-8` 2rem

## Typography

`--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` ·
`--text-xs` 0.8rem · `--text-sm` 0.85rem · `--text-base` 1rem · `--text-lg` 1.5rem ·
`--line-base` 1.5

## Radii & elevation

Radii: `--radius-sm` 6px · `--radius-md` 8px · `--radius-lg` 12px · `--radius-pill` 999px
Elevation: `--shadow-1` · `--shadow-2`

## Usage rules

- Components reference **semantic** tokens only (never raw hex values).
- New colors extend the primitive palette, then get a semantic alias.
- Status colors (`--good/--warn/--bad`) drive `.badge-*`, `.severity-*`, and `.status-*` classes.
- The planning template mirrors the same tokens inline so both surfaces stay visually consistent.

> Out of scope (per ContextLock's dependency-free, CLI-first identity): Figma, Storybook,
> Chromatic, and a compiled token pipeline. The CSS `:root` block is the single source of truth.
