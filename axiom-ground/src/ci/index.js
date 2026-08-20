import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fail, printError, readJsonIfExists, resolveGitRoot, runGit } from '../utils/core.js';
import { buildDefaultConfig, ensureContextlockDirs, getProjectId, writeConfigJson } from '../init/index.js';
import { buildSnapshot, writeSnapshotArtifacts, updateLockAfterSnapshot, loadSnapshotArtifact, listSnapshotArtifacts } from '../snapshot/index.js';
import { buildAuditFindings, scoreAudit, writeAuditArtifacts } from '../audit/index.js';

// ---------------------------------------------------------------------------
// CI environment detection
// ---------------------------------------------------------------------------

function detectCiEnv() {
  // GitHub Actions
  if (process.env.GITHUB_ACTIONS === 'true') {
    return {
      platform: 'github',
      baseRef: process.env.GITHUB_BASE_REF || 'main',
      headRef: process.env.GITHUB_HEAD_REF || null,
      eventName: process.env.GITHUB_EVENT_NAME || null,
      repo: process.env.GITHUB_REPOSITORY || null,
      prNumber: (() => {
        const ref = process.env.GITHUB_REF || '';
        const match = ref.match(/refs\/pull\/(\d+)\/merge/);
        return match ? match[1] : null;
      })()
    };
  }

  // GitLab CI
  if (process.env.GITLAB_CI === 'true') {
    return {
      platform: 'gitlab',
      baseRef: process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || 'main',
      headRef: process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || null,
      eventName: 'merge_request',
      repo: process.env.CI_PROJECT_PATH || null,
      prNumber: process.env.CI_MERGE_REQUEST_IID || null
    };
  }

  return { platform: 'local', baseRef: 'main', headRef: null, eventName: null, repo: null, prNumber: null };
}

// ---------------------------------------------------------------------------
// Shallow clone detection & guidance
// ---------------------------------------------------------------------------

function isShallowClone(root) {
  // A shallow clone has a .git/shallow file
  return existsSync(path.join(root, '.git', 'shallow'));
}

