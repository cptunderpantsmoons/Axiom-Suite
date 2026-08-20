import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const CLI = path.resolve('src/cli/main.js');

function runCtx(args, cwd) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-bootstrap-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  mkdirSync(path.join(dir, 'src'), { recursive: true });
  mkdirSync(path.join(dir, 'tests'), { recursive: true });

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'fixture-project',
    scripts: { test: 'node --test', build: 'echo built' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'src', 'main.js'), '// TODO: implement\nconsole.log("hello")\n');
  writeFileSync(path.join(dir, 'tests', 'main.test.js'), 'test("ok", () => {});\n');

  runGit(['add', '-A'], dir);
  runGit(['commit', '-m', 'initial'], dir);
  return dir;
}

// ---------------------------------------------------------------------------
// bootstrap tests
// ---------------------------------------------------------------------------

test('ctx bootstrap creates full context from scratch in one command', () => {
  const dir = makeRepo();
  try {
    const result = runCtx(['bootstrap', '--no-open', '--quiet'], dir);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    // Config exists
    assert.ok(existsSync(path.join(dir, '.contextlock', 'config.json')));
    // Lock exists
    assert.ok(existsSync(path.join(dir, '.contextlock', 'lock.json')));
    // Snapshot exists
    const lock = JSON.parse(readFileSync(path.join(dir, '.contextlock', 'lock.json'), 'utf8'));
    assert.ok(lock.latest_snapshot_hash);
    const snapshotPath = path.join(dir, '.contextlock', 'snapshots', `${lock.latest_snapshot_hash}.json`);
    assert.ok(existsSync(snapshotPath));
    // Prompt exists
    const promptPath = path.join(dir, '.contextlock', 'prompts', lock.latest_snapshot_hash, 'onboarding', 'onboarding.md');
    assert.ok(existsSync(promptPath));
    // Site exists
    assert.ok(existsSync(path.join(dir, '.contextlock', 'site', 'index.html')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx bootstrap prints summary with file count and languages', () => {
  const dir = makeRepo();
  try {
    const result = runCtx(['bootstrap', '--no-open'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Snapshot ctxsnap_/);
    assert.match(result.stdout, /files/);
    assert.match(result.stdout, /javascript/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx bootstrap is idempotent — rerun does not fail', () => {
  const dir = makeRepo();
  try {
    const first = runCtx(['bootstrap', '--no-open', '--quiet'], dir);
    assert.equal(first.status, 0, first.stderr);
    const second = runCtx(['bootstrap', '--no-open', '--quiet'], dir);
    assert.equal(second.status, 0, second.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx bootstrap --force reinitializes config', () => {
  const dir = makeRepo();
  try {
    runCtx(['bootstrap', '--no-open', '--quiet'], dir);
    const configBefore = JSON.parse(readFileSync(path.join(dir, '.contextlock', 'config.json'), 'utf8'));
    const result = runCtx(['bootstrap', '--no-open', '--quiet', '--force'], dir);
    assert.equal(result.status, 0, result.stderr);
    const configAfter = JSON.parse(readFileSync(path.join(dir, '.contextlock', 'config.json'), 'utf8'));
    // Config should still be valid
    assert.equal(configAfter.project_name, configBefore.project_name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// doctor tests
// ---------------------------------------------------------------------------

test('ctx doctor reports uninitialized project', () => {
  const dir = makeRepo();
  try {
    const result = runCtx(['doctor'], dir);
    assert.equal(result.status, 1, result.stderr); // exits 1 because not initialized
    assert.match(result.stdout, /ContextLock.*not initialized/);
    assert.match(result.stdout, /ctx bootstrap/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx doctor reports healthy after bootstrap', () => {
  const dir = makeRepo();
  try {
    runCtx(['bootstrap', '--no-open', '--quiet'], dir);
    const result = runCtx(['doctor'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Snapshot.*ctxsnap_/);
    assert.match(result.stdout, /Onboarding prompt.*fresh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx doctor --json outputs valid JSON with check details', () => {
  const dir = makeRepo();
  try {
    runCtx(['bootstrap', '--no-open', '--quiet'], dir);
    const result = runCtx(['doctor', '--json'], dir);
    assert.equal(result.status, 0, result.stderr);

    const data = JSON.parse(result.stdout);
    assert.ok(data.project);
    assert.ok(Array.isArray(data.checks));
    assert.ok(data.checks.length >= 3);
    assert.ok(data.checks.every(c => c.label && c.status && c.detail));
    assert.equal(data.initialized, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx doctor detects stale prompt after new snapshot', () => {
  const dir = makeRepo();
  try {
    runCtx(['bootstrap', '--no-open', '--quiet'], dir);

    // Make a change and re-snapshot (without refreshing prompt)
    writeFileSync(path.join(dir, 'src', 'main.js'), '// new code\nconsole.log("updated")\n');
    runGit(['add', '-A'], dir);
    runGit(['commit', '-m', 'update main'], dir);
    runCtx(['snapshot', '--quiet'], dir);

    const result = runCtx(['doctor'], dir);
    assert.match(result.stdout, /stale/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx doctor fails outside a git repo', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
  try {
    const result = runCtx(['doctor'], dir);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx bootstrap fails outside a git repo', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
  try {
    const result = runCtx(['bootstrap'], dir);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
