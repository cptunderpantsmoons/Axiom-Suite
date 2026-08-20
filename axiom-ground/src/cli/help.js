const VERSION = '0.1.0';

function printHelp() {
  console.log(`ContextLock ctx ${VERSION}

Usage:
  ctx <command> [options]

Commands:
  bootstrap         One-command setup: init + snapshot + prompt + site
  doctor            Health check — diagnose context freshness and drift
  init              Initialize .contextlock/ in a Git repository
  status            Show ContextLock project status
  snapshot          Generate project snapshot artifacts
  prompt onboarding Compile an onboarding prompt from the latest snapshot
  prompt refresh    Refresh onboarding prompt artifacts
  audit             Compare snapshots and report drift
  site build        Generate static HTML site
  hooks install     Install post-commit automation
  hooks uninstall   Remove post-commit automation
  remote add        Configure a remote backend
  sync              Push local artifacts to remote
  pull              Download remote artifacts
  rules validate    Validate architecture rules and suppressions
  plan              Generate a feature, refactor, or release plan
  memory add        Add a drift-anchored memory entry
  memory list       List memory entries (--stale filters by drift flag)
  memory verify     Mark stale entries via drift audit
  memory supersede  Link an old entry to its replacement
  context export    Export curated GroundContext v1 for downstream Axiom products
  code index        Build a deterministic, provenance-bearing code index artifact
  progress          Show or update planning progress (spec/build status)

Options:
  -h, --help        Show this help
  -v, --version     Show version

Init options:
  --yes             Non-interactive mode
  --force           Reinitialize while preserving existing config where possible

Status options:
  --format json     Print machine-readable status JSON

Snapshot options:
  --full            Force a full snapshot run
  --incremental     Mark snapshot generation as incremental
  --json            Print snapshot JSON to stdout
  --format json     Print machine-readable JSON where supported
  --quiet           Suppress normal output
  --ci              CI mode — handles shallow clones, minimal output

Prompt options:
  --stdout          Print prompt markdown to stdout
  --quiet           Suppress normal output
  --changed         Only refresh if prompt is stale or missing
  --all             Force refresh regardless of freshness

Audit options:
  --since-last      Compare latest snapshot to previous snapshot
  --from <hash>     Compare from a specific snapshot hash
  --to <hash>       Compare to a specific snapshot hash
  --quiet           Suppress normal output
  --format json     Print machine-readable audit JSON
  --pr              PR mode — snapshots base branch and generates markdown report
  --base <ref>      Specify base branch for PR audit (default: auto-detect)
  --strict          Exit non-zero if drift exceeds configured threshold
  --against-plan <id>  Audit implementation progress against a plan

Site options:
  build             Generate site artifacts
  open              Open the site in a browser
  export <dir>      Copy site artifacts to a directory
  --quiet           Suppress normal output

Hooks options:
  install           Install managed pre-commit and post-commit hooks
  uninstall         Restore or remove managed hooks

Remote options:
  add <provider> <repo>  Configure remote backend (e.g. hf username/repo)

Sync options:
  --push            Push-only mode
  --quiet           Suppress normal output
  --dry-run         Show what would be synced without uploading

Pull options:
  --snapshot <hash> Pull a specific snapshot
  --quiet           Suppress normal output

Plan options:
  feature [--area <path>]  Generate a feature plan
  refactor [--area <path>] Generate a refactor plan
  release                  Generate a release plan
  --quiet                  Suppress normal output

Memory options:
  add --type <t> "<content>" [--relates <file> ...]  Anchor a memory to the current snapshot
  list [--stale]           List entries (--stale filters to drift-flagged)
  list --format json       Print entries as machine-readable JSON
  verify                   Run drift audit and flag stale entries
  verify --format json     Print verification results as JSON
  supersede <id> <new-id>  Link an old entry to its replacement

Progress options:
  set spec <id> <status>   Mark a spec's status in docs/planning/contextlock-progress.json
  set build <id> <status>  Mark a build's status in the same ledger
  set guardrail <active|planned> <name> <status>  Mark a guardrail's status (pass/fail/warn)
  --format json            Print the full progress JSON
                           Status scale: not_started, draft_complete, in_progress, blocked, validated, done

Context export options:
  --format json     Print the curated GroundContext v1 document
  --stdout          Alias for --format json
  --quiet           Suppress normal output

Code index options:
  index                 Build .contextlock/index/<snapshot>.json (file/symbol/redaction metadata)
  --format json         Print the code index as machine-readable JSON
  --quiet               Suppress normal output

RAG code indexing:
  ctx site export --rag <dir> --code   Include one per-file code doc in the bundle
`);
}

export { VERSION, printHelp };
