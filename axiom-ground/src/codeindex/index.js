import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ensureDir, readJsonIfExists, sha256, writeJson, fastCompare } from '../utils/core.js';
import { walkFiles, DEFAULT_EXCLUDES, MAX_TEXT_BYTES } from '../scanner/core.js';
import { classifyFile, detectLanguage, normalizeTextContent, isBinaryBuffer, redactSecrets, extractManifests } from '../scanner/index.js';
import { listSnapshotArtifacts } from '../snapshot/index.js';

export const CODE_INDEX_VERSION = 1;
const INDEX_DIR = '.contextlock/index';

// ---------------------------------------------------------------------------
// Symbol extraction (lightweight, per-language, best-effort)
// ---------------------------------------------------------------------------

const SYMBOL_RE = {
  javascript: [
    { kind: 'function', re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'function', re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]/ },
    { kind: 'class', re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'method', re: /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/ }
  ],
  python: [
    { kind: 'function', re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/ },
    { kind: 'class', re: /^\s*class\s+([A-Za-z_][\w]*)/ }
  ],
  go: [
    { kind: 'function', re: /^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)\s*\(/ },
    { kind: 'type', re: /^\s*type\s+([A-Za-z_][\w]*)\s+struct/ }
  ],
  rust: [
    { kind: 'function', re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/ },
    { kind: 'struct', re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/ },
    { kind: 'enum', re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/ },
    { kind: 'trait', re: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/ }
  ]
};

function extractSymbols(text, language) {
  const rules = SYMBOL_RE[language];
  if (!rules) return [];
  const lines = text.split('\n');
  const symbols = [];
  let inClassDepth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    if (inClassDepth && indent === 0) inClassDepth = 0;
    for (const rule of rules) {
      const match = trimmed.match(rule.re);
      if (!match) continue;
      if (rule.kind === 'class') inClassDepth = indent + 1;
      symbols.push({ name: match[1], kind: rule.kind, line: i + 1 });
      break;
    }
  }
  return symbols;
}

function normalizeFileText(buffer) {
  if (isBinaryBuffer(buffer)) return null;
  if (buffer.length > MAX_TEXT_BYTES) return null;
  return normalizeTextContent(buffer.toString('utf8'));
}

function safeReadText(fullPath) {
  try {
    return normalizeFileText(readFileSync(fullPath));
  } catch {
    return null;
  }
}

function contentHashOf(text) {
  return sha256(text);
}

function fileDocId(posixPath, contentHash) {
  return `f-${sha256(`${posixPath}\u0000${contentHash}`).slice(0, 16)}`;
}

function indexError(message, reason, recovery, command, code = 2) {
  return { ok: false, error: { message, reason, recovery, command, code } };
}

export function buildCodeIndex(root, lock) {
  const snapshotHash = lock?.latest_snapshot_hash || listSnapshotArtifacts(root)[0]?.hash;
  if (!snapshotHash) {
    return indexError(
      'No snapshot found for code index',
      'The code index is anchored to the current project snapshot.',
      'Run `ctx snapshot` first, then build the index.',
      'ctx snapshot && ctx code index'
    );
  }

  const files = walkFiles(root, Array.isArray(lock?.exclude) ? lock.exclude : DEFAULT_EXCLUDES);
  const manifests = extractManifests(root);
  const entries = [];
  let symbolTotal = 0;
  let redactedTotal = 0;

  for (const rel of files) {
    const posix = rel.split(/[\\/]+/).join('/');
    const full = path.join(root, rel);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.size > MAX_TEXT_BYTES) continue;

    const text = safeReadText(full);
    if (text === null) continue; // binary or unreadable → skip

    const classification = classifyFile(posix);
    const language = detectLanguage(posix, manifests) || null;
    const contentHash = contentHashOf(text);
    const redacted = redactSecrets(text);
    if (redacted.redactionCount > 0) redactedTotal += 1;

    const symbols = extractSymbols(redacted.text, language);
    symbolTotal += symbols.length;

    entries.push({
      doc_id: fileDocId(posix, contentHash),
      path: posix,
      language,
      classification,
      content_hash: contentHash,
      size_bytes: stat.size,
      redacted: redacted.redactionCount > 0,
      symbols
    });
  }

  entries.sort((a, b) => fastCompare(a.path, b.path));

  const hashInput = entries.map((entry) => ({
    doc_id: entry.doc_id,
    path: entry.path,
    content_hash: entry.content_hash,
    classification: entry.classification,
    symbols: entry.symbols
  }));
  const hasher = createHash('sha256');
  hasher.update(JSON.stringify(hashInput));
  const determinismHash = hasher.digest('hex');

  const index = {
    schema_version: 1,
    artifact_type: 'code_index',
    code_index_version: CODE_INDEX_VERSION,
    snapshot_hash: snapshotHash,
    generated_at: new Date().toISOString(),
    index_determinism_hash: determinismHash,
    artifact_counts: {
      files: entries.length,
      symbols: symbolTotal,
      redacted: redactedTotal
    },
    files: entries
  };

  return { ok: true, index, snapshotHash, determinismHash };
}

export function writeCodeIndexArtifacts(root, built) {
  const dir = path.join(root, INDEX_DIR);
  ensureDir(dir);
  const jsonPath = path.join(dir, `${built.snapshotHash}.json`);
  writeJson(jsonPath, built.index);
  return { jsonPath };
}

export function readCodeIndex(root, snapshotHash) {
  const p = path.join(root, INDEX_DIR, `${snapshotHash}.json`);
  return readJsonIfExists(p);
}

// ---------------------------------------------------------------------------
// RAG integration helper — redacted per-file chunk text
// ---------------------------------------------------------------------------

export function listCodeIndexDocs(root, built) {
  const docs = [];
  for (const entry of built.index.files) {
    const full = path.join(root, entry.path);
    const text = safeReadText(full);
    if (text === null) continue;
    const redacted = redactSecrets(text);
    docs.push({
      entry,
      body: `# ${entry.path}\n\n\`\`\`${entry.language || ''}\n${redacted.text}\n\`\`\`\n`,
      redacted: redacted.redactionCount > 0
    });
  }
  return docs;
}
