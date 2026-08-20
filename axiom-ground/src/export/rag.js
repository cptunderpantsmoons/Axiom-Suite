import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { listSnapshotArtifacts } from '../snapshot/index.js';
import { redactSecrets } from '../scanner/markers.js';
import { buildCodeIndex, listCodeIndexDocs } from '../codeindex/index.js';
import { ensureDir, readJsonIfExists, fastCompare, writeJson } from '../utils/core.js';

export const RAG_BUNDLE_VERSION = 1;
const MEMORY_DIR = '.contextlock/memory';

function slugify(value) {
  return (
    String(value || 'untitled')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'untitled'
  );
}

function normalizeDocBody(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n+\s*$/, '') + '\n';
}

function splitSnapshotSections(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let current = { title: 'overview', lines: [] };
  for (const line of lines) {
    const heading = line.match(/^#\s+(.*)$/);
    if (heading) {
      sections.push(current);
      current = { title: heading[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections.map((section) => ({
    title: section.title,
    body: section.lines.join('\n')
  }));
}

function uniqueDocId(prefix, slug, used) {
  let id = `${prefix}-${slug}`;
  let n = 2;
  while (used.has(id)) {
    id = `${prefix}-${slug}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function bundleError(message, reason, recovery, command, code = 2) {
  return { ok: false, error: { message, reason, recovery, command, code } };
}

export function buildRagBundle(root, lock, destDir, { includeCode = false } = {}) {
  const snapshotHash = lock?.latest_snapshot_hash || listSnapshotArtifacts(root)[0]?.hash;
  if (!snapshotHash) {
    return bundleError(
      'No snapshot found for RAG export',
      'The RAG bundle is built from the current project snapshot.',
      'Run `ctx snapshot` first, then export the bundle.',
      'ctx snapshot && ctx site export --rag <dir>'
    );
  }

  const mdPath = path.join(root, '.contextlock', 'snapshots', `${snapshotHash}.md`);
  if (!existsSync(mdPath)) {
    return bundleError(
      'Snapshot markdown missing',
      `Expected ${mdPath}.`,
      'Re-run `ctx snapshot` to regenerate artifacts.',
      'ctx snapshot'
    );
  }

  const rawMd = readFileSync(mdPath, 'utf8');
  const prefix = snapshotHash.slice(0, 10);
  const used = new Set();
  const docs = [];

  for (const section of splitSnapshotSections(rawMd)) {
    const redacted = redactSecrets(section.body);
    docs.push({
      source: 'snapshot',
      doc_id: uniqueDocId(prefix, slugify(section.title), used),
      title: section.title,
      body: normalizeDocBody(redacted.text),
      redacted: redacted.redactionCount > 0,
      snapshot_hash: snapshotHash,
      anchor_hash: snapshotHash,
      related_files: []
    });
  }

  const memoryDir = path.join(root, MEMORY_DIR);
  if (existsSync(memoryDir)) {
    for (const file of readdirSync(memoryDir).filter((entry) => entry.endsWith('.json'))) {
      const entry = readJsonIfExists(path.join(memoryDir, file));
      if (!entry || !entry.content) continue;
      const redacted = redactSecrets(entry.content);
      const body = normalizeDocBody(`# ${entry.type || 'memory'}: ${entry.id || file}\n\n${redacted.text}`);
      docs.push({
        source: 'memory',
        doc_id: uniqueDocId(entry.anchor_hash ? entry.anchor_hash.slice(0, 10) : prefix, `mem-${slugify(entry.id || file)}`, used),
        title: `${entry.type || 'memory'}: ${entry.id || file}`,
        body,
        redacted: Boolean(entry.redacted) || redacted.redactionCount > 0,
        snapshot_hash: snapshotHash,
        anchor_hash: entry.anchor_hash || snapshotHash,
        related_files: Array.isArray(entry.related_files) ? entry.related_files : []
      });
    }
  }

  if (includeCode) {
    const codeBuilt = buildCodeIndex(root, lock);
    if (!codeBuilt.ok) return codeBuilt;
    for (const doc of listCodeIndexDocs(root, codeBuilt)) {
      docs.push({
        source: 'code',
        doc_id: `code-${doc.entry.doc_id}`,
        title: doc.entry.path,
        body: normalizeDocBody(doc.body),
        redacted: doc.redacted,
        snapshot_hash: snapshotHash,
        anchor_hash: snapshotHash,
        related_files: [doc.entry.path]
      });
    }
  }

  docs.sort((a, b) => fastCompare(a.doc_id, b.doc_id));

  const documentsDir = path.join(destDir, 'documents');
  ensureDir(documentsDir);
  for (const doc of docs) {
    writeFileSync(path.join(documentsDir, `${doc.doc_id}.md`), doc.body);
  }

  const manifest = {
    rag_bundle_version: RAG_BUNDLE_VERSION,
    generated_at: new Date().toISOString(),
    snapshot_hash: snapshotHash,
    artifact_counts: {
      snapshot: docs.filter((doc) => doc.source === 'snapshot').length,
      memory: docs.filter((doc) => doc.source === 'memory').length,
      code: docs.filter((doc) => doc.source === 'code').length,
      total: docs.length
    },
    documents: docs.map((doc) => ({
      doc_id: doc.doc_id,
      source: doc.source,
      title: doc.title,
      snapshot_hash: doc.snapshot_hash,
      anchor_hash: doc.anchor_hash,
      related_files: doc.related_files,
      redacted: doc.redacted
    }))
  };

  const hashInput = {
    rag_bundle_version: RAG_BUNDLE_VERSION,
    snapshot_hash: snapshotHash,
    documents: manifest.documents
  };
  const hasher = createHash('sha256');
  for (const doc of docs) {
    hasher.update(doc.doc_id + '\n');
    hasher.update(doc.body);
  }
  hasher.update(JSON.stringify(hashInput));
  manifest.bundle_determinism_hash = hasher.digest('hex');

  writeJson(path.join(destDir, 'manifest.json'), manifest);

  return { ok: true, destDir, manifest, bundle_determinism_hash: manifest.bundle_determinism_hash, docCount: docs.length };
}
