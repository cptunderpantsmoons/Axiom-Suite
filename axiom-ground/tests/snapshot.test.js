import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const CLI = path.resolve('src/cli/main.js');

function runCtx(args, cwd) {
  return spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo(kind = 'basic') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-snapshot-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  if (kind === 'basic' || kind === 'node_modules' || kind === 'dirty') {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: kind,
      scripts: { test: 'node --test', build: 'node build.js' },
      dependencies: { leftpad: '^1.0.0' }
    }, null, 2) + '\n');
    writeFileSync(path.join(dir, 'README.md'), '# Fixture\n\nRun `npm test`.\n');
    writeFileSync(path.join(dir, 'main.js'), '// TODO: implement\nconsole.log("hello")\n');
    writeFileSync(path.join(dir, 'tests.spec.js'), 'test("ok", () => {});\n');
  }

  if (kind === 'node_modules') {
    mkdirSync(path.join(dir, 'node_modules', 'ignored'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'ignored', 'junk.txt'), 'should not be scanned\n');
  }

  if (kind === 'dirty') {
    writeFileSync(path.join(dir, 'main.js'), '// TODO: dirty base\nconsole.log("base")\n');
  }

  if (kind === 'basic') {
    writeFileSync(path.join(dir, 'notes.md'), 'General notes\n');
  }

  if (kind === 'python') {
    writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "python-fixture"\nversion = "0.0.0"\n');
    writeFileSync(path.join(dir, 'app.py'), '# TODO: implement\nprint("hi")\n');
    writeFileSync(path.join(dir, 'README.md'), '# Python\n\nRun `pytest`.\n');
  }

  if (kind === 'go') {
    writeFileSync(path.join(dir, 'go.mod'), 'module example.com/contextlockfixture\n\ngo 1.22\n');
    writeFileSync(path.join(dir, 'main.go'), 'package main\n\nfunc main() {}\n');
    writeFileSync(path.join(dir, 'README.md'), '# Go\n');
  }

  if (kind === 'rust') {
    writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "rust-fixture"\nversion = "0.1.0"\nedition = "2021"\n');
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main.rs'), 'fn main() {}\n');
    writeFileSync(path.join(dir, 'README.md'), '# Rust\n');
  }

  commitAll(dir);
  return dir;
}

function initRepo(repo) {
  const init = runCtx(['init', '--yes'], repo);
  assert.equal(init.status, 0, init.stderr);
}

