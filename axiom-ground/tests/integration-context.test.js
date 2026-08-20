import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const CLI = path.resolve('src/cli/main.js');

function runCtx(args, cwd) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-integration-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'ContextLock Test'], dir);
  runGit(['config', 'user.email', 'contextlock@example.com'], dir);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'ground-fixture',
    scripts: { test: 'node --test', build: 'echo build' },
    dependencies: { zod: '^3.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Ground fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'src', 'main.js'), 'export function main() { return true; }\n');
  runGit(['add', '-A'], dir);
  runGit(['commit', '-m', 'initial'], dir);
  return dir;
}

test('ctx context export emits curated GroundContext v1', () => {
  const repo = makeRepo();
  try {
    const bootstrap = runCtx(['bootstrap', '--no-open', '--quiet'], repo);
    assert.equal(bootstrap.status, 0, bootstrap.stderr || bootstrap.stdout);
    const index = runCtx(['code', 'index', '--quiet'], repo);
    assert.equal(index.status, 0, index.stderr || index.stdout);

    const first = runCtx(['context', 'export', '--format', 'json'], repo);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const context = JSON.parse(first.stdout);
    assert.equal(context.schema_version, 'ground.context.v1');
    assert.ok(context.project.project_id);
    assert.match(context.snapshot.snapshot_hash, /^ctxsnap_/);
    assert.equal(context.prompt_pack.available, true);
    assert.equal(context.prompt_pack.snapshot_hash, context.snapshot.snapshot_hash);
    assert.equal(context.code_index.available, true);
    assert.ok(Array.isArray(context.memory.entries));
    assert.equal(context.security.secret_scan_passed, true);
    assert.equal(Object.hasOwn(context, 'config'), false);
    assert.equal(Object.hasOwn(context, 'lock'), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('GroundContext export remains stable for identical artifacts', () => {
  const repo = makeRepo();
  try {
    const bootstrap = runCtx(['bootstrap', '--no-open', '--quiet'], repo);
    assert.equal(bootstrap.status, 0, bootstrap.stderr || bootstrap.stdout);
    const a = JSON.parse(runCtx(['context', 'export', '--format', 'json'], repo).stdout);
    const b = JSON.parse(runCtx(['context', 'export', '--format', 'json'], repo).stdout);
    assert.deepEqual(a, b);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('GroundContext export fails without a current snapshot', () => {
  const repo = makeRepo();
  try {
    const init = runCtx(['init', '--yes'], repo);
    assert.equal(init.status, 0, init.stderr || init.stdout);
    const result = runCtx(['context', 'export', '--format', 'json'], repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No latest snapshot/i);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// Keep the fixture's artifact path assertion explicit so a future export cannot
// accidentally become a raw .contextlock file dump.
test('GroundContext export is backed by the expected artifact tree', () => {
  const repo = makeRepo();
  try {
    const bootstrap = runCtx(['bootstrap', '--no-open', '--quiet'], repo);
    assert.equal(bootstrap.status, 0, bootstrap.stderr || bootstrap.stdout);
    const lock = JSON.parse(readFileSync(path.join(repo, '.contextlock', 'lock.json'), 'utf8'));
    assert.ok(existsSync(path.join(repo, '.contextlock', 'snapshots', `${lock.latest_snapshot_hash}.json`)));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
