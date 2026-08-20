import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ensureDir,
  readJsonIfExists,
  resolveGitRoot,
  runGit,
  sha256,
  fail
} from '../utils/core.js';
import {
  buildDefaultConfig,
  buildDefaultLock,
  ensureContextlockDirs,
  getProjectId,
  writeConfigJson,
  writeLockJson
} from '../init/index.js';
import { detectSupportLevel } from '../scanner/index.js';
import {
  buildSnapshot,
  writeSnapshotArtifacts,
  updateLockAfterSnapshot,
  loadSnapshotArtifact,
  listSnapshotArtifacts
} from '../snapshot/index.js';
import {
  renderOnboardingPrompt,
  writePromptArtifacts,
  getLatestSnapshotHash,
  getPromptFreshness
} from '../prompts/index.js';
import { buildSiteArtifacts, updateLockAfterSite } from '../site/index.js';
import { latestAuditArtifact } from '../audit/index.js';

// ---------------------------------------------------------------------------
// Pretty output helpers
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function ok(msg) { return `${GREEN}✓${RESET} ${msg}`; }
function warn(msg) { return `${YELLOW}⚠${RESET} ${msg}`; }
function bad(msg) { return `${RED}✗${RESET} ${msg}`; }
function info(msg) { return `${CYAN}→${RESET} ${msg}`; }
function heading(msg) { return `\n${BOLD}${msg}${RESET}`; }