function commitAll(repo, message = 'initial commit') {
  runGit(['add', '.'], repo);
  runGit(['commit', '-m', message], repo);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function snapshotPath(repo, hash) {
  return path.join(repo, '.contextlock', 'snapshots', `${hash}.json`);
}

test('ctx snapshot creates json/md artifacts and updates lockfile', () => {
  const repo = makeRepo('basic');
  initRepo(repo);

  const result = runCtx(['snapshot'], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created snapshot ctxsnap_/);

  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const snapshot = readJson(snapshotPath(repo, lock.latest_snapshot_hash));
  const md = readFileSync(path.join(repo, '.contextlock', 'snapshots', `${lock.latest_snapshot_hash}.md`), 'utf8');

  assert.equal(snapshot.schema_version, 1);
  assert.equal(snapshot.artifact_type, 'snapshot');
  assert.equal(snapshot.snapshot_hash, lock.latest_snapshot_hash);
  assert.equal(snapshot.git.branch, 'main');
  assert.equal(snapshot.git.dirty, false);
  assert.ok(snapshot.machine_facts.manifests.includes('package.json'));
  assert.ok(snapshot.machine_facts.docs_files.includes('README.md'));
  assert.ok(snapshot.machine_facts.dependencies.includes('leftpad'));
  assert.ok(snapshot.machine_facts.test_commands.includes('node --test'));
  assert.ok(snapshot.machine_facts.build_commands.includes('node build.js'));
  assert.ok(snapshot.machine_facts.entrypoints.includes('main.js'));
  assert.ok(snapshot.debt_markers.some((item) => item.marker === 'TODO'));
  assert.match(md, /# ContextLock Snapshot/);
  assert.match(md, /## Project summary/);
  assert.match(md, /## Known facts/);
  assert.match(md, /## Files to read first/);
  assert.match(md, /## Recent git context/);
  assert.match(md, /## Do not assume/);
  assert.match(md, new RegExp(lock.latest_snapshot_hash));
  assert.match(md, /Source commit:/);
  assert.equal(md.length < 64 * 1024, true);
});

test('ctx snapshot excludes node_modules and keeps hash stable across reruns', () => {
  const repo = makeRepo('node_modules');
  initRepo(repo);
  writeFileSync(path.join(repo, 'node_modules', 'ignored', 'junk.txt'), 'should not be scanned\n');

  const first = runCtx(['snapshot'], repo);
  assert.equal(first.status, 0, first.stderr);
  const firstLock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const firstSnapshot = readJson(snapshotPath(repo, firstLock.latest_snapshot_hash));

  assert.ok(!Object.keys(firstSnapshot.content_fingerprints).some((file) => file.startsWith('node_modules/')));
  assert.ok(firstSnapshot.machine_facts.file_count < 10);

  const second = runCtx(['snapshot'], repo);
  assert.equal(second.status, 0, second.stderr);
  const secondLock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  assert.equal(secondLock.latest_snapshot_hash, firstLock.latest_snapshot_hash);
});

test('ctx snapshot artifact is stable across unchanged reruns', () => {
  const repo = makeRepo('basic');
  initRepo(repo);

  const first = runCtx(['snapshot'], repo);
  assert.equal(first.status, 0, first.stderr);
  const firstLock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const artifactPath = snapshotPath(repo, firstLock.latest_snapshot_hash);
  const firstArtifact = readFileSync(artifactPath, 'utf8');
  const firstLockArtifact = readFileSync(path.join(repo, '.contextlock', 'lock.json'), 'utf8');

  const second = runCtx(['snapshot'], repo);
  assert.equal(second.status, 0, second.stderr);
  const secondLock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const secondArtifact = readFileSync(snapshotPath(repo, secondLock.latest_snapshot_hash), 'utf8');
  const secondLockArtifact = readFileSync(path.join(repo, '.contextlock', 'lock.json'), 'utf8');

  assert.equal(secondLock.latest_snapshot_hash, firstLock.latest_snapshot_hash);
  assert.equal(secondArtifact, firstArtifact);
  assert.equal(secondLockArtifact, firstLockArtifact);
});

test('ctx snapshot --incremental uses cache metadata and matches full hash', () => {
  const repo = makeRepo('basic');
  initRepo(repo);

  const first = runCtx(['snapshot'], repo);
  assert.equal(first.status, 0, first.stderr);
  const firstLock = readJson(path.join(repo, '.contextlock', 'lock.json'));

  writeFileSync(path.join(repo, 'main.js'), '// TODO: incremental edit\nconsole.log("incremental")\n');
  const incremental = runCtx(['snapshot', '--incremental'], repo);
  assert.equal(incremental.status, 0, incremental.stderr);
  const incLock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const incSnapshot = readJson(snapshotPath(repo, incLock.latest_snapshot_hash));

  assert.equal(incSnapshot.generation_mode, 'incremental');
  assert.equal(incSnapshot.incremental_base_snapshot_hash, firstLock.latest_snapshot_hash);
  assert.equal(incSnapshot.fallback_to_full, false);
  assert.ok(incSnapshot.volatile_state.incremental.reused_fingerprints > 0);
  assert.ok(incSnapshot.volatile_state.incremental.recomputed_fingerprints > 0);

  const full = runCtx(['snapshot', '--full'], repo);
  assert.equal(full.status, 0, full.stderr);
  const fullLock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  assert.equal(fullLock.latest_snapshot_hash, incLock.latest_snapshot_hash);
});

test('ctx snapshot --incremental falls back to full when config changes', () => {
  const repo = makeRepo('basic');
  initRepo(repo);

  const first = runCtx(['snapshot'], repo);
  assert.equal(first.status, 0, first.stderr);
  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.exclude.push('ignored/**');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const incremental = runCtx(['snapshot', '--incremental'], repo);
  assert.equal(incremental.status, 0, incremental.stderr);
  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const snapshot = readJson(snapshotPath(repo, lock.latest_snapshot_hash));

  assert.equal(snapshot.generation_mode, 'full');
  assert.equal(snapshot.fallback_to_full, true);
  assert.match(snapshot.fallback_reason, /config/);
});

test('ctx snapshot redacts embedded secret-looking values in extracted debt text', () => {
  const repo = makeRepo('basic');
  initRepo(repo);
  writeFileSync(path.join(repo, 'main.js'), '// TODO: rotate token ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD\nconsole.log("safe")\n');

  const result = runCtx(['snapshot'], repo);
  assert.equal(result.status, 0, result.stderr);
  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const snapshot = readJson(snapshotPath(repo, lock.latest_snapshot_hash));
  const serialized = readFileSync(snapshotPath(repo, lock.latest_snapshot_hash), 'utf8');

  assert.ok(snapshot.security.redaction_count >= 1);
  assert.ok(Number.isInteger(snapshot.security.redaction_count));
  assert.ok(Number.isInteger(snapshot.security.sensitive_paths_skipped));
  assert.ok(snapshot.security.sensitive_paths_skipped >= 0);
  assert.ok(snapshot.debt_markers.some((item) => item.text.includes('[REDACTED]')));
  assert.doesNotMatch(serialized, /ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD/);
});

test('ctx snapshot counts sensitive (.env/.pem) paths as skipped in security metadata', () => {
  const repo = makeRepo('basic');
  initRepo(repo);
  writeFileSync(path.join(repo, '.env'), 'SECRET=do-not-scan\n');
  writeFileSync(path.join(repo, 'key.pem'), '-----BEGIN PRIVATE KEY-----\nMII=\n-----END PRIVATE KEY-----\n');

  const result = runCtx(['snapshot'], repo);
  assert.equal(result.status, 0, result.stderr);
  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const snapshot = readJson(snapshotPath(repo, lock.latest_snapshot_hash));

  assert.ok(Number.isInteger(snapshot.security.sensitive_paths_skipped));
  assert.ok(snapshot.security.sensitive_paths_skipped >= 1);
});

test('ctx snapshot hash changes when a meaningful source file changes', () => {
  const repo = makeRepo('basic');
  initRepo(repo);

  const first = runCtx(['snapshot'], repo);
  assert.equal(first.status, 0, first.stderr);
  const firstLock = readJson(path.join(repo, '.contextlock', 'lock.json'));

  writeFileSync(path.join(repo, 'main.js'), '// TODO: changed\nconsole.log("changed")\n');
  const second = runCtx(['snapshot'], repo);
  assert.equal(second.status, 0, second.stderr);
  const secondLock = readJson(path.join(repo, '.contextlock', 'lock.json'));

  assert.notEqual(secondLock.latest_snapshot_hash, firstLock.latest_snapshot_hash);
});

test('ctx snapshot reports dirty working tree and json output is parseable', () => {
  const repo = makeRepo('dirty');
  initRepo(repo);
  runCtx(['snapshot'], repo);

  writeFileSync(path.join(repo, 'main.js'), '// TODO: dirty change\nconsole.log("dirty")\n');
  const jsonResult = runCtx(['snapshot', '--json'], repo);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  const snapshot = JSON.parse(jsonResult.stdout);
  assert.equal(snapshot.git.dirty, true);
  assert.equal(snapshot.artifact_type, 'snapshot');
  assert.equal(snapshot.schema_version, 1);
});

test('ctx snapshot handles python manifests and TODO extraction', () => {
  const repo = makeRepo('python');
  initRepo(repo);

  const result = runCtx(['snapshot'], repo);
  assert.equal(result.status, 0, result.stderr);
  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const snapshot = readJson(snapshotPath(repo, lock.latest_snapshot_hash));

  assert.ok(snapshot.machine_facts.languages.includes('python'));
  assert.ok(snapshot.machine_facts.test_commands.includes('pytest'));
  assert.ok(snapshot.debt_markers.some((item) => item.file === 'app.py'));
});

test('ctx snapshot treats LF and CRLF text as semantically equivalent', () => {
  const repo = makeRepo('basic');
  initRepo(repo);

  writeFileSync(path.join(repo, 'main.js'), '// TODO: line ending check\nconsole.log("same")\n');
  const first = runCtx(['snapshot'], repo);
  assert.equal(first.status, 0, first.stderr);
  const firstLock = readJson(path.join(repo, '.contextlock', 'lock.json'));

  writeFileSync(path.join(repo, 'main.js'), '// TODO: line ending check\r\nconsole.log("same")\r\n');
  const second = runCtx(['snapshot'], repo);
  assert.equal(second.status, 0, second.stderr);
  const secondLock = readJson(path.join(repo, '.contextlock', 'lock.json'));

  assert.equal(secondLock.latest_snapshot_hash, firstLock.latest_snapshot_hash);
});

test('ctx snapshot detects Go and Rust manifests and commands', () => {
  const goRepo = makeRepo('go');
  initRepo(goRepo);
  const goResult = runCtx(['snapshot'], goRepo);
  assert.equal(goResult.status, 0, goResult.stderr);
  const goLock = readJson(path.join(goRepo, '.contextlock', 'lock.json'));
  const goSnapshot = readJson(snapshotPath(goRepo, goLock.latest_snapshot_hash));
  assert.ok(goSnapshot.machine_facts.languages.includes('go'));
  assert.ok(goSnapshot.machine_facts.test_commands.includes('go test ./...'));
  assert.ok(goSnapshot.machine_facts.build_commands.includes('go build ./...'));

  const rustRepo = makeRepo('rust');
  initRepo(rustRepo);
  const rustResult = runCtx(['snapshot'], rustRepo);
  assert.equal(rustResult.status, 0, rustResult.stderr);
  const rustLock = readJson(path.join(rustRepo, '.contextlock', 'lock.json'));
  const rustSnapshot = readJson(snapshotPath(rustRepo, rustLock.latest_snapshot_hash));
  assert.ok(rustSnapshot.machine_facts.languages.includes('rust'));
  assert.ok(rustSnapshot.machine_facts.test_commands.includes('cargo test'));
  assert.ok(rustSnapshot.machine_facts.build_commands.includes('cargo build'));
});
