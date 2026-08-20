import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

function makeRepo(kind = 'empty') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-build1-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);

  if (kind === 'node') {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'node-fixture', scripts: { test: 'node --test' } }, null, 2) + '\n');
    writeFileSync(path.join(dir, 'index.js'), 'console.log("hi")\n');
  }

  if (kind === 'python') {
    writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "python-fixture"\nversion = "0.0.0"\n');
    writeFileSync(path.join(dir, 'app.py'), 'print("hi")\n');
  }

  return dir;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('ctx init creates structure in an empty git repo', () => {
  const repo = makeRepo('empty');
  const first = runCtx(['init', '--yes'], repo);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /ContextLock initialized/);

  const rootConfig = path.join(repo, '.contextlock', 'config.json');
  const rootLock = path.join(repo, '.contextlock', 'lock.json');
  const expectedDirs = ['snapshots', 'prompts', 'audits', 'site', 'cache', 'queue', 'logs'];

  assert.ok(existsSync(rootConfig));
  assert.ok(existsSync(rootLock));
  for (const dir of expectedDirs) assert.ok(existsSync(path.join(repo, '.contextlock', dir)));
  assert.equal(existsSync(path.join(repo, '.contextlock', '.contextlock')), false);

  const config = readJson(rootConfig);
  const lock = readJson(rootLock);
  assert.equal(config.version, 1);
  assert.equal(config.project_id.startsWith('ctxproj_'), true);
  assert.ok(config.exclude.includes('.contextlock/**'));
  assert.equal(lock.project_id, config.project_id);
  assert.equal(lock.current_branch, 'main');
  assert.equal(lock.current_commit, null);

  const second = runCtx(['init', '--yes'], repo);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already initialized/);
  assert.deepEqual(readJson(rootConfig), config);
});

test('ctx version matches package version', () => {
  const repo = makeRepo('empty');
  const result = runCtx(['--version'], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.1.0');
});

test('ctx init works in a node repo and status reports full support', () => {
  const repo = makeRepo('node');
  const init = runCtx(['init', '--yes'], repo);
  assert.equal(init.status, 0, init.stderr);

  const status = runCtx(['status'], repo);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Support level: full/);
  assert.match(status.stdout, /Project: node-fixture/);

  const jsonStatus = runCtx(['status', '--format', 'json'], repo);
  assert.equal(jsonStatus.status, 0, jsonStatus.stderr);
  const parsed = JSON.parse(jsonStatus.stdout);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.artifact_type, 'status');
  assert.equal(parsed.support_level, 'full');
  assert.equal(parsed.project, 'node-fixture');
});

test('ctx init works in a python repo and status reports full support', () => {
  const repo = makeRepo('python');
  const init = runCtx(['init', '--yes'], repo);
  assert.equal(init.status, 0, init.stderr);

  const status = runCtx(['status'], repo);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Support level: full/);
  assert.match(status.stdout, /Project: python-fixture/);
});

test('ctx init fails clearly outside a git repo', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-nogit-'));
  const result = runCtx(['init', '--yes'], dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not inside a Git repository/);
  assert.match(result.stderr, /Recovery:/);
});
