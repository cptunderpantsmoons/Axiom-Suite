# Axiom

> A ruthless **intent compiler**: infer as much as possible, ask only high-leverage
> questions, then emit a scoped, testable, context-compressed one-shot task packet.

Axiom sits between a messy human request and a coding harness. It is **not** a
chatbot — it compiles raw intent into a validated, structured task contract.

Status: **Pass 1 (M0 scaffold + M1 headless core) — built and verified.**

---

## What's here

| Path | Role |
|---|---|
| `PLAN.md` | Locked product decisions & milestones (M0–M8) |
| `project-docs/tasklist.md` | Exact-requirements task breakdown (Passes 1–4) |
| `project-docs/architecture.md` | Technical architecture + resolved decisions (ADR-001..004) |
| `packages/axiom-core/` | **@axiom/core** — headless intent-compiler library (M1) |
| `app/` | Tauri shell + React/TS webview UI (M0 scaffold) |
| `app/preview.*` | Dependency-free live preview driven by the real engine |
| `scripts/preview-server.mjs` | Node server that serves the preview + `/api/compile` |

### Core pipeline (`packages/core/src/routes.ts`)
```
raw request
  -> context/ (deterministic repo facts) + memory/ rules
  -> model intent extraction -> Zod IntentResult (fail-closed)
  -> risk heuristics -> ruthless question gate (max 3, defaults)
  -> compiler/spec + packet -> TaskPacket (canonical Zod) -> §7 markup
  -> telemetry/ (local structured)
```

## Verify it (no bundler required)

```bash
cd packages/axiom-core
npm install
npm run build          # tsc -> dist/
npm test               # node --test (4 tests) — M1 exit gate
npm run cli -- --test  # golden: "make auth better" -> valid one-shot
node dist/src/cli.js --auto "fix auth login"

# Live preview (real engine behind a real UI):
cd ../..
node scripts/preview-server.mjs 4173   # open http://localhost:4173
```

## Home: `~/peproxy` (native filesystem)

This repository now lives at **`/home/moonbuggy/peproxy`** on the native `ext2/3`
filesystem, so every native toolchain component (esbuild, rollup, Tauri CLI) runs
directly — no workaround needed.

> **Historical note — NTFS native-binary crash (root-caused & fixed).** When this
> repo lived on an NTFS3-mounted drive, native code mapped from that mount failed
> to `mmap`/`dlopen`: Go executables (esbuild → tsx/vite/vitest) SIGSEGV (139) and
> Rust `.node` addons (rollup/Tauri/lzma) failed to load. The no-root fix
> `scripts/ntfs-native-bins.sh` relocates native ELF/`.node` files onto a native fs
> and symlinks them back. Retained in-tree for any future NTFS checkouts.

## Stack integration

When ContextLock is installed in the target repository, the Node host can load
its curated Ground contract without reading `.contextlock` internals:

```bash
ctx context export --format json
```

`collectContext(cwd, { groundRequired: true })` validates `GroundContext v1`,
adds non-stale Ground memory to Compile constraints, and the ready result includes
an `axiom.taskpacket.v1` envelope with the `ctxsnap_*` reference and deterministic
`sha256:` packet hash. The envelope is intended for Helm/Axiom Govern; the existing
internal `TaskPacket` contract remains backward-compatible.

```ts
const result = await compileIntent("make auth better", { context });
// result.envelope.ground?.snapshot_hash
// result.envelope.taskpacket_id
// result.envelope.packet_hash
```

## Core split (browser-safe engine + Node entry)
`index.ts` is browser-safe (no `node:*` imports) so the webview bundle is clean.
Host-side capabilities (deterministic context collection, Claude CLI detection)
live in `src/node.ts` (`context/repo.node.ts`, `harness/`). Hosts inject a
`RepoContext` via `compileIntent({ context })`. The Node CLI / preview server use
the `node.ts` entry.

## M1 exit gate (passed)
`"make auth better"` → valid structured one-shot packet with all 10 §7 sections,
verified by unit tests and the golden CLI test.

## Roadmap
- **Pass 2:** real DeepSeek provider + repair loop (M2), question gate + UI modes (M3)
- **Pass 3:** 4-layer SQLite memory + rewrite-not-append loop (M4), both harness modes (M5)
- **Pass 4:** router/providers/privacy (M6), telemetry + evals (M7), hardening + ship (M8)