function commitAge(isoString) {
  if (!isoString) return 'unknown';
  const ms = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function openFile(filePath) {
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawnSync(opener, [filePath], { stdio: 'ignore', shell: process.platform === 'win32' });
}

// ---------------------------------------------------------------------------
// ctx bootstrap — one command to rule them all
// ---------------------------------------------------------------------------

export function bootstrapCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const quiet = args.includes('--quiet');
  const noOpen = args.includes('--no-open');
  const force = args.includes('--force');

  const projectName = path.basename(root);
  const branch = runGit(['branch', '--show-current'], root) || 'detached';
  const commit = runGit(['rev-parse', '--short', 'HEAD'], root) || 'unknown';

  if (!quiet) {
    console.log(heading(`🔍 ContextLock Bootstrap — ${projectName}`));
    console.log('');
    console.log(`  Repository : ${root}`);
    console.log(`  Branch     : ${branch} @ ${commit}`);
    console.log('');
  }

  // Step 1 — Init
  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  const wasInitialized = existsSync(configPath) && existsSync(lockPath);

  if (wasInitialized && !force) {
    if (!quiet) console.log(ok('Already initialized — skipping init'));
  } else {
    ensureContextlockDirs(root);
    const existingConfig = force ? readJsonIfExists(configPath) : null;
    const existingLock = force ? readJsonIfExists(lockPath) : null;
    const config = buildDefaultConfig(root, existingConfig);
    const lock = buildDefaultLock(config.project_id, root, existingLock);
    writeConfigJson(root, config);
    writeLockJson(root, lock);
    if (!quiet) console.log(ok('Initialized .contextlock/'));
  }

  // Step 2 — Snapshot
  const config = readJsonIfExists(configPath);
  const lock = readJsonIfExists(lockPath);
  const supportLevel = detectSupportLevel(root);

  const snapshot = buildSnapshot(root, config, lock, { generationMode: 'full' });
  writeSnapshotArtifacts(root, snapshot);
  updateLockAfterSnapshot(root, config, lock, snapshot);

  if (!quiet) {
    console.log(ok(`Snapshot ${snapshot.snapshot_hash} — ${snapshot.machine_facts.file_count} files`));
    if (snapshot.machine_facts.languages.length) {
      console.log(`  Languages: ${snapshot.machine_facts.languages.join(', ')}`);
    }
    if (snapshot.machine_facts.entrypoints.length) {
      console.log(`  Entrypoints: ${snapshot.machine_facts.entrypoints.slice(0, 3).join(', ')}`);
    }
  }

  // Step 3 — Prompt
  const promptText = renderOnboardingPrompt(snapshot);
  const promptArtifacts = writePromptArtifacts(root, snapshot, 'onboarding', promptText);
  const nextLock = {
    ...readJsonIfExists(lockPath),
    latest_prompt_hashes: {
      ...(lock?.latest_prompt_hashes || {}),
      onboarding: promptArtifacts.metadata.prompt_id
    },
    updated_at: new Date().toISOString()
  };
  writeLockJson(root, nextLock);

  if (!quiet) {
    console.log(ok(`Onboarding prompt compiled`));
  }

  // Step 4 — Site
  const freshLock = readJsonIfExists(lockPath);
  const siteData = buildSiteArtifacts(root, freshLock);
  updateLockAfterSite(root, freshLock, siteData);

  if (!quiet) {
    console.log(ok(`Site built — .contextlock/site/index.html`));
  }

  // Step 5 — Hooks hint (optional)
  const wantsHooks = args.includes('--with-hooks');

  // Step 6 — Summary
  const relativePrompt = path.relative(root, promptArtifacts.mdPath);
  const relativeSite = path.relative(root, path.join(root, '.contextlock', 'site', 'index.html'));
  const debtCount = snapshot.debt_markers.length;
  const supportLabel = supportLevel === 'full' ? 'full' : 'basic';

  if (!quiet) {
    console.log('');
    console.log(heading('✨ Your project context is ready'));
    console.log('');
    console.log(`  ${BOLD}Next steps:${RESET}`);
    console.log(info(`Feed your AI the onboarding prompt:`));
    console.log(`    ${DIM}cat ${relativePrompt}${RESET}`);
    console.log('');
    console.log(info(`Browse your project dashboard:`));
    console.log(`    ${DIM}${relativeSite}${RESET}`);
    console.log('');
    console.log(info(`Check context health anytime:`));
    console.log(`    ${DIM}ctx doctor${RESET}`);
    console.log('');
    console.log(info(`Detect drift after changes:`));
    console.log(`    ${DIM}ctx snapshot && ctx audit --since-last${RESET}`);
    console.log('');

    if (debtCount > 0) {
      console.log(warn(`${debtCount} debt marker${debtCount !== 1 ? 's' : ''} found — run \`ctx doctor\` for details`));
    }

    if (supportLevel !== 'full') {
      console.log(warn(`Support level: ${supportLabel} — some features may be limited`));
    }

    if (wantsHooks) {
      console.log('');
      console.log(info('To install post-commit automation, run: ctx hooks install'));
    }

    console.log('');
  }

  // Open site
  if (!noOpen && !quiet) {
    const sitePath = path.join(root, '.contextlock', 'site', 'index.html');
    if (existsSync(sitePath)) {
      openFile(sitePath);
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// ctx doctor — health check, no side effects
// ---------------------------------------------------------------------------

export function doctorCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const jsonOut = args.includes('--json');
  const projectName = path.basename(root);
  const branch = runGit(['branch', '--show-current'], root) || 'detached';
  const commit = runGit(['rev-parse', '--short', 'HEAD'], root) || 'unknown';
  const dirtyRaw = runGit(['status', '--porcelain'], root) || '';
  const dirtyLines = dirtyRaw.split('\n').filter(l => l.trim() && !l.includes('.contextlock'));
  const isDirty = dirtyLines.length > 0;

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  const initialized = existsSync(configPath) && existsSync(lockPath);

  const checks = [];

  // Git check
  checks.push({
    label: 'Git repository',
    status: 'ok',
    detail: `${branch} @ ${commit}${isDirty ? ` (${dirtyLines.length} uncommitted change${dirtyLines.length !== 1 ? 's' : ''})` : ' (clean)'}`
  });

  // Init check
  if (initialized) {
    checks.push({ label: 'ContextLock', status: 'ok', detail: 'initialized' });
  } else {
    checks.push({ label: 'ContextLock', status: 'bad', detail: 'not initialized — run `ctx bootstrap`' });
  }

  const config = readJsonIfExists(configPath);
  const lock = readJsonIfExists(lockPath);
  const supportLevel = initialized ? detectSupportLevel(root) : 'unknown';

  if (initialized) {
    // Support level
    checks.push({
      label: 'Ecosystem support',
      status: supportLevel === 'full' ? 'ok' : 'warn',
      detail: supportLevel
    });

    // Snapshot freshness
    const snapshots = listSnapshotArtifacts(root);
    const latestSnapshotHash = lock?.latest_snapshot_hash || null;
    if (latestSnapshotHash) {
      const snapshot = loadSnapshotArtifact(root, latestSnapshotHash);
      const age = snapshot?.created_at ? commitAge(snapshot.created_at) : 'unknown';
      const fileCount = snapshot?.machine_facts?.file_count || '?';
      const snapCommit = snapshot?.git?.commit
        ? snapshot.git.commit.slice(0, 7)
        : 'unknown';
      const isStale = snapshot?.git?.commit && commit && snapshot.git.commit.slice(0, 7) !== commit;

      checks.push({
        label: 'Snapshot',
        status: isStale ? 'warn' : 'ok',
        detail: `${latestSnapshotHash} — ${fileCount} files (${age})${isStale ? ' — stale, rerun `ctx snapshot`' : ''}`
      });
    } else {
      checks.push({ label: 'Snapshot', status: 'bad', detail: 'no snapshot — run `ctx bootstrap`' });
    }

    // Prompt freshness
    const promptFreshness = getPromptFreshness(root, latestSnapshotHash);
    checks.push({
      label: 'Onboarding prompt',
      status: promptFreshness === 'fresh' ? 'ok' : promptFreshness === 'stale' ? 'warn' : 'bad',
      detail: promptFreshness === 'fresh' ? 'fresh' : `${promptFreshness} — run \`ctx prompt refresh\``
    });

    // Drift
    const driftScore = lock?.latest_drift_score;
    if (typeof driftScore === 'number') {
      const driftStatus = driftScore >= 51 ? 'bad' : driftScore >= 26 ? 'warn' : 'ok';
      checks.push({
        label: 'Drift score',
        status: driftStatus,
        detail: `${driftScore}/100`
      });
    } else {
      checks.push({
        label: 'Drift score',
        status: 'warn',
        detail: 'no audit yet — run `ctx audit --since-last` after making changes'
      });
    }

    // Debt markers
    if (latestSnapshotHash) {
      const snapshot = loadSnapshotArtifact(root, latestSnapshotHash);
      const debt = snapshot?.debt_markers || [];
      const todos = debt.filter(m => m.marker === 'TODO').length;
      const fixmes = debt.filter(m => m.marker === 'FIXME').length;
      const hacks = debt.filter(m => m.marker === 'HACK').length;

      const hasDebt = debt.length > 0;
      const hasHighPriority = fixmes > 0 || hacks > 0;
      checks.push({
        label: 'Debt markers',
        status: hasHighPriority ? 'warn' : hasDebt ? 'ok' : 'ok',
        detail: hasDebt
          ? `${debt.length} (${todos} TODO, ${fixmes} FIXME, ${hacks} HACK)`
          : 'none found'
      });
    }

    // Hooks
    const hookPath = path.join(root, '.git', 'hooks', 'post-commit');
    const hookExists = existsSync(hookPath);
    const isManaged = hookExists && readFileSync(hookPath, 'utf8').includes('Managed by ContextLock');
    checks.push({
      label: 'Post-commit hook',
      status: isManaged ? 'ok' : 'warn',
      detail: isManaged ? 'installed' : hookExists ? 'exists but not managed by ContextLock' : 'not installed — run `ctx hooks install`'
    });

    // Remote
    const remoteConfig = config?.remote;
    const hasRemote = remoteConfig?.repo;
    checks.push({
      label: 'Remote storage',
      status: hasRemote ? 'ok' : 'warn',
      detail: hasRemote ? `${remoteConfig.provider}://${remoteConfig.repo}` : 'not configured — run `ctx remote add hf <repo>`'
    });
  }

  // Machine-readable output
  if (jsonOut) {
    console.log(JSON.stringify({
      project: projectName,
      branch,
      commit,
      dirty: isDirty,
      initialized,
      support_level: supportLevel,
      checks: checks.map(c => ({
        label: c.label,
        status: c.status,
        detail: c.detail
      }))
    }, null, 2));
    return 0;
  }

  // Pretty output
  console.log(heading(`🏥 ContextLock Doctor — ${projectName}`));
  console.log('');

  const statusIcon = { ok, warn, bad };
  for (const check of checks) {
    const icon = statusIcon[check.status] || info;
    console.log(`  ${icon(`${BOLD}${check.label}${RESET}: ${check.detail}`)}`);
  }

  // Recommendations
  const problems = checks.filter(c => c.status !== 'ok');
  if (problems.length > 0) {
    console.log('');
    console.log(heading('📋 Recommendations'));
    console.log('');

    if (!initialized) {
      console.log(info('Run `ctx bootstrap` to get started in one command'));
    } else {
      const recs = [];
      for (const p of problems) {
        if (p.detail.includes('stale') || p.detail.includes('rerun')) {
          recs.push('ctx snapshot           # refresh your context');
        }
        if (p.detail.includes('prompt') && p.detail.includes('refresh')) {
          recs.push('ctx prompt refresh     # update the AI onboarding prompt');
        }
        if (p.detail.includes('audit') || p.detail.includes('no audit')) {
          recs.push('ctx audit --since-last # check for context drift');
        }
        if (p.detail.includes('hook')) {
          recs.push('ctx hooks install      # automate context on every commit');
        }
        if (p.detail.includes('remote')) {
          recs.push('ctx remote add hf <username>/<repo>  # sync to the cloud');
        }
      }
      const unique = [...new Set(recs)];
      if (unique.length) {
        for (const r of unique) {
          console.log(`  ${DIM}${r}${RESET}`);
        }
      }
    }
  }

  console.log('');
  return problems.some(p => p.status === 'bad') ? 1 : 0;
}
