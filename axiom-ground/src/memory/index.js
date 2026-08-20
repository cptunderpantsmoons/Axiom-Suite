import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { ensureDir, readJsonIfExists, writeJson, sha256, fastCompare } from '../utils/core.js';
import { redactSecrets } from '../scanner/markers.js';
import { loadSnapshotArtifact, listSnapshotArtifacts } from '../snapshot/index.js';
import { buildAuditFindings } from '../audit/index.js';

export const MEMORY_DIR = '.contextlock/memory';
export const MEMORY_SCHEMA_VERSION = 1;

export const MEMORY_TYPES = ['episodic', 'semantic', 'procedural', 'decision'];

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const DEFAULT_STALE_MIN_SEVERITY = 'medium';

function memoryPath(root, id) {
  return path.join(root, MEMORY_DIR, `${id}.json`);
}

function severityRank(severity) {
  return SEVERITY_RANK[severity] || 0;
}

function resolveStaleMinSeverity(config) {
  const configured = config?.memory?.stale_min_severity;
  return typeof configured === 'string' && SEVERITY_RANK[configured] ? configured : DEFAULT_STALE_MIN_SEVERITY;
}

function normalizeMemoryContent(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
}

export function computeMemoryId(content, relatedFiles) {
  const norm = normalizeMemoryContent(content);
  const files = [...new Set(relatedFiles || [])].sort(fastCompare);
  return `mem_${sha256(`${norm}\u0000${JSON.stringify(files)}`).slice(0, 16)}`;
}

export function listMemoryEntries(root) {
  const dir = path.join(root, MEMORY_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJsonIfExists(path.join(dir, file)))
    .filter(Boolean);
}

export function readMemoryEntry(root, id) {
  return readJsonIfExists(memoryPath(root, id));
}

function safeRedact(content) {
  try {
    const result = redactSecrets(content);
    return { ok: true, text: result.text, redactionCount: result.redactionCount || 0 };
  } catch {
    return {
      ok: false,
      error: {
        message: 'Unable to redact secrets in memory content',
        reason: 'The content could not be processed by the secret scanner.',
        recovery: 'Remove or escape the problematic content and try again.',
        command: 'ctx memory add --type decision "<content>"',
        code: 2
      }
    };
  }
}

export function addMemoryEntry(root, { type, content, relatedFiles = [], config = null, lock = null }) {
  const anchorHash = lock?.latest_snapshot_hash || listSnapshotArtifacts(root)[0]?.hash || null;
  if (!anchorHash) {
    return {
      ok: false,
      error: {
        message: 'No snapshot available to anchor memory',
        reason: 'Memory entries are anchored to a project snapshot for drift verification.',
        recovery: 'Run `ctx snapshot` first to create an anchor snapshot.',
        command: 'ctx snapshot',
        code: 2
      }
    };
  }

  if (!type || !MEMORY_TYPES.includes(type)) {
    return {
      ok: false,
      error: {
        message: 'A valid --type is required',
        reason: `Supported types: ${MEMORY_TYPES.join(', ')}.`,
        recovery: 'Pass one of the supported memory types.',
        command: 'ctx memory add --type decision "<content>" --relates src/index.js',
        code: 2
      }
    };
  }

  const rawContent = normalizeMemoryContent(content);
  if (!rawContent) {
    return {
      ok: false,
      error: {
        message: 'Memory content is required',
        reason: 'An empty memory entry is not allowed.',
        recovery: 'Provide non-empty content for the memory entry.',
        command: 'ctx memory add --type decision "<content>"',
        code: 2
      }
    };
  }

  const redacted = safeRedact(rawContent);
  if (!redacted.ok) return redacted;

  const related = [...new Set(relatedFiles.map((file) => file.split(/[\\/]+/).join('/')))].sort(fastCompare);
  const id = computeMemoryId(redacted.text, related);
  const existing = readMemoryEntry(root, id);
  if (existing && !existing.superseded_by) {
    return { ok: true, entry: existing, alreadyExisted: true, suppressedRedaction: redacted.redactionCount > 0 };
  }

  const entry = {
    id,
    type,
    content: redacted.text,
    anchor_hash: anchorHash,
    related_files: related,
    created_at: new Date().toISOString(),
    superseded_by: null,
    redacted: redacted.redactionCount > 0,
    schema_version: MEMORY_SCHEMA_VERSION
  };
  ensureDir(path.join(root, MEMORY_DIR));
  writeJson(memoryPath(root, id), entry);
  return { ok: true, entry, alreadyExisted: false, suppressedRedaction: redacted.redactionCount > 0 };
}

