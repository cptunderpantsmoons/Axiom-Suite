import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-code-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'code-fixture' }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Code Fixture\n\nA sample.\n');
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'index.js'), 'function bootstrap() {\n  return 42;\n}\nclass Server {\n  start() {}\n}\n');
  writeFileSync(path.join(dir, 'src', 'util.py'), 'def helper():\n    return 1\n\nclass Widget:\n    pass\n');
  return dir;
}

function initAndSnapshot(repo) {
  const initResult = runCtx(['init', '--yes'], repo);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  const snapResult = runCtx(['snapshot'], repo);
  assert.equal(snapResult.status, 0, snapResult.stderr || snapResult.stdout);
}

test('ctx code index writes a deterministic index artifact', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);
  const out = runCtx(['code', 'index'], repo);
  assert.equal(out.status, 0, out.stderr || out.stdout);

  const lock = JSON.parse(readFileSync(path.join(repo, '.contextlock', 'lock.json'), 'utf8'));
  const indexPath = path.join(repo, '.contextlock', 'index', `${lock.latest_snapshot_hash}.json`);
  assert.ok(existsSync(indexPath), 'index artifact written');

  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  assert.equal(index.artifact_type, 'code_index');
  assert.equal(index.code_index_version, 1);
  assert.equal(index.snapshot_hash, lock.latest_snapshot_hash);

  const js = index.files.find((f) => f.path === 'src/index.js');
  assert.ok(js, 'src/index.js present');
  assert.equal(js.classification, 'source');
  assert.equal(js.language, 'javascript');
  assert.ok(js.doc_id.startsWith('f-'), 'doc_id is content-addressed');
  assert.ok(js.content_hash, 'content_hash present');
});

test('code index is deterministic for identical repo state', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);
  const a = runCtx(['code', 'index', '--quiet'], repo);
  const b = runCtx(['code', 'index', '--quiet'], repo);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.equal(b.status, 0, b.stderr || b.stdout);

  const lock = JSON.parse(readFileSync(path.join(repo, '.contextlock', 'lock.json'), 'utf8'));
  const read = () => JSON.parse(readFileSync(path.join(repo, '.contextlock', 'index', `${lock.latest_snapshot_hash}.json`), 'utf8'));
  const ia = read();
  const ib = read();
  assert.equal(ia.index_determinism_hash, ib.index_determinism_hash, 'determinism hash must match');
});

test('code index extracts symbols from source files', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);
  const out = runCtx(['code', 'index', '--format', 'json'], repo);
  assert.equal(out.status, 0, out.stderr || out.stdout);
  const index = JSON.parse(out.stdout);
  const js = index.files.find((f) => f.path === 'src/index.js');
  const names = js.symbols.map((s) => s.name);
  assert.ok(names.includes('bootstrap'), 'function bootstrap extracted');
  assert.ok(names.includes('Server'), 'class Server extracted');
  assert.ok(js.symbols.some((s) => s.kind === 'function' && s.name === 'bootstrap'));
});

test('rag --code export includes one per-file code doc with provenance', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);
  const dest = mkdtempSync(path.join(os.tmpdir(), 'rag-code-'));
  const out = runCtx(['site', 'export', '--rag', dest, '--code'], repo);
  assert.equal(out.status, 0, out.stderr || out.stdout);

  const manifest = JSON.parse(readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  const codeDocs = manifest.documents.filter((d) => d.source === 'code');
  assert.ok(codeDocs.length >= 3, 'per-file code docs emitted');
  const jsDoc = codeDocs.find((d) => d.related_files.includes('src/index.js'));
  assert.ok(jsDoc, 'src/index.js code doc present');
  assert.equal(jsDoc.doc_id.startsWith('code-'), true, 'code doc ids namespaced');
  assert.equal(jsDoc.anchor_hash, manifest.snapshot_hash, 'anchor_hash carried');
  assert.ok(existsSync(path.join(dest, 'documents', `${jsDoc.doc_id}.md`)), 'code doc body written');
});

test('code doc redacts secrets from file text in rag --code export', () => {
  const repo = makeRepo();
  initAndSnapshot(repo);
  const rawSecret = 'sk-abcdefghijklmnopqrstuvwx123456';
  writeFileSync(path.join(repo, 'src', 'secret.js'), `const token = '${rawSecret}';\nfunction load() {}\n`);
  const snap2 = runCtx(['snapshot'], repo);
  assert.equal(snap2.status, 0, snap2.stderr || snap2.stdout);

  const dest = mkdtempSync(path.join(os.tmpdir(), 'rag-code-redact-'));
  const out = runCtx(['site', 'export', '--rag', dest, '--code'], repo);
  assert.equal(out.status, 0, out.stderr || out.stdout);

  const manifest = JSON.parse(readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  const secretDoc = manifest.documents.find((d) => d.related_files.includes('src/secret.js'));
  assert.ok(secretDoc, 'secret file code doc present');
  assert.equal(secretDoc.redacted, true, 'code doc flagged redacted');
  const body = readFileSync(path.join(dest, 'documents', `${secretDoc.doc_id}.md`), 'utf8');
  assert.ok(body.includes('[REDACTED]'), 'redaction marker present');
  assert.ok(!body.includes(rawSecret), 'raw secret absent from code doc');
});
