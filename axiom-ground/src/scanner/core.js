import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { normalizePosix, fastCompare } from '../utils/core.js';

export const DEFAULT_EXCLUDES = [
  '.git/**',
  '.contextlock/**',
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  'vendor/**',
  'target/**'
];

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MAX_GLOB_LENGTH = 512;
const MAX_BRACE_DEPTH = 3;

function globToRegExp(pattern, depth = 0) {
  if (pattern.length > MAX_GLOB_LENGTH) {
    return new RegExp(`^${escapeRegex(pattern)}$`);
  }

  let regex = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (ch === '\\' && i + 1 < pattern.length) {
      regex += escapeRegex(pattern[i + 1]);
      i += 1;
      continue;
    }

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        if (pattern[i + 1] === '/') {
          i += 1;
          regex += '(?:.*?/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (ch === '?') {
      regex += '[^/]';
      continue;
    }

    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end !== -1) {
        let bracketContent = pattern.slice(i + 1, end);
        if (bracketContent.startsWith('!')) {
          bracketContent = '^' + bracketContent.slice(1);
        }
        bracketContent = bracketContent.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
        regex += `[${bracketContent}]`;
        i = end;
        continue;
      }
      regex += escapeRegex(ch);
      continue;
    }

    if (ch === '{') {
      const end = findMatchingBrace(pattern, i);
      if (end !== -1 && depth < MAX_BRACE_DEPTH) {
        const inner = pattern.slice(i + 1, end);
        const parts = splitBraceAlternatives(inner).map(
          (p) => globToRegExp(p, depth + 1).source.replace(/^\^|\$$/g, '')
        );
        regex += `(?:${parts.join('|')})`;
        i = end;
        continue;
      }
      regex += escapeRegex(ch);
      continue;
    }

    regex += escapeRegex(ch);
  }
  regex += '$';
  return new RegExp(regex);
}

function findMatchingBrace(pattern, start) {
  let depth = 0;
  for (let i = start; i < pattern.length; i += 1) {
    if (pattern[i] === '\\' && i + 1 < pattern.length) { i += 1; continue; }
    if (pattern[i] === '{') depth += 1;
    if (pattern[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitBraceAlternatives(str) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < str.length; i += 1) {
    if (str[i] === '\\' && i + 1 < str.length) { current += str[i] + str[i + 1]; i += 1; continue; }
    if (str[i] === '{') depth += 1;
    if (str[i] === '}') depth -= 1;
    if (str[i] === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += str[i];
    }
  }
  if (current) parts.push(current);
  return parts;
}

const GLOB_REGEX_CACHE = new Map();
const EXCLUDER_CACHE = new Map();

function canonicalizePatterns(patterns) {
  const sorted = [...patterns].sort();
  return sorted.join('\0');
}

export function normalizeGlobPattern(pattern) {
  const glob = normalizePosix(String(pattern || '').replace(/\\/g, '/'))
    .replace(/^\.\//, '')
    .replace(/\/+$|^\/+$/g, '');
  if (!glob) return '**/*';
  if (glob.endsWith('/**')) return glob;
  if (!glob.includes('*') && !path.extname(glob)) return `${glob}/**`;
  return glob;
}

function combineRegexes(regexes) {
  if (!regexes.length) return null;
  const source = regexes.map((re) => re.source.slice(1, -1)).join('|');
  return new RegExp(`^(?:${source})$`);
}

export function compileExcluder(patterns) {
  if (patterns && typeof patterns.isExcluded === 'function') {
    return patterns;
  }
  const key = patterns.join('\0');
  let cached = EXCLUDER_CACHE.get(key);
  if (cached) return cached;

  const prefixes = [];
  const regexes = [];
  for (const pattern of patterns) {
    const glob = normalizeGlobPattern(pattern);
    if (glob.endsWith('/**')) {
      prefixes.push(glob.slice(0, -3));
    } else {
      let re = GLOB_REGEX_CACHE.get(glob);
      if (!re) {
        re = globToRegExp(glob);
        GLOB_REGEX_CACHE.set(glob, re);
      }
      regexes.push(re);
    }
  }

  const prefixRe = prefixes.length
    ? new RegExp(`^(?:${prefixes.map(escapeRegex).join('|')})(?:$|/)`)
    : null;
  const regexRe = combineRegexes(regexes);

  cached = {
    canonicalKey: canonicalizePatterns(patterns),
    isExcluded(relPath) {
      const normalized = normalizePosix(relPath);
      if (prefixRe && prefixRe.test(normalized)) return true;
      if (regexRe && regexRe.test(normalized)) return true;
      return false;
    }
  };
  EXCLUDER_CACHE.set(key, cached);
  return cached;
}

export function isExcluded(relPath, patterns) {
  const excluder = compileExcluder(patterns);
  return excluder.isExcluded(relPath);
}

export function walkFiles(root, patterns) {
  const files = [];
  const excluder = compileExcluder(patterns);

  function visit(dir, relDir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (excluder.isExcluded(rel)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  visit(root, '');
  return files.sort((a, b) => fastCompare(a, b));
}
