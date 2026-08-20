import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { computeMemoryId } from '../src/memory/index.js';
import { readJsonIfExists } from '../src/utils/core.js';

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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-mem-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mem-fixture' }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Memory Fixture\n\nA sample project.\n');
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log("hi")\n');
  return dir;
}

function initAndSnapshot(repo) {
  const initResult = runCtx(['init', '--yes'], repo);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  const snapResult = runCtx(['snapshot'], repo);
  assert.equal(snapResult.status, 0, snapResult.stderr || snapResult.stdout);
  return readJsonIfExists(path.join(repo, '.contextlock', 'lock.json')).latest_snapshot_hash;
}

function readMemory(repo, id) {
  return readJsonIfExists(path.join(repo, '.contextlock', 'memory', `${id}.json`));
}

test('memory add produces a deterministic id and anchors to the snapshot hash', () => {
  const repo = makeRepo();
  const snapshotHash = initAndSnapshot(repo);

  const content = 'We chose rate limiting at the API gateway.';
  const expectedId = computeMemoryId(content, ['src/index.js']);

  const add1 = runCtx(['memory', 'add', '--type', 'decision', content, '--relates', 'src/index.js'], repo);
  assert.equal(add1.status, 0, add1.stderr || add1.stdout);
  const entry1 = readMemory(repo, expectedId);
  assert.ok(entry1, 'memory file written with content-addressed id');
  assert.equal(entry1.id, expectedId, 'id is deterministic');
  assert.equal(entry1.anchor_hash, snapshotHash, 'anchor_hash equals snapshot hash');
  assert.deepEqual(entry1.related_files, ['src/index.js']);
  assert.equal(entry1.schema_version, 1);

  // Adding the identical fact again must be idempotent (dedup by content hash).
  const add2 = runCtx(['memory', 'add', '--type', 'decision', content, '--relates', 'src/index.js'], repo);
  assert.equal(add2.status, 0, add2.stderr || add2.stdout);
  assert.match(add2.stdout, /already exists/, 'duplicate add reports existing entry');
});

test('memory whose related file changes is flagged stale by verify', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);

  const stableResult = runCtx(['memory', 'add', '--type', 'semantic', 'README documents the project overview', '--relates', 'README.md'], repo);
  assert.equal(stableResult.status, 0, stableResult.stderr || stableResult.stdout);
  const stableId = readdirSync(path.join(repo, '.contextlock', 'memory'))[0].replace('.json', '');

  const driftResult = runCtx(['memory', 'add', '--type', 'procedural', 'src/index.js wires up the server', '--relates', 'src/index.js'], repo);
  assert.equal(driftResult.status, 0, driftResult.stderr || driftResult.stdout);
  const driftId = readdirSync(path.join(repo, '.contextlock', 'memory')).find((f) => f !== `${stableId}.json`).replace('.json', '');

  // Introduce drift in the related source file and re-snapshot.
  writeFileSync(path.join(repo, 'src', 'index.js'), 'console.log("changed")\n');
  const snap2 = runCtx(['snapshot'], repo);
  assert.equal(snap2.status, 0, snap2.stderr || snap2.stdout);

  const verify = runCtx(['memory', 'verify'], repo);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);

  const driftEntry = readMemory(repo, driftId);
  const stableEntry = readMemory(repo, stableId);
  assert.equal(driftEntry.stale, true, 'entry related to changed file is stale');
  assert.equal(stableEntry.stale, false, 'entry related to unchanged file stays fresh');
});

test('memory content is redacted on write when a secret is present', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);
  const rawSecret = 'sk-abcdefghijklmnopqrstuvwx123456';
  const content = `Token for the gateway is ${rawSecret}`;

  const add = runCtx(['memory', 'add', '--type', 'decision', content, '--relates', 'README.md'], repo);
  assert.equal(add.status, 0, add.stderr || add.stdout);
  assert.match(add.stdout, /redacted/i, 'redaction note printed');

  const id = readdirSync(path.join(repo, '.contextlock', 'memory'))[0].replace('.json', '');
  const entry = readMemory(repo, id);
  assert.ok(entry.content.includes('[REDACTED]'), 'secret replaced by redaction marker');
  assert.ok(!entry.content.includes(rawSecret), 'raw secret must not be stored');
});

test('export --rag includes memory docs with anchor_hash and redacted flag', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);
  const rawSecret = 'sk-abcdefghijklmnopqrstuvwx123456';
  const add = runCtx(['memory', 'add', '--type', 'episodic', `We rotated the key ${rawSecret}`, '--relates', 'src/index.js'], repo);
  assert.equal(add.status, 0, add.stderr || add.stdout);

  const dest = mkdtempSync(path.join(os.tmpdir(), 'rag-mem-'));
  const exp = runCtx(['site', 'export', '--rag', dest], repo);
  assert.equal(exp.status, 0, exp.stderr || exp.stdout);

  const manifest = readJsonIfExists(path.join(dest, 'manifest.json'));
  const memoryDoc = manifest.documents.find((doc) => doc.source === 'memory');
  assert.ok(memoryDoc, 'memory doc present in bundle');
  assert.equal(memoryDoc.redacted, true, 'memory doc flagged redacted');
  assert.ok(memoryDoc.anchor_hash, 'anchor_hash carried into bundle');
  assert.equal(memoryDoc.snapshot_hash, manifest.snapshot_hash);
});

test('supersede links the old entry without deleting or mutating history', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);

  const oldAdd = runCtx(['memory', 'add', '--type', 'decision', 'Use rate limiting', '--relates', 'src/index.js'], repo);
  assert.equal(oldAdd.status, 0, oldAdd.stderr || oldAdd.stdout);
  const oldId = readdirSync(path.join(repo, '.contextlock', 'memory'))[0].replace('.json', '');

  const newAdd = runCtx(['memory', 'add', '--type', 'decision', 'Use token bucket rate limiting instead', '--relates', 'src/index.js'], repo);
  assert.equal(newAdd.status, 0, newAdd.stderr || newAdd.stdout);
  const newId = readdirSync(path.join(repo, '.contextlock', 'memory')).find((f) => f !== `${oldId}.json`).replace('.json', '');

  const sup = runCtx(['memory', 'supersede', oldId, newId], repo);
  assert.equal(sup.status, 0, sup.stderr || sup.stdout);

  const oldEntry = readMemory(repo, oldId);
  const newEntry = readMemory(repo, newId);
  assert.equal(oldEntry.superseded_by, newId, 'old entry linked to replacement');
  assert.equal(oldEntry.content, 'Use rate limiting', 'original content preserved');
  assert.equal(newEntry.superseded_by, null, 'replacement left untouched');
  assert.ok(existsSync(path.join(repo, '.contextlock', 'memory', `${oldId}.json`)), 'old file retained');
});
