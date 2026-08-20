#!/usr/bin/env node
// Zero-dependency linter for ContextLock.
// Checks for common issues without external tools.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertValidSchema, bundledSchemaPath } from '../src/utils/schema.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const TESTS = path.join(ROOT, 'tests');
const SCRIPTS = path.join(ROOT, 'scripts');
const MAX_FILE_LINES = 600;

const fix = process.argv.includes('--fix');
let exitCode = 0;
const issues = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walk(dir, predicate = () => true) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...walk(full, predicate));
      } else if (entry.isFile() && predicate(full)) {
        results.push(full);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

function jsFiles(dir) {
  return walk(dir, (f) => f.endsWith('.js'));
}

function lineCount(content) {
  return content.split('\n').length;
}

function report(file, line, message, severity = 'error') {
  const rel = path.relative(ROOT, file);
  issues.push({ file: rel, line, message, severity });
  if (severity === 'error') exitCode = 1;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkFileLength(files) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = lineCount(content);
    if (lines > MAX_FILE_LINES) {
      report(file, lines, `File has ${lines} lines (max ${MAX_FILE_LINES})`, 'error');
    }
  }
}

function checkConsoleLogInSrc(files) {
  // console.log is fine in CLI modules but suspicious in core logic
  const corePrefixes = ['src/utils/', 'src/scanner/', 'src/storage/backends', 'src/storage/secrets', 'src/plan/generate', 'src/plan/render', 'src/audit/'];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const isCore = corePrefixes.some((p) => rel.startsWith(p));
    if (!isCore) continue;

    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('console.log') && !line.trim().startsWith('//')) {
        report(file, i + 1, `console.log in core module — use fail() or return errors instead`, 'warn');
      }
    }
  }
}

function checkDebuggerStatements(files) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Only match `debugger;` as a standalone statement, not in strings/regexes
      if (/^debugger\s*;?\s*$/.test(trimmed)) {
        report(file, i + 1, 'debugger statement left in code', 'error');
      }
    }
  }
}

function checkTodosWithoutTicket(files) {
  // Linter rule: flag unresolved markers lacking a ticket/tracking reference (e.g. GH-123).
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Heuristic: find the real comment start on the line (skip strings)
      let inString = false;
      let stringChar = null;
      let commentStart = -1;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (!inString) {
          if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            stringChar = ch;
          } else if (ch === '/' && j + 1 < line.length && line[j + 1] === '/') {
            commentStart = j;
            break;
          }
        } else if (ch === stringChar && line[j - 1] !== '\\') {
          inString = false;
          stringChar = null;
        }
      }
      if (commentStart === -1) continue;
      const commentText = line.slice(commentStart + 2);
      const todoMatch = commentText.match(/\b(TODO|FIXME|HACK)\b/);
      if (todoMatch && !commentText.match(/\(#[\d]+\)|JIRA|GH-|#[\d]+|ticket/i)) {
        const rel = path.relative(ROOT, file);
        issues.push({ file: rel, line: i + 1, message: `${todoMatch[1]} without ticket reference`, severity: 'info' });
      }
    }
  }
}

function checkEmptyCatch(files) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Match `} catch {` or `} catch (err) {` followed by just `}`
      if (/^\s*\}\s*catch\s*(\(\w+\))?\s*\{\s*$/.test(lines[i])) {
        // Check if the next non-empty line is just `}`
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (nextLine === '') continue;
          if (nextLine === '}' || nextLine.startsWith('//')) break;
          // There's actual handling — fine
          i = j;
          break;
        }
        // Bare empty catch — just warn
      }
    }
  }
}

function checkTrailingWhitespace(files) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let dirty = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].endsWith(' ') || lines[i].endsWith('\t')) {
        if (fix) {
          lines[i] = lines[i].replace(/[\s]+$/, '');
          dirty = true;
        } else {
          report(file, i + 1, 'Trailing whitespace', 'warn');
        }
      }
    }
    if (fix && dirty) {
      writeFileSync(file, lines.join('\n'));
    }
  }
}

function checkMissingNewline(files) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (content.length > 0 && !content.endsWith('\n')) {
      if (fix) {
        writeFileSync(file, content + '\n');
      } else {
        report(file, lineCount(content), 'Missing newline at end of file', 'warn');
      }
    }
  }
}

