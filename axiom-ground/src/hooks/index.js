import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, resolveGitRoot, fail } from '../utils/core.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function automationLogPath(root) {
  return path.join(root, '.contextlock', 'logs', 'automation.log');
}

function appendAutomationLog(root, message) {
  ensureDir(path.dirname(automationLogPath(root)));
  writeFileSync(automationLogPath(root), `${new Date().toISOString()} ${message}\n`, { flag: 'a' });
}

function hooksDir(root) {
  return path.join(root, '.contextlock', 'hooks');
}

function managedPostCommitHookPath(root) {
  return path.join(path.join(root, '.git', 'hooks'), 'post-commit');
}

function managedPostCommitBackupPath(root) {
  return path.join(hooksDir(root), 'post-commit.original');
}

function managedPreCommitHookPath(root) {
  return path.join(path.join(root, '.git', 'hooks'), 'pre-commit');
}

function managedPreCommitBackupPath(root) {
  return path.join(hooksDir(root), 'pre-commit.original');
}

// ---------------------------------------------------------------------------
// Pre-commit hook script
// ---------------------------------------------------------------------------

function buildPreCommitHookScript() {
  return `#!/bin/sh
# Managed by ContextLock — do not edit manually.
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi
HOOK_BACKUP="$REPO_ROOT/.contextlock/hooks/pre-commit.original"
LOG_FILE="$REPO_ROOT/.contextlock/logs/automation.log"

log_line() {
  printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE"
}

# Run original hook if it exists
if [ -f "$HOOK_BACKUP" ]; then
  sh "$HOOK_BACKUP" "$@" >> "$LOG_FILE" 2>&1
fi

# Run linter (only if lint script exists)
if [ -f "$REPO_ROOT/scripts/lint.js" ]; then
  log_line "pre-commit:start:lint"
  node "$REPO_ROOT/scripts/lint.js" >> "$LOG_FILE" 2>&1
  LINT_STATUS=$?
  log_line "pre-commit:done:lint:$LINT_STATUS"
  if [ $LINT_STATUS -ne 0 ]; then
    echo "ContextLock: lint check failed. Fix errors or run 'npm run lint:fix' and re-stage."
    exit 1
  fi
fi

# Run tests (only if tests directory exists)
if [ -d "$REPO_ROOT/tests" ]; then
  log_line "pre-commit:start:test"
  node --test >> "$LOG_FILE" 2>&1
  TEST_STATUS=$?
  log_line "pre-commit:done:test:$TEST_STATUS"
  if [ $TEST_STATUS -ne 0 ]; then
    echo "ContextLock: tests failed. Fix failing tests before committing."
    exit 1
  fi
fi

exit 0
`;
}

// ---------------------------------------------------------------------------
// Post-commit hook script
// ---------------------------------------------------------------------------

function buildPostCommitHookScript() {
  return `#!/bin/sh
# Managed by ContextLock — do not edit manually.
set +e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi
HOOK_BACKUP="$REPO_ROOT/.contextlock/hooks/post-commit.original"
LOG_FILE="$REPO_ROOT/.contextlock/logs/automation.log"
CTXLOCK_BIN="\${CTXLOCK_BIN:-ctx}"

log_line() {
  printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE"
}

run_step() {
  STEP_NAME="$1"
  shift
  log_line "post-commit:start:$STEP_NAME"
  "$@" >> "$LOG_FILE" 2>&1
  STATUS=$?
  log_line "post-commit:done:$STEP_NAME:$STATUS"
  return 0
}

if [ -f "$HOOK_BACKUP" ]; then
  sh "$HOOK_BACKUP" "$@" >> "$LOG_FILE" 2>&1 || true
fi

run_step snapshot "$CTXLOCK_BIN" snapshot --incremental --quiet
run_step audit "$CTXLOCK_BIN" audit --since-last --quiet
run_step prompt "$CTXLOCK_BIN" prompt refresh --changed --quiet
run_step site "$CTXLOCK_BIN" site build --quiet
run_step sync "$CTXLOCK_BIN" sync --quiet
exit 0
`;
}

// ---------------------------------------------------------------------------
// Install / uninstall
// ---------------------------------------------------------------------------

export function installHooksCommand(cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  if (!existsSync(configPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  ensureDir(hooksDir(root));
  ensureDir(path.dirname(automationLogPath(root)));

  const managedMarker = 'Managed by ContextLock';
  let installed = [];

  // Install pre-commit hook (lint + test gate)
  const prePath = managedPreCommitHookPath(root);
  const preBackup = managedPreCommitBackupPath(root);
  const preExisting = existsSync(prePath) ? readFileSync(prePath, 'utf8') : '';
  if (preExisting && !preExisting.includes(managedMarker) && !existsSync(preBackup)) {
    writeFileSync(preBackup, preExisting);
  }
  writeFileSync(prePath, buildPreCommitHookScript(), { mode: 0o755 });
  chmodSync(prePath, 0o755);
  installed.push('pre-commit');

  // Install post-commit hook (snapshot → audit → prompt → site → sync)
  const postPath = managedPostCommitHookPath(root);
  const postBackup = managedPostCommitBackupPath(root);
  const postExisting = existsSync(postPath) ? readFileSync(postPath, 'utf8') : '';
  if (postExisting && !postExisting.includes(managedMarker) && !existsSync(postBackup)) {
    writeFileSync(postBackup, postExisting);
  }
  writeFileSync(postPath, buildPostCommitHookScript(), { mode: 0o755 });
  chmodSync(postPath, 0o755);
  installed.push('post-commit');

  appendAutomationLog(root, `hooks:install ${installed.join(', ')}`);
  console.log(`Installed ContextLock hooks: ${installed.join(', ')}`);
  return 0;
}

export function uninstallHooksCommand(cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const managedMarker = 'Managed by ContextLock';
  let removed = [];

  // Uninstall pre-commit
  const prePath = managedPreCommitHookPath(root);
  const preBackup = managedPreCommitBackupPath(root);
  if (existsSync(preBackup)) {
    writeFileSync(prePath, readFileSync(preBackup));
    chmodSync(prePath, 0o755);
    unlinkSync(preBackup);
    removed.push('pre-commit (restored original)');
  } else if (existsSync(prePath) && readFileSync(prePath, 'utf8').includes(managedMarker)) {
    unlinkSync(prePath);
    removed.push('pre-commit');
  }

  // Uninstall post-commit
  const postPath = managedPostCommitHookPath(root);
  const postBackup = managedPostCommitBackupPath(root);
  if (existsSync(postBackup)) {
    writeFileSync(postPath, readFileSync(postBackup));
    chmodSync(postPath, 0o755);
    unlinkSync(postBackup);
    removed.push('post-commit (restored original)');
  } else if (existsSync(postPath) && readFileSync(postPath, 'utf8').includes(managedMarker)) {
    unlinkSync(postPath);
    removed.push('post-commit');
  }

  if (removed.length) {
    appendAutomationLog(root, `hooks:uninstall ${removed.join(', ')}`);
    console.log(`Removed ContextLock hooks: ${removed.join(', ')}`);
  } else {
    console.log('No ContextLock-managed hooks found');
  }
  return 0;
}