function ensureFullHistory(root) {
  if (!isShallowClone(root)) return true;

  // Try to fetch more history
  const fetch = spawnSync('git', ['fetch', '--unshallow', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000
  });

  if (fetch.status !== 0) {
    printError('shallow clone detected and unable to unshallow', {
      reason: 'CI checkout does not contain enough Git history for branch comparison.',
      recovery: 'Use fetch-depth: 0 in your checkout action, or unshallow the repository.',
      command: 'git fetch --unshallow'
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Base branch snapshot
// ---------------------------------------------------------------------------

function snapshotBaseBranch(root, baseRef) {
  // Try to checkout and snapshot the base branch
  const currentBranch = runGit(['branch', '--show-current'], root);
  const baseBranch = `origin/${baseRef}`;

  // Check if base branch exists
  const baseExists = runGit(['rev-parse', '--verify', baseBranch], root);
  if (!baseExists) {
    printError(`base branch ${baseBranch} not found`, {
      reason: 'The base branch ref is unavailable in the current checkout.',
      recovery: 'Ensure the base branch is fetched in CI using fetch-depth: 0.',
      command: 'git fetch --all --prune'
    });
    return null;
  }

  // Create a temporary snapshot by reading the base tree
  // We don't checkout to avoid disrupting CI — we snapshot via git ls-tree
  const baseCommit = runGit(['rev-parse', baseBranch], root);
  if (!baseCommit) return null;

  // Use git archive to get a temporary copy for snapshotting
  const tmpDir = path.join(root, '.contextlock', 'cache', 'base-checkout');
  try {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });

    // Create a minimal checkout of the base branch
    const archive = spawnSync('git', ['archive', baseBranch, '--format=tar'], {
      cwd: root,
      encoding: null
    });
    if (archive.status !== 0) return null;

    const tarFile = path.join(tmpDir, 'base.tar');
    writeFileSync(tarFile, archive.stdout);

    const extract = spawnSync('tar', ['-xf', tarFile, '-C', tmpDir], {
      cwd: tmpDir,
      encoding: 'utf8'
    });
    if (extract.status !== 0) return null;

    // Initialize ContextLock in the temp dir if needed
    const tmpConfig = path.join(tmpDir, '.contextlock', 'config.json');
    if (!existsSync(tmpConfig)) {
      ensureContextlockDirs(tmpDir);
      const config = buildDefaultConfig(tmpDir);
      writeConfigJson(tmpDir, config);
    }

    // Build snapshot in temp dir (it won't have git, but we'll fake the git metadata)
    const config = readJsonIfExists(tmpConfig) || buildDefaultConfig(tmpDir);
    const lock = {
      version: 1,
      project_id: config.project_id,
      current_branch: baseRef,
      current_commit: baseCommit
    };

    const snapshot = buildSnapshot(tmpDir, config, lock, { generationMode: 'full' });

    // Save the base snapshot into the main repo's .contextlock/snapshots/
    writeSnapshotArtifacts(root, snapshot);
    return snapshot.snapshot_hash;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// PR markdown report
// ---------------------------------------------------------------------------

function renderPrReport(audit, fromSnapshot, toSnapshot, failThreshold) {
  const drift = audit.final_drift_score;
  const icon = drift >= (failThreshold || 76) ? '🔴' : drift >= (failThreshold || 51) ? '🟡' : '🟢';
  const verdict = drift >= (failThreshold || 76)
    ? '⚠️ Drift score exceeds threshold'
    : drift >= (failThreshold || 51)
      ? '⚡ Moderate drift detected'
      : '✅ Low drift';

  const lines = [];
  lines.push('## ContextLock Audit Report');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Drift score** | ${icon} **${drift}/100** |`);
  lines.push(`| **From** | \`${fromSnapshot?.git?.branch || 'base'}@${(fromSnapshot?.git?.commit || 'unknown').slice(0, 8)}\` |`);
  lines.push(`| **To** | \`${toSnapshot?.git?.branch || 'HEAD'}@${(toSnapshot?.git?.commit || 'unknown').slice(0, 8)}\` |`);
  lines.push(`| **Snapshots** | \`${audit.from_snapshot}\` → \`${audit.to_snapshot}\` |`);
  lines.push(`| **Findings** | ${audit.findings.length} |`);
  lines.push(`| **Verdict** | ${verdict} |`);
  lines.push('');

  if (failThreshold && drift >= failThreshold) {
    lines.push(`> ⚠️ Drift score ${drift} exceeds configured threshold of ${failThreshold}.`);
    lines.push('');
  }

  if (audit.findings.length) {
    lines.push('### Findings');
    lines.push('');
    for (const finding of audit.findings) {
      const sev = finding.severity === 'high' ? '🔴' : finding.severity === 'medium' ? '🟡' : '🟢';
      lines.push(`- ${sev} **${finding.title}** (\`${finding.severity}\`)`);
      for (const evidence of finding.evidence.slice(0, 3)) {
        const loc = evidence.file + (evidence.line ? `:${evidence.line}` : '');
        lines.push(`  - \`${loc}\` ${evidence.text || ''}`.trim());
      }
      if (finding.recommendation) {
        lines.push(`  - 💡 ${finding.recommendation}`);
      }
      lines.push('');
    }
  } else {
    lines.push('✅ No drift findings detected.');
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by [ContextLock](https://github.com/contextlock) — reproducible AI project context.*`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CI config
// ---------------------------------------------------------------------------

function ciConfig(root) {
  const configPath = path.join(root, '.contextlock', 'config.json');
  const config = readJsonIfExists(configPath);
  return config?.ci || { fail_on_drift_score: null, fail_on_high_severity: false };
}

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

export function snapshotCiCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const quiet = args.includes('--quiet');

  // Handle shallow clones
  if (!ensureFullHistory(root)) {
    return 1;
  }

  const configPath = path.join(root, '.contextlock', 'config.json');
  if (!existsSync(configPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  const config = readJsonIfExists(configPath);
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  const lock = existsSync(lockPath) ? readJsonIfExists(lockPath) : { version: 1, project_id: config.project_id };

  const snapshot = buildSnapshot(root, config, lock, { generationMode: 'full' });
  writeSnapshotArtifacts(root, snapshot);
  updateLockAfterSnapshot(root, config, lock, snapshot);

  if (!quiet) {
    console.log(`Created CI snapshot ${snapshot.snapshot_hash}`);
    console.log(`Files: ${snapshot.machine_facts.file_count}`);
  }

  // Output just the hash for scripting
  console.log(snapshot.snapshot_hash);
  return 0;
}

export function auditPrCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  if (!existsSync(configPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  const quiet = args.includes('--quiet');
  const ci = detectCiEnv();
  const failThreshold = ciConfig(root).fail_on_drift_score || null;
  const strictMode = args.includes('--strict');

  // Ensure we have full history
  if (!ensureFullHistory(root)) {
    return 1;
  }

  // Determine base branch
  const fromIndex = args.indexOf('--base');
  const baseRef = fromIndex !== -1 ? args[fromIndex + 1] : ci.baseRef || 'main';

  // Ensure we have a lockfile
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  const lock = existsSync(lockPath) ? readJsonIfExists(lockPath) : {
    version: 1,
    project_id: readJsonIfExists(configPath)?.project_id || getProjectId(root)
  };

  // Try to snapshot the base branch
  if (!quiet) console.log(`Snapshotting base branch: ${baseRef}...`);
  const baseHash = snapshotBaseBranch(root, baseRef);

  // Get current (PR) snapshot — it should already exist from `ctx snapshot --ci`
  const prSnapshots = listSnapshotArtifacts(root);
  const prHash = lock.latest_snapshot_hash || (prSnapshots.length > 0 ? prSnapshots[0].hash : null);

  if (!prHash) {
    // Generate PR snapshot if not present
    if (!quiet) console.log('No PR snapshot found, generating one...');
    const config = readJsonIfExists(configPath);
    const snapshot = buildSnapshot(root, config, lock, { generationMode: 'full' });
    writeSnapshotArtifacts(root, snapshot);
    updateLockAfterSnapshot(root, config, lock, snapshot);
    const newLock = readJsonIfExists(lockPath);
    const prSnap = newLock?.latest_snapshot_hash || snapshot.snapshot_hash;
    return runAuditAndReport(root, lock, baseHash, prSnap, failThreshold, strictMode, quiet);
  }

  return runAuditAndReport(root, lock, baseHash, prHash, failThreshold, strictMode, quiet);
}

function runAuditAndReport(root, lock, baseHash, prHash, failThreshold, strictMode, quiet) {
  if (!baseHash) {
    printError('could not snapshot base branch', {
      reason: 'No baseline snapshot could be created from the configured base branch.',
      recovery: 'Ensure fetch-depth: 0 and the base branch are available in CI.',
      command: 'ctx snapshot --ci'
    });
    // Fall back to comparing against oldest available snapshot
    const snapshots = listSnapshotArtifacts(root);
    if (snapshots.length >= 2) {
      baseHash = snapshots[snapshots.length - 1].hash;
      if (!quiet) console.log(`Falling back to oldest snapshot: ${baseHash}`);
    } else {
      // Can't compare — generate a minimal audit
      printError('No baseline snapshot available for comparison', {
        reason: 'PR audit needs at least two snapshots or a base branch snapshot.',
        recovery: 'Run ctx snapshot --ci on the base branch or provide full Git history.',
        command: 'ctx snapshot --ci'
      });
      return 1;
    }
  }

  const fromSnapshot = loadSnapshotArtifact(root, baseHash);
  const toSnapshot = loadSnapshotArtifact(root, prHash);

  if (!fromSnapshot || !toSnapshot) {
    printError('missing snapshot artifacts for PR audit', {
      reason: 'The selected base or PR snapshot artifact could not be loaded.',
      recovery: 'Regenerate CI snapshots and rerun the PR audit.',
      command: 'ctx snapshot --ci && ctx audit --pr'
    });
    return 1;
  }

  const config = readJsonIfExists(path.join(root, '.contextlock', 'config.json')) || {};
  const findings = buildAuditFindings(root, fromSnapshot, toSnapshot, config);
  const { final_drift_score, score_breakdown } = scoreAudit(findings);

  const audit = {
    schema_version: 1,
    artifact_type: 'audit',
    audit_id: `audit_${crypto.hash('sha256', `${baseHash}:${prHash}`, 'hex').slice(0, 16)}`,
    project_id: lock.project_id,
    from_snapshot: baseHash,
    to_snapshot: prHash,
    from_commit: fromSnapshot.git.commit,
    to_commit: toSnapshot.git.commit,
    created_at: new Date().toISOString(),
    scoring_version: 1,
    final_drift_score,
    score_breakdown,
    findings,
    stale_prompts: findings.filter((f) => f.category === 'prompt_drift').map(() => 'onboarding')
  };

  writeAuditArtifacts(root, audit);

  // Generate and output PR report
  const report = renderPrReport(audit, fromSnapshot, toSnapshot, failThreshold);
  console.log(report);

  // Write report to file for CI systems to pick up
  const reportPath = path.join(root, '.contextlock', 'audits', 'pr-report.md');
  writeFileSync(reportPath, report + '\n');
  if (!quiet) console.log(`PR report written to .contextlock/audits/pr-report.md`);

  // Determine exit code based on threshold
  if (strictMode && failThreshold && final_drift_score >= failThreshold) {
    printError(`drift score ${final_drift_score} exceeds threshold ${failThreshold}`, {
      reason: 'Strict CI mode is enabled and the audit score crossed the configured gate.',
      recovery: 'Resolve high-impact findings or raise the threshold intentionally.',
      command: 'ctx audit --pr'
    });
    return 1;
  }

  return 0;
}
