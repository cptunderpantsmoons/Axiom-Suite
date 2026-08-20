import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-rag-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'rag-fixture' }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# RAG Fixture\n\nA sample project for the RAG bundle.\n');
  writeFileSync(path.join(dir, 'index.js'), 'console.log("hi")\n');
  return dir;
}

function snapshot(repo) {
  const initResult = runCtx(['init', '--yes'], repo);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  const result = runCtx(['snapshot'], repo);
  assert.equal(result.status, 0, result.stderr);
}

function exportRag(repo, dest) {
  const result = runCtx(['site', 'export', '--rag', dest], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function readBundle(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const docs = readdirSync(path.join(dir, 'documents'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(path.join(dir, 'documents', f), 'utf8'))
    .join('\n');
  return { manifest, docs };
}

function manifestWithoutTimestamp(manifest) {
  const { generated_at, ...rest } = manifest;
  return rest;
}

test('rag export produces a valid bundle with metadata and documents', () => {
  const repo = makeRepo();
  snapshot(repo);
  const dest = mkdtempSync(path.join(os.tmpdir(), 'rag-out-'));
  exportRag(repo, dest);

  assert.ok(existsSync(path.join(dest, 'manifest.json')), 'manifest.json should exist');
  const { manifest, docs } = readBundle(dest);
  assert.equal(manifest.rag_bundle_version, 1);
  assert.ok(manifest.snapshot_hash, 'snapshot_hash present');
  assert.ok(manifest.bundle_determinism_hash, 'bundle_determinism_hash present');
  assert.ok(manifest.documents.length > 0, 'at least one document');
  assert.ok(manifest.artifact_counts.total === manifest.documents.length);
  assert.ok(docs.length > 0, 'document bodies written');

  for (const doc of manifest.documents) {
    assert.ok(existsSync(path.join(dest, 'documents', `${doc.doc_id}.md`)), `doc ${doc.doc_id} exists`);
  }
});

test('rag export is deterministic for identical repo state', () => {
  const repo = makeRepo();
  snapshot(repo);
  const a = mkdtempSync(path.join(os.tmpdir(), 'rag-a-'));
  const b = mkdtempSync(path.join(os.tmpdir(), 'rag-b-'));
  exportRag(repo, a);
  exportRag(repo, b);

  const ma = readBundle(a).manifest;
  const mb = readBundle(b).manifest;
  assert.equal(ma.bundle_determinism_hash, mb.bundle_determinism_hash, 'determinism hash must match');
  assert.deepEqual(manifestWithoutTimestamp(ma), manifestWithoutTimestamp(mb), 'manifest content must match');
});

test('rag export redacts secrets from memory entries', () => {
  const repo = makeRepo();
  snapshot(repo);
  const rawSecret = 'sk-abcdefghijklmnopqrstuvwx123456';
  const memoryDir = path.join(repo, '.contextlock', 'memory');
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    path.join(memoryDir, 'decision-1.json'),
    JSON.stringify({
      id: 'decision-1',
      type: 'decision',
      content: `We chose rate limiting. Token: ${rawSecret}`,
      anchor_hash: 'snapshotanchor',
      related_files: ['src/index.js'],
      schema_version: 1
    }) + '\n'
  );

  const dest = mkdtempSync(path.join(os.tmpdir(), 'rag-redact-'));
  exportRag(repo, dest);
  const { manifest, docs } = readBundle(dest);

  assert.ok(docs.includes('[REDACTED]'), 'redaction marker present in bundle');
  assert.ok(!docs.includes(rawSecret), 'raw secret must not appear in bundle');
  const memoryDoc = manifest.documents.find((d) => d.source === 'memory');
  assert.ok(memoryDoc, 'memory doc included');
  assert.equal(memoryDoc.redacted, true, 'memory doc flagged redacted');
});

test('rag export excludes non-snapshot (ignored) content', () => {
  const repo = makeRepo();
  mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
  writeFileSync(path.join(repo, 'node_modules', 'leaked.js'), '// MARKER_EXCLUDED_ZZZ123\n');
  snapshot(repo);
  const dest = mkdtempSync(path.join(os.tmpdir(), 'rag-excl-'));
  exportRag(repo, dest);
  const { docs } = readBundle(dest);
  assert.ok(!docs.includes('MARKER_EXCLUDED_ZZZ123'), 'excluded file content must not appear in bundle');
});
