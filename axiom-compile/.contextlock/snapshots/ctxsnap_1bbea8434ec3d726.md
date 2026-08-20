# ContextLock Snapshot

- Project: ctxproj_peproxy
- Snapshot hash: ctxsnap_1bbea8434ec3d726
- Source commit: 582b8f33409dfbc694fd147a32135243f1fd4e64
- Branch: master
- Dirty: yes
- Files: 7647

## Project summary
peproxy has 7647 tracked files across 3 detected languages.

## Known facts
- Languages: javascript, rust, typescript
- Manifests: None detected
- Dependencies: None detected

## Commands
- Test: None detected
- Build: None detected
- Run: None detected

## Entry points
- app/node_modules/@babel/code-frame/lib/index.js
- app/node_modules/@babel/core/lib/config/files/index.js
- app/node_modules/@babel/core/lib/config/index.js
- app/node_modules/@babel/core/lib/index.js
- app/node_modules/@babel/core/lib/parser/index.js
- app/node_modules/@babel/core/lib/transformation/index.js
- app/node_modules/@babel/core/src/config/files/index.ts
- app/node_modules/@babel/generator/lib/generators/index.js
- app/node_modules/@babel/generator/lib/index.js
- app/node_modules/@babel/generator/lib/node/index.js
- app/node_modules/@babel/helper-compilation-targets/lib/index.js
- app/node_modules/@babel/helper-module-imports/lib/index.js
- … and 90 more

## Module / directory map
- app (source, 6746 files)
- packages (other, 892 files)
- project-docs (other, 2 files)
- scripts (other, 3 files)

## Docs map
- app/node_modules/@babel/code-frame/README.md
- app/node_modules/@babel/compat-data/README.md
- app/node_modules/@babel/core/README.md
- app/node_modules/@babel/generator/README.md
- app/node_modules/@babel/helper-compilation-targets/README.md
- app/node_modules/@babel/helper-globals/README.md
- app/node_modules/@babel/helper-module-imports/README.md
- app/node_modules/@babel/helper-module-transforms/README.md
- app/node_modules/@babel/helper-plugin-utils/README.md
- app/node_modules/@babel/helper-string-parser/README.md
- app/node_modules/@babel/helper-validator-identifier/README.md
- app/node_modules/@babel/helper-validator-option/README.md
- app/node_modules/@babel/helpers/README.md
- app/node_modules/@babel/parser/CHANGELOG.md
- app/node_modules/@babel/parser/README.md
- app/node_modules/@babel/plugin-transform-react-jsx-self/README.md
- … and 76 more

## Files to read first
- PLAN.md — documentation
- README.md — primary documentation
- app/node_modules/@babel/code-frame/README.md — primary documentation
- app/node_modules/@babel/code-frame/lib/index.js — entrypoint
- app/node_modules/@babel/compat-data/README.md — primary documentation

## Known debt markers
- app/node_modules/@jridgewell/gen-mapping/src/gen-mapping.ts:308 TODO // TODO: implement originalScopes/generatedRanges
- app/node_modules/@jridgewell/remapping/src/build-source-map-tree.ts:70 TODO // TODO: We should eventually support async loading of sourcemap files.
- app/node_modules/@jridgewell/remapping/src/source-map-tree.ts:102 TODO // TODO: Eventually support sourceRoot, which has to be removed because the sources are already
- app/node_modules/@types/node/buffer.buffer.d.ts:454 TODO // TODO: remove globals in future version
- app/node_modules/@types/node/child_process.d.ts:902 TODO // TODO: Just Plain Wrong™ (see also nodejs/node#57392)
- app/node_modules/@types/node/child_process.d.ts:1069 TODO // TODO: execFile exceptions can take many forms... this accurately describes none of them
- app/node_modules/@types/node/fs.d.ts:2610 TODO // TODO: remove in future major
- app/node_modules/@types/node/fs.d.ts:2613 TODO // TODO: remove in future major
- app/node_modules/@types/node/fs.d.ts:4119 TODO // TODO: remove default in future major version
- app/node_modules/@types/node/fs.d.ts:4166 TODO // TODO: remove default in future major version
- app/node_modules/@types/node/fs/promises.d.ts:98 TODO // TODO: Add `EventEmitter` close
- app/node_modules/@types/node/net.d.ts:47 TODO // TODO: remove empty ConnectOpts placeholder at next major @types/node version.
- … and 762 more

## Recent git context
- 582b8f3 Relocate project to native filesystem (~/peproxy)
- 5e6229a Fix NTFS native-binary segfault + browser-safe core engine
- 6f89dc8 PEPROXY Pass 1: M1 headless intent-compiler core (verified) + Tauri/React shell + preview

## Inferred risk zones
- app
- packages

## Do not assume
- Unhandled ecosystems are only partially understood.
- Inferred context is a summary, not a contract.
- Missing commands are unknown, not absent.

