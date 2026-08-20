# Management Harness — Visual Identity & Art Direction

_A governance control plane for enterprise AI. Codename: **Management Harness**_
_(github.com/laiw/management-harness — an AI governance gateway: budget, guardian, policy,
audit, routing, prompt optimisation, reusable skills.)_

> **Note on current state:** the dashboard (`internal/web/embed.go`) is embedded at build
> time via `go:embed dist`; no prebuilt `dist/index.html` is checked in (see
> `implementation_plan.md`). There is therefore **no existing static design language to
> evolve** — this document defines the brand identity from first principles, aligned to
> the product's narrative (auth → budget → guardian → policy → router → immutable audit).

---

## 1. Logo concept direction

### Guiding metaphor — "The governed gate / regulated flow"
This product is not a fluffy AI assistant — it is the **single point of control** every
AI request must pass through before it touches an LLM. The mark should read as both
**protection** (a gate) and **direction** (a flow through a valve), never as a decorative
"AI sparkle."

**Mark concept — "Controlled Lane":** a horizontal flow line entering from the left,
passing through a curved **valve/gate** silhouette (an open "U" plus a vertical stem)
that **splits it into two or three disciplined parallel lanes**, then emerges routed
outward. Reading order implies *everything flows in, is governed, and is directed out*.
The gate element doubles as a subtle "HD" / "H" monogram — the spacing between lanes can
aliqn to form a horizontal track, echoing a rack-server / control-plane rail.

