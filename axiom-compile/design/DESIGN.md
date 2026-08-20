---
version: alpha
name: Axiom-design-system
description: >-
  Axiom's design system, adapted from Vercel's DESIGN.md (awesome-design-md /
  VoltAgent). A developer-platform surface: stark black-ink on near-white canvas,
  broken by a multi-color mesh gradient (cyan / blue / magenta / amber) used only
  at hero scale. Geometric sans for narrative, monospaced face for technical labels.
  Source: https://github.com/VoltAgent/awesome-design-md (vercel)
adapted_for: Axiom — desktop intent compiler. Core principle: the task rules are absolute; the AI executes against established truth, never drifts.

colors:
  primary: "#171717"
  on-primary: "#ffffff"
  ink: "#171717"
  body: "#4d4d4d"
  mute: "#888888"
  hairline: "#ebebeb"
  hairline-strong: "#a1a1a1"
  canvas: "#ffffff"
  canvas-soft: "#fafafa"
  canvas-soft-2: "#f5f5f5"
  link: "#0070f3"
  link-deep: "#0761d1"
  link-bg-soft: "#d3e5ff"
  error: "#ee0000"
  success: "#0070f3"
  warning: "#f5a623"
  cyan: "#50e3c2"
  violet: "#7928ca"
  highlight-pink: "#ff0080"
  gradient-develop-start: "#007cf0"
  gradient-develop-end: "#00dfd8"
  gradient-preview-start: "#7928ca"
  gradient-preview-end: "#ff0080"
  gradient-ship-start: "#ff4d4d"
  gradient-ship-end: "#f9cb28"
  selection-bg: "#171717"
  selection-fg: "#f2f2f2"

typography:
  display-xl: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 40px, fontWeight: 600, lineHeight: 44px, letterSpacing: -2px }
  display-lg: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 28px, fontWeight: 600, lineHeight: 36px, letterSpacing: -1.2px }
  display-md: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 22px, fontWeight: 600, lineHeight: 30px, letterSpacing: -0.9px }
  body-lg: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 17px, fontWeight: 400, lineHeight: 26px }
  body-md: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 15px, fontWeight: 400, lineHeight: 23px }
  body-sm: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 14px, fontWeight: 400, lineHeight: 20px, letterSpacing: -0.2px }
  body-sm-strong: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 14px, fontWeight: 500, lineHeight: 20px }
  caption: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 12px, fontWeight: 400, lineHeight: 16px }
  caption-mono: { fontFamily: "JetBrains Mono, Geist Mono, ui-monospace, monospace", fontSize: 12px, fontWeight: 400, lineHeight: 16px }
  code: { fontFamily: "JetBrains Mono, Geist Mono, ui-monospace, monospace", fontSize: 13px, fontWeight: 400, lineHeight: 20px }
  button-lg: { fontFamily: "Inter, Geist, system-ui, sans-serif", fontSize: 15px, fontWeight: 500, lineHeight: 22px }

rounded: { sm: 6px, md: 8px, lg: 12px, pill: 100px, full: 9999px }

spacing: { xs: 8px, sm: 12px, md: 16px, lg: 24px, xl: 32px, 2xl: 40px, 3xl: 48px }

components:
  nav-bar: { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", height: 64px }
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "{rounded.pill}", typography: "{typography.button-lg}" }
  button-secondary: { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", rounded: "{rounded.pill}", typography: "{typography.button-lg}" }
  card: { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", rounded: "{rounded.lg}", shadow: "0 0 0 1px #00000014, 0px 2px 2px #0000000a, 0px 8px 8px -8px #0000000a" }
  form-input: { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", borderColor: "{colors.hairline}", rounded: "{rounded.sm}", height: 40px, typography: "{typography.body-sm}" }
  code-editor-mockup: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "{rounded.md}", typography: "{typography.code}" }
  badge-secondary: { backgroundColor: "{colors.canvas-soft}", textColor: "{colors.body}", rounded: "{rounded.full}", typography: "{typography.caption}" }

---

# Axiom — Design System (Vercel-inspired)

A stark black-ink-on-near-white surface for a developer tool. The only colour
atmosphere is the multi-stop mesh gradient (cyan / blue / magenta / amber), used
at hero scale only. Mono carries every technical label; the geometric sans
carries everything narrative.

## Principles
- Reserve ink `#171717` for primary CTAs. Black ink is the conversion target.
- Pill (100px) for marketing-scale CTAs; 6px square for in-app buttons/inputs.
- Headlines: weight 600, sentence-case, often period-terminated, aggressive
  negative tracking. Never all-caps outside mono labels.
- Mono (caption-mono / code) for eyebrows, code blocks, packet output, ids.
- Stacked subtle shadows + inset hairline; never a single heavy drop-shadow.
- Cycle surfaces canvas-soft → canvas → primary (dark band) for depth.

## Color tokens
- primary / ink `#171717`, on-primary `#ffffff`
- body `#4d4d4d`, mute `#888888`
- hairline `#ebebeb`, hairline-strong `#a1a1a1`
- canvas `#ffffff`, canvas-soft `#fafafa`, canvas-soft-2 `#f5f5f5`
- link `#0070f3`, error `#ee0000`, warning `#f5a623`
- mesh: `#007cf0`→`#00dfd8`, `#7928ca`→`#ff0080`, `#ff4d4d`→`#f9cb28`

## Type
- Sans: Inter (400/500/600) — Geist substitute.
- Mono: JetBrains Mono (400) — Geist Mono substitute.

## Font substitutes (open source)
- Geometric sans → Inter. Monospace → JetBrains Mono.

## Component mapping (Axiom app)
- `.brand` → nav-bar + hero eyebrow.
- `.intake` → card with form-input textarea.
- `.compile` → button-primary (ink pill).
- `.gate` / `.question` → card (lg radius, stacked shadow).
- `.packet` → code-editor-mockup (ink bg, mono).
- `.pill` (meta) → badge-secondary (mono caption).

## Do / Don't
- Do keep the gradient atmospheric and hero-scale only.
- Don't add a 6th accent; don't uppercase headlines; don't 700 weight; don't
  heavy single drop-shadows; don't set body in mono.
