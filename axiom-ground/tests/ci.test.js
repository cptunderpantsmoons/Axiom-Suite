import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const CLI = path.resolve('src/cli/main.js');

function runCtx(args, cwd, extraEnv = {}) {
  return spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-ci-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'ci-fixture',
    scripts: { test: 'node --test', build: 'node build.js' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# CI Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'main.js'), 'console.log("hello")\n');
  writeFileSync(path.join(dir, 'tests.spec.js'), 'test("ok", () => {});\n');
  runGit(['add', '.'], dir);
  runGit(['commit', '-m', 'initial'], dir);
  return dir;
}

test('ctx snapshot --ci works and handles non-shallow repos', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const result = runCtx(['snapshot', '--ci', '--quiet'], repo);
  assert.equal(result.status, 0, result.stderr);

  const hash = result.stdout.trim();
  assert.match(hash, /^ctxsnap_/);
  assert.ok(existsSync(path.join(repo, '.contextlock', 'snapshots', `${hash}.json`)));
});

test('ctx audit --pr generates markdown report with drift score', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  // Make a change on a feature branch
  runGit(['checkout', '-b', 'feature'], repo);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("feature change")\n');
  runGit(['add', 'main.js'], repo);
  runGit(['commit', '-m', 'feature change'], repo);
  runCtx(['snapshot'], repo);

  // Simulate PR audit (comparing feature to main)
  const result = runCtx(['audit', '--pr', '--base', 'main'], repo);
  assert.equal(result.status, 0, result.stderr);

  const report = result.stdout;
  assert.match(report, /ContextLock Audit Report/);
  assert.match(report, /Drift score/);
  assert.match(report, /Findings/);
  assert.match(report, /Verdict/);

  // Check that the report file was written
  const reportPath = path.join(repo, '.contextlock', 'audits', 'pr-report.md');
  assert.ok(existsSync(reportPath));
  const savedReport = readFileSync(reportPath, 'utf8');
  assert.match(savedReport, /ContextLock Audit Report/);
});

test('ctx audit --pr with --strict fails when threshold exceeded', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  // Make a breaking change
  runGit(['checkout', '-b', 'breaking'], repo);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("completely rewritten")\n');
  // Remove tests
  try { unlinkSync(path.join(repo, 'tests.spec.js')); } catch {}
  runGit(['add', '-A'], repo);
  runGit(['commit', '-m', 'breaking change'], repo);
  runCtx(['snapshot'], repo);

  // Set a very low threshold
  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.ci = { fail_on_drift_score: 1 };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const result = runCtx(['audit', '--pr', '--base', 'main', '--strict'], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds threshold/);
});

test('ctx audit --pr without --strict succeeds despite high drift', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  // Make a change
  runGit(['checkout', '-b', 'no-strict'], repo);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("change without tests")\n');
  runGit(['add', 'main.js'], repo);
  runGit(['commit', '-m', 'change'], repo);
  runCtx(['snapshot'], repo);

  // Set a low threshold but don't use --strict
  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.ci = { fail_on_drift_score: 0 };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Without --strict, should still exit 0 (even with high drift)
  const result = runCtx(['audit', '--pr', '--base', 'main'], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ContextLock Audit Report/);
});

test('ctx audit --pr handles missing base gracefully', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  // Request audit with a nonexistent base branch
  const result = runCtx(['audit', '--pr', '--base', 'nonexistent-branch'], repo);
  // Should still exit non-zero since it can't find the base
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not snapshot base branch/);
});
