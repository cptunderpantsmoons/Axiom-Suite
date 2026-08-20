# Axiom — brand spec

Extracted from the provided Axiom landing-page source (the "current design"). This source outranks the default SpaceX-inspired system for work on the Axiom artifact.

**System in one sentence:** a near-black violet/cyan interface on an ink canvas — Inter display + JetBrains Mono data labels, 1px hard borders, translucent glass, restrained violet glow, violet as the single signal color.

## Tokens

| Token | Hex | OKLCh (converted) | Role |
|---|---|---|---|
| `--bg` | `#08070d` | `oklch(0.03 0.008 290)` | page ink |
| `--surface` | `#0e0d17` | `oklch(0.05 0.011 291)` | panels / term-head |
| `--fg` | `#e4e4e7` | `oklch(0.91 0.004 286)` | body text |
| `--muted` | `#8f8ba3` | `oklch(0.585 0.034 293)` | dim text / axis |
| `--border` | `#221f33` | `oklch(0.12 0.020 291)` | 1px edges |
| `--accent` | `#8b5cf6` | `oklch(0.545 0.26 284)` | violet signal (CTA, active, highlights) |

Supporting: `#a78bfa` (violet-400, secondary highlight), `#22d3ee` (cyan, execution/flow), `#f4f4f5` (bright fg for command lines), status `#34d399` emerald / `#fbbf24` amber / `#f87171` red.

## Typography

- Display / body: **Inter** — weights 400 / 600 / 700 / 800, tight tracking on large headlines (`-0.02em`–`0.03em`).
- Mono / data / labels / terminals: **JetBrains Mono** — ALL-CAPS labels with `0.1em+` tracking.
- Headline scale: `text-4xl` → `text-6xl` (36–60px) with `leading-[1.05]`; body 18px `leading-relaxed`.

## Posture rules

1. **Ink-first.** Never a light background. Panels are one step lighter than the page, borders are 1px `#221f33`.
2. **Radius.** `rounded-2xl` (16px) on major cards/terminals, `rounded-xl`/`rounded-lg` on controls and chips.
3. **Type-driven hierarchy.** ALL-CAPS mono eyebrows (`tracking-widest`) introduce sections; Inter extrabold headlines carry them; JetBrains Mono carries every data value.
4. **Violet is signal, not wash.** Reserve `#8b5cf6` for CTAs, active states, and data emphasis; cyan for process/flow; emerald/amber/red for status semantics only.
5. **Depth via layering, not shadows.** Card gradient fills, `backdrop-blur` glass nav, and soft violet glows (`box-shadow` on primary CTA) — never flat panels with heavy drop shadows.
