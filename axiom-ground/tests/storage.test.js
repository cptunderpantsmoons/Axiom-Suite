import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function runGit(args, cwd, extraEnv = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-storage-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'storage-fixture',
    scripts: { test: 'node --test', build: 'node build.js' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Storage Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'main.js'), 'console.log("hello")\n');
  writeFileSync(path.join(dir, 'tests.spec.js'), 'test("ok", () => {});\n');
  return dir;
}

function configureLocalRemote(repo) {
  const config = readJson(path.join(repo, '.contextlock', 'config.json'));
  config.remote = { provider: 'local', repo: 'test-remote', token_env: 'NONE' };
  writeFileSync(path.join(repo, '.contextlock', 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

test('ctx remote add hf stores huggingface remote config', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  const result = runCtx(['remote', 'add', 'hf', 'test-user/test-repo'], repo);
  assert.equal(result.status, 0, result.stderr);

  const config = readJson(path.join(repo, '.contextlock', 'config.json'));
  assert.equal(config.remote.provider, 'huggingface');
  assert.equal(config.remote.repo, 'test-user/test-repo');
  assert.equal(config.remote.repo_type, 'dataset');
  assert.equal(config.remote.token_env, 'HF_TOKEN');
});

test('ctx sync with mocked Hugging Face backend uploads artifacts', () => {
  const repo = makeRepo();
  const mockDir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-hf-mock-'));
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['prompt', 'onboarding'], repo);
  runCtx(['remote', 'add', 'hf', 'test-user/test-repo'], repo);

  const result = runCtx(['sync'], repo, { CONTEXTLOCK_HF_MOCK_DIR: mockDir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sync complete/);
  assert.ok(existsSync(path.join(mockDir, 'lock', 'latest.json')));
  assert.ok(existsSync(path.join(mockDir, 'snapshots')));
  assert.ok(existsSync(path.join(mockDir, 'prompts')));
});

test('ctx sync refuses to overwrite different remote content at same hash path', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  configureLocalRemote(repo);

  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const cacheSnapshot = path.join(repo, '.contextlock', 'remote-cache', 'snapshots', `${lock.latest_snapshot_hash}.json`);
  mkdirSync(path.dirname(cacheSnapshot), { recursive: true });
  writeFileSync(cacheSnapshot, '{"different":true}\n');

  const result = runCtx(['sync'], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /remote hash mismatch/);
});

test('ctx sync with local backend uploads artifacts and is idempotent', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['prompt', 'onboarding'], repo);
  configureLocalRemote(repo);

  const first = runCtx(['sync'], repo);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Uploaded:/);
  assert.match(first.stdout, /Sync complete/);

  const second = runCtx(['sync'], repo);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Skipped \(already synced\)/);

  const cacheDir = path.join(repo, '.contextlock', 'remote-cache');
  assert.ok(existsSync(path.join(cacheDir, 'lock', 'latest.json')));
  assert.ok(existsSync(path.join(cacheDir, 'snapshots')));
  assert.ok(existsSync(path.join(cacheDir, 'prompts')));
});

test('ctx pull restores artifacts from remote cache', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['prompt', 'onboarding'], repo);
  configureLocalRemote(repo);

  // Sync to populate remote cache
  runCtx(['sync', '--quiet'], repo);

  // Delete local artifacts
  for (const name of ['snapshots', 'prompts']) {
    const dir = path.join(repo, '.contextlock', name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const pull = runCtx(['pull'], repo);
  assert.equal(pull.status, 0, pull.stderr);
  assert.match(pull.stdout, /Downloaded:/);
  assert.match(pull.stdout, /Pulled \d+ artifacts/);

  // Verify artifacts restored
  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  assert.ok(lock.latest_snapshot_hash);
  assert.ok(existsSync(path.join(repo, '.contextlock', 'snapshots')));
});

test('ctx sync blocks artifacts containing synthetic secrets before upload', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  configureLocalRemote(repo);
  writeFileSync(path.join(repo, '.contextlock', 'snapshots', 'leaky.json'), '{"token":"hf_1234567890abcdefghijklmnopqrstuv"}\n');

  const result = runCtx(['sync'], repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Secret scan failed/);
  assert.match(result.stderr, /leaky\.json/);
  assert.doesNotMatch(result.stderr, /hf_1234567890abcdefghijklmnopqrstuv/);
});

test('ctx sync fails with clear message when no remote configured', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const result = runCtx(['sync'], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no remote configured/);
});

test('ctx pull --snapshot fetches a specific snapshot', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['prompt', 'onboarding'], repo);

  writeFileSync(path.join(repo, 'main.js'), 'console.log("changed")\n');
  runCtx(['snapshot'], repo);
  configureLocalRemote(repo);
  runCtx(['sync', '--quiet'], repo);

  // Delete all snapshots locally
  const snapDir = path.join(repo, '.contextlock', 'snapshots');
  if (existsSync(snapDir)) {
    rmSync(snapDir, { recursive: true, force: true });
  }

  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const pull = runCtx(['pull', '--snapshot', lock.latest_snapshot_hash], repo);
  assert.equal(pull.status, 0, pull.stderr);
  assert.ok(existsSync(path.join(repo, '.contextlock', 'snapshots', `${lock.latest_snapshot_hash}.json`)));
});

test('ctx sync --dry-run shows what would be uploaded without writing', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  configureLocalRemote(repo);

  const dry = runCtx(['sync', '--dry-run'], repo);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Uploaded:/);

  // Remote cache should NOT be populated
  const cacheDir = path.join(repo, '.contextlock', 'remote-cache');
  assert.ok(!existsSync(cacheDir));
});