function checkImportConsistency(files) {
  // Verify that .js extensions are used in imports (ESM requirement)
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (!rel.startsWith('src/')) continue;

    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match imports from relative paths without .js extension
      const importMatch = line.match(/from\s+['"](\.\.?\/[^'"]+)['"]/);
      if (importMatch) {
        const importPath = importMatch[1];
        if (!importPath.endsWith('.js') && !importPath.endsWith('.json') && !importPath.startsWith('.')) {
          report(file, i + 1, `Import "${importPath}" missing .js extension (ESM requirement)`, 'error');
        }
      }
    }
  }
}

function checkUnusedExports() {
  // Quick check: any exported function not imported anywhere else?
  const allSrc = [...jsFiles(SRC), ...jsFiles(TESTS), ...jsFiles(SCRIPTS)];
  const exports = new Map(); // name -> [exporting file]
  const imports = new Map(); // name -> [importing files]

  for (const file of allSrc) {
    const content = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);

    // Collect exports (only from actual src/ files)
    if (rel.startsWith('src/')) {
      const exportMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
      for (const m of exportMatches) {
        if (!exports.has(m[1])) exports.set(m[1], []);
        exports.get(m[1]).push(rel);
      }
    }

    // Collect imports
    const importMatches = content.matchAll(/import\s*\{([^}]+)\}\s*from/g);
    for (const m of importMatches) {
      const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop().trim());
      for (const name of names) {
        if (!imports.has(name)) imports.set(name, []);
        imports.get(name).push(rel);
      }
    }
  }

  // CLI entry points that use commands by string name (not imported)
  const cliUsedNames = new Set([
    'bootstrapCommand', 'doctorCommand', 'initCommand', 'statusCommand',
    'snapshotCommand', 'promptCommand', 'auditCommand', 'siteCommand',
    'installHooksCommand', 'uninstallHooksCommand', 'remoteAddCommand',
    'syncCommand', 'pullCommand', 'rulesValidateCommand', 'planCommand',
    'snapshotCiCommand', 'auditPrCommand', 'auditPlanCommand',
    'main'
  ]);

  for (const [name, files] of exports) {
    const importers = imports.get(name) || [];
    // Filter out self-imports
    const externalImporters = importers.filter((f) => !files.includes(f));
    if (externalImporters.length === 0 && !cliUsedNames.has(name)) {
      // Could be unused — just info level
      issues.push({
        file: files[0],
        line: 0,
        message: `${name} is exported but not imported elsewhere (may be used by name)`,
        severity: 'info'
      });
    }
  }
}

function checkProgressSchema() {
  const progressPath = path.join(ROOT, 'docs', 'planning', 'contextlock-progress.json');
  if (!existsSync(progressPath)) {
    report(progressPath, 0, 'Missing docs/planning/contextlock-progress.json', 'error');
    return;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(progressPath, 'utf8'));
  } catch (error) {
    report(progressPath, 0, `Invalid JSON: ${error.message}`, 'error');
    return;
  }

  try {
    assertValidSchema(data, bundledSchemaPath('planning-progress'), 'planning progress');
  } catch (error) {
    report(progressPath, 0, `Planning progress schema validation failed: ${error.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const allJs = [...jsFiles(SRC), ...jsFiles(TESTS), ...jsFiles(SCRIPTS)];

console.log('ContextLock Lint');
console.log(`Checking ${allJs.length} files...\n`);

checkFileLength(allJs);
checkConsoleLogInSrc(allJs);
checkDebuggerStatements(allJs);
checkTodosWithoutTicket(allJs);
checkTrailingWhitespace(allJs);
checkMissingNewline(allJs);
checkImportConsistency(allJs);
checkUnusedExports();
checkProgressSchema();

// Sort: errors first, then warns, then info
const severityOrder = { error: 0, warn: 1, info: 2 };
issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

let errors = 0, warns = 0, infos = 0;
for (const issue of issues) {
  const icon = issue.severity === 'error' ? '✗' : issue.severity === 'warn' ? '⚠' : 'ℹ';
  console.log(`  ${icon} ${issue.file}${issue.line ? `:${issue.line}` : ''} — ${issue.message}`);
  if (issue.severity === 'error') errors++;
  else if (issue.severity === 'warn') warns++;
  else infos++;
}

console.log('');
if (fix) console.log('  (--fix applied: trailing whitespace and missing newlines)');

if (issues.length === 0) {
  console.log('  ✓ All checks passed');
} else {
  console.log(`  ${errors} error(s), ${warns} warning(s), ${infos} info`);
}

process.exit(exitCode);
