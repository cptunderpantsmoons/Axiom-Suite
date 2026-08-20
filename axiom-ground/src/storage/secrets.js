import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Secret scanning (pre-upload gate)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /\/secrets\//i,
  /\/credentials\//i,
  /\.env\..+/i,
  /^\.env$/i
];

function isSecretPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return SECRET_PATTERNS.some((re) => re.test(normalized));
}

function scanArtifactForSecrets(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const highConfidencePatterns = [
    /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    /gh[pousr]_[A-Za-z0-9_]{20,}/,
    /hf_[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /AIza[0-9A-Za-z\-_]{35}/,
    /sk-[A-Za-z0-9]{24,}/,
    /\b[A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\b\s*=\s*[^\s'\"]+/i,
  ];
  return highConfidencePatterns.filter((re) => re.test(content));
}

export function runSecretScan(root) {
  const ctxDir = path.join(root, '.contextlock');
  if (!existsSync(ctxDir)) return { passed: true, findings: [] };

  const findings = [];
  const scanDir = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(ctxDir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.isFile() && !isSecretPath(rel)) {
        try {
          const matches = scanArtifactForSecrets(full);
          for (const match of matches) {
            findings.push({ file: rel, pattern: match.source });
          }
        } catch {
          // binary or unreadable — skip
        }
      }
    }
  };
  scanDir(ctxDir);

  return { passed: findings.length === 0, findings };
}

// ---------------------------------------------------------------------------
// Retry queue
// ---------------------------------------------------------------------------

import { ensureDir, readJsonIfExists, writeJson } from '../utils/core.js';

function retryQueuePath(root) {
  return path.join(root, '.contextlock', 'queue', 'retry.json');
}

export function enqueueRetry(root, paths) {
  const queuePath = retryQueuePath(root);
  ensureDir(path.dirname(queuePath));
  const existing = readJsonIfExists(queuePath) || { pending_uploads: [], last_error: null, next_retry_after: null };
  const merged = [...new Set([...existing.pending_uploads, ...paths])].sort((a, b) => a.localeCompare(b));
  writeJson(queuePath, {
    ...existing,
    pending_uploads: merged,
    last_error: 'sync failed',
    next_retry_after: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  });
}

export function clearRetryQueue(root) {
  const queuePath = retryQueuePath(root);
  if (existsSync(queuePath)) {
    writeJson(queuePath, { pending_uploads: [], last_error: null, next_retry_after: null });
  }
}

export function getRetryQueue(root) {
  const queuePath = retryQueuePath(root);
  if (!existsSync(queuePath)) return [];
  const data = readJsonIfExists(queuePath);
  if (!data || !Array.isArray(data.pending_uploads)) return [];
  return data.pending_uploads;
}
