import { existsSync, readFileSync, statSync } from 'node:fs';
import { MAX_TEXT_BYTES } from './core.js';

export function extractDocsFiles(files) {
  return files.filter((file) => {
    const lower = file.toLowerCase();
    return lower.startsWith('docs/') || lower.endsWith('.md') || file.split('/').pop().toLowerCase().startsWith('readme');
  }).sort((a, b) => a.localeCompare(b));
}

export function isBinaryBuffer(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function normalizeTextContent(text) {
  if (!text.includes('\r')) return text;
  // Single-pass replacement for both \\r\\n and lone \\r
  return text.replace(/\r\n?/g, '\n');
}

export function readTextOrNull(fullPath, sensitive = false) {
  const stat = statSync(fullPath);
  if (stat.size > MAX_TEXT_BYTES) return null;
  const buffer = readFileSync(fullPath);
  if (sensitive) return '[REDACTED]';
  if (isBinaryBuffer(buffer)) return null;
  return normalizeTextContent(buffer.toString('utf8'));
}

export function classifyFile(relPath) {
  const lower = relPath.toLowerCase();
  if (lower.startsWith('docs/') || lower.endsWith('.md') || relPath.split('/').pop().toLowerCase().startsWith('readme')) return 'docs';
  if (lower.startsWith('test/') || lower.startsWith('tests/') || /\.(test|spec)\./.test(lower)) return 'test';
  if (
    lower === 'package.json' ||
    lower === 'pyproject.toml' ||
    lower === 'requirements.txt' ||
    lower === 'cargo.toml' ||
    lower === 'go.mod' ||
    lower === '.github/pull_request_template.md' ||
    lower.startsWith('.github/')
  ) return 'config';
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|bz2|xz|so|dll|exe|class|jar)$/.test(lower)) return 'binary';
  return 'source';
}