**Alternate marks (offer, don't build yet):**
- **The Verifier:** a checkbox fused with a flow-chevron — click-connotation of policy, audit, pass/fail.
- **The Router:** an inbound lane diversifying into outbound branches — pure routing/mesh.
- **The Rack/Scope:** a squared bracket containing a dot — "N of N" governance/telemetry, most minimal.

**Primary recommendation:** *Controlled Lane.* It carries the strongest story (gate +
flow + route), stays abstract enough to avoid literal pixel-drawing arguments, and scales
from 16px favicon to masthead.

### Forms
- **Mark:** geometric, strict-corners-capable (Curaved U + orthogonal lanes), strokes
  aligned to a 8px grid. No gradients in the lockup's resting state.
- **Wordmark:** "Management Harness" set uppercase, tight tracked, in the display typeface
  (see §3). Avoid a lowercase friendly "AI" suffix — call the product "Management Harness"
  plainly. A small technical suffix like `µ/gov` or `::` is acceptable on dark data
  surfaces, not in the primary lockup.
- **Lockup relation:** mark left, wordmark right, baseline-aligned. Tight and engineered,
  not logo-and-whitespace-and-more-whitespace-marketing.

---

## 2. Color palette

Confident, technical, dark-first (control-panel) with semantic status colors that match
the product's real states (budget soft/hard, guardian deny, pass, warn).

### Brand core (dark, "operators at night")
| Token | Hex | Use |
|-------|-----|-----|
| `ink-900` | `#0B1220` | Primary surface / app background |
| `ink-800` | `#101829` | Raised panels, cards |
| `ink-700` | `#1B2438` | Hover panels, edges |
| `slate-400` | `#94A3B8` | Muted secondary text |
| `slate-100` | `#E2E8F0` | Primary text on dark |

### Brand accent (the "control" color)
| Token | Hex | Use |
|-------|-----|-----|
| **Control Teal** | `#2DD4BF` | Primary action, links, active route, live/healthy pulse |
| **Signal Blue** | `#38BDF8` | Informational focus, selected states, "monitoring" mark |

Why teal/cyan on deep navy: reads as *live infrastructure* (Ping, Grafana, the wires),
not consumer friendliness. Teal = governing/active; Blue = observational. Both pass
WCAG AA on `#0B1220`.

### Semantic status (map exactly to product states)
| Token | Hex | Product meaning |
|-------|-----|-----------------|
| Pass / Healthy | `#34D399` | Budget healthy, guardian ok, provider green |
| Warn / Soft-limit | `#FBBF24` | Soft budget, near threshold, deprecated policy |
| Deny / Hard-block | `#F87171` | Guardian denied, hard limit hit, PII caught, audit break |

**Rules:** never use the semantic reds/greens for branding — reserve them for true
state. Teal/blue carry the brand. Keep neutrals in the slate ramp for UI chrome. Provide
high-contrast light mode later; this identity is dark-native because operators of
Splunk/Datadog/Grafana expect it.

---

## 3. Typography

Three-voice system balancing *technical precision* with *enterprise trust*.

| Role | Typeface | Var | Notes |
|------|----------|-----|-------|
| **Display** | **Space Grotesk** | 700, 500 | Distinct uppercase personality for masthead, page titles, stat numerals. Modern but engineered, not "app-startup" rounded. |
| **UI** | **Inter** | 400 / 500 / 600 | Primary body & interface text. Ubiquitous, excellent legibility at 12–14px data-dense sizes. |
| **Mono** | **IBM Plex Mono** | 400 / 500 | All technical surfaces: JSON, audit hash-chain IDs, `hk_` keys, token counts, CLI snippets, provider/model names. Matches IBM's enterprise connotation. |

- **Scale:** UI 12 base (dense dashboards), 13 optional, 14 default body; display from
  20→40px. Tight line-height on dashboards (1.25) for density; 1.5 for docs/prose.
- **Case:** headings in **uppercase** Space Grotesk with modest letterspacing (0.01–0.02em)
  for the control-plane feel; never ALL-CAPS long paragraphs.
- **Fallbacks:** Space Grotesk → Inter → system; IBM Plex Mono → SF Mono/Menlo/Consolas.

---

## 4. Art-direction & iconography style guide (dashboards + docs)

### Icon system — "operator console" line style
- **Stroke icons, 24px grid, 1.5–2pt stroke**, consistent corner radius, flat fill within
  bounded paths; **no soft gradients, no heavy drop shadows** on glyphs.
- Iconography vocabulary reflects the product:
  - Flow: chevrons/lanes for **Router**
  - Shield + flag for **Guardian**
  - Gauge/percentage arcs for **Budget**
  - Document + hash-link for **Audit**
  - Sliders / knurl for **Policy**
  - Bolt/stacked sheets for **Skills** (reusable prompt contracts)
- **Status dot convention:** a 6px semantic dot (teal/blue/amber/red) top-right of a
  service icon = live health. Uniform across the whole product.
- **Action vs. state:** interactive controls = stroke; live status/health = filled solid
  token color. Keep the two never mixed within one glyph.

### Dashboard art direction
- **Layout:** dense, engineered grids on `ink-900`; floating cards on `ink-800` with
  1px border in `#1E293B`, minimal elevation (no floaty shadows). **A surface that reads
  like a rack, not a coffee-shop landing page.**
- **Data viz:** thin line/pulse charts in **Control Teal** on deep navy; area gradients
  limited to 8% opacity for texture. Use the semantic palette only for thresholds and
  failures. Sparse gridlines, high data-ink ratio.
- **Logs/audit:** mono, `slate-100` on `ink-900`, hash-chain IDs truncated with full
  value on hover. Guard/deny rows tinted with their semantic color at ~10% background —
  never full saturation floods.
- **Empty/success states:** a calm check or flow-glyph in teal; **never** celebratory
  confetti or emoji — this is a control plane.
- **Accessibility:** WCAG AA minimum contrast (teal/blue on ink pass ~4.6:1); don't rely
  on color alone — pair status colors with glyph + label; honor reduced-motion.

### Docs / diagrams
- Architecture diagrams use the exact same arrow/lane language as the logo (the gate →
  lanes). Pipeline runs **left→right**, consistent with the README proxy flow. Colors
  restricted to the §2 palette; no arbitrary rainbow nodes.

---

## 5. Brand story (pair with the name)

> Management Harness is the one place where enterprise AI meets governance. Every prompt
> that crosses your boundary is authenticated, budgeted, guarded, and counted — routed
> and recorded as an immutable trail, so teams can ship with AI freely and security
> leaders stay in the control room, not on call.

*(Cut line if needed: "All your AI traffic, governed in one harness.")*

---

## Implementation notes
- Serve fonts self-hosted (privacy in a governance product); preload woff2 for space-grotesk + inter + plex-mono.
- Add color/type tokens to the React dashboard theme (MUI/Tailwind tokens as `ink-*`, `control`, `danger`, etc.).
- Ship a `docs/architecture` diagram reusing the lane metaphor to mirror the README flow.
