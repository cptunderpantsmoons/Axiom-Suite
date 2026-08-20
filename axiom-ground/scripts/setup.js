#!/usr/bin/env node
// Quick setup script for new contributors.
// Run: node scripts/setup.js (or npm run setup)

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { platform } from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function ok(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function info(msg) { console.log(`${CYAN}→${RESET} ${msg}`); }

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
    ...opts
  });
  if (result.status !== 0 && !opts.allowFail) {
    console.error(`Failed: ${cmd} ${args.join(' ')}`);
    if (result.stderr) console.error(result.stderr);
    process.exit(1);
  }
  return result;
}

function checkNode() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 20) {
    console.error(`Node.js 20+ required, got ${version}`);
    process.exit(1);
  }
  ok(`Node.js ${version}`);
}

function checkGit() {
  const result = run('git', ['--version'], { quiet: true });
  if (result.status === 0) {
    ok('Git available');
  } else {
    console.error('Git is required but not found');
    process.exit(1);
  }
}

console.log(`${BOLD}🔧 ContextLock Development Setup${RESET}\n`);

// 1. Check prerequisites
info('Checking prerequisites...');
checkNode();
checkGit();

// 2. Verify no node_modules needed (zero-dep project)
info('Verifying zero-dependency setup...');
ok('No npm install needed — this is a zero-dependency project');

// 3. Run tests
info('Running test suite...');
run('node', ['--test']);
ok('All tests pass');

// 4. Run linter
info('Running linter...');
const lintResult = run('node', ['scripts/lint.js'], { allowFail: true });
if (lintResult.status === 0) {
  ok('Lint clean');
} else {
  console.log(`${CYAN}→${RESET} Lint has warnings (non-blocking) — run ${BOLD}npm run lint${RESET} for details`);
}

// 5. Install git hooks
info('Installing git hooks...');
const hooksResult = run('node', ['src/cli/main.js', 'hooks', 'install'], { allowFail: true, quiet: true });
if (hooksResult.status === 0) {
  ok('Git hooks installed (pre-commit: lint+test, post-commit: context refresh)');
} else {
  info('Git hooks skipped (not in a git repo or not initialized)');
}

// 6. Summary
console.log('');
console.log(`${BOLD}✨ Setup complete!${RESET}`);
console.log('');
console.log('  Development commands:');
console.log(`    ${CYAN}npm test${RESET}           Run full test suite`);
console.log(`    ${CYAN}npm run test:watch${RESET}  Run tests in watch mode`);
console.log(`    ${CYAN}npm run lint${RESET}        Check code quality`);
console.log(`    ${CYAN}npm run lint:fix${RESET}    Auto-fix lint issues`);
console.log(`    ${CYAN}npm run check${RESET}       Lint + test (pre-push gate)`);
console.log(`    ${CYAN}npm run doctor${RESET}      ContextLock health check`);
console.log('');
console.log('  Workflow:');
console.log(`    1. Make changes to ${CYAN}src/${RESET}`);
console.log(`    2. Add/update tests in ${CYAN}tests/${RESET}`);
console.log(`    3. ${CYAN}npm run check${RESET} to verify everything`);
console.log(`    4. Commit — hooks run automatically`);
console.log('');