function evaluateStaleness(entry, currentSnapshot, root, config, minSeverity) {
  const anchorSnapshot = loadSnapshotArtifact(root, entry.anchor_hash);
  if (!anchorSnapshot) return { stale: true, reason: 'anchor_snapshot_missing' };
  if (!currentSnapshot) return { stale: true, reason: 'current_snapshot_missing' };
  if (anchorSnapshot.snapshot_hash === currentSnapshot.snapshot_hash) {
    return { stale: false, reason: 'no_drift' };
  }

  const findings = buildAuditFindings(root, anchorSnapshot, currentSnapshot, config);
  const relatedSet = new Set(entry.related_files || []);
  const minRank = severityRank(minSeverity);
  for (const finding of findings) {
    if (severityRank(finding.severity) < minRank) continue;
    const affected = new Set((finding.evidence || []).map((evidence) => evidence?.file).filter(Boolean));
    if ([...relatedSet].some((file) => affected.has(file))) {
      return { stale: true, reason: finding.id };
    }
  }
  return { stale: false, reason: 'no_relevant_drift' };
}

export function verifyMemory(root, config = null, lock = null) {
  const entries = listMemoryEntries(root);
  const minSeverity = resolveStaleMinSeverity(config);
  const currentHash = lock?.latest_snapshot_hash || listSnapshotArtifacts(root)[0]?.hash || null;
  const currentSnapshot = currentHash ? loadSnapshotArtifact(root, currentHash) : null;

  const results = [];
  for (const entry of entries) {
    const { stale, reason } = evaluateStaleness(entry, currentSnapshot, root, config, minSeverity);
    const updated = {
      ...entry,
      stale,
      stale_reason: reason,
      verified_at: new Date().toISOString()
    };
    writeJson(memoryPath(root, entry.id), updated);
    results.push({ id: entry.id, stale, reason });
  }

  return {
    verified_at: new Date().toISOString(),
    stale_min_severity: minSeverity,
    entry_count: entries.length,
    stale_count: results.filter((result) => result.stale).length,
    results
  };
}

export function supersedeMemory(root, id, newId) {
  const entry = readMemoryEntry(root, id);
  if (!entry) {
    return {
      ok: false,
      error: {
        message: `Memory entry "${id}" not found`,
        reason: 'The entry to supersede does not exist.',
        recovery: 'List entries with `ctx memory list` to find valid ids.',
        command: 'ctx memory list',
        code: 2
      }
    };
  }
  if (id === newId) {
    return {
      ok: false,
      error: {
        message: 'An entry cannot supersede itself',
        reason: 'The new id must reference a different memory entry.',
        recovery: 'Provide the id of the replacement entry.',
        command: 'ctx memory supersede <id> <new-id>',
        code: 2
      }
    };
  }
  const replacement = readMemoryEntry(root, newId);
  if (!replacement) {
    return {
      ok: false,
      error: {
        message: `Replacement memory entry "${newId}" not found`,
        reason: 'The replacement entry must already exist before linking.',
        recovery: 'Add the replacement entry first with `ctx memory add`.',
        command: 'ctx memory add --type decision "<content>"',
        code: 2
      }
    };
  }

  const updated = { ...entry, superseded_by: newId, updated_at: new Date().toISOString() };
  writeJson(memoryPath(root, id), updated);
  return { ok: true, entry: updated };
}

export function listMemory(root, { staleOnly = false } = {}) {
  let entries = listMemoryEntries(root);
  if (staleOnly) entries = entries.filter((entry) => entry.stale === true);
  return entries;
}
