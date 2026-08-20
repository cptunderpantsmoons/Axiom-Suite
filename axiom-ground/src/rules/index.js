import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizePosix, readJsonIfExists, resolveGitRoot, fail } from '../utils/core.js';
import { isExcluded, normalizeTextContent, walkFiles, DEFAULT_EXCLUDES } from '../scanner/index.js';

// ---------------------------------------------------------------------------
// Rule schema & validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const VALID_RULE_TYPES = ['forbid_imports', 'require_files'];

function validateRule(rule, index) {
  const errors = [];

  if (!rule.id || typeof rule.id !== 'string') {
    errors.push(`rule[${index}]: "id" is required and must be a string`);
  }
  if (!rule.description || typeof rule.description !== 'string') {
    errors.push(`rule[${index}]: "description" is required and must be a string`);
  }
  if (!rule.severity || !VALID_SEVERITIES.includes(rule.severity)) {
    errors.push(`rule[${index}]: "severity" must be one of ${VALID_SEVERITIES.join(', ')}`);
  }
  if (!Array.isArray(rule.match) || rule.match.length === 0) {
    errors.push(`rule[${index}]: "match" is required and must be a non-empty array of glob patterns`);
  } else {
    for (let i = 0; i < rule.match.length; i += 1) {
      if (typeof rule.match[i] !== 'string') {
        errors.push(`rule[${index}].match[${i}]: must be a string glob pattern`);
      }
    }
  }

  const ruleTypes = VALID_RULE_TYPES.filter((t) => Array.isArray(rule[t]));
  if (ruleTypes.length === 0) {
    errors.push(`rule[${index}]: must define at least one of: ${VALID_RULE_TYPES.join(', ')}`);
  }

  // Validate forbid_imports patterns
  if (Array.isArray(rule.forbid_imports)) {
    for (let i = 0; i < rule.forbid_imports.length; i += 1) {
      if (typeof rule.forbid_imports[i] !== 'string') {
        errors.push(`rule[${index}].forbid_imports[${i}]: must be a string glob pattern`);
      }
    }
  }

  // Validate require_files patterns
  if (Array.isArray(rule.require_files)) {
    for (let i = 0; i < rule.require_files.length; i += 1) {
      if (typeof rule.require_files[i] !== 'string') {
        errors.push(`rule[${index}].require_files[${i}]: must be a string file path`);
      }
    }
  }

  return errors;
}

function validateRules(rules) {
  if (!Array.isArray(rules)) return ['rules must be an array'];
  const errors = [];
  for (let i = 0; i < rules.length; i += 1) {
    errors.push(...validateRule(rules[i], i));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(filePath, content) {
  const imports = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNum = i + 1;

    // JS/TS: import ... from '...'
    let match = line.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
    if (match) {
      imports.push({ line: lineNum, text: line.trim(), source: match[1], type: 'esm-import' });
      continue;
    }

    // JS/TS: import('...')
    match = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (match) {
      imports.push({ line: lineNum, text: line.trim(), source: match[1], type: 'dynamic-import' });
      continue;
    }

    // JS: require('...')
    match = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (match) {
      imports.push({ line: lineNum, text: line.trim(), source: match[1], type: 'require' });
      continue;
    }

    // Python: from ... import ...
    match = line.match(/from\s+([^\s]+)\s+import\s+/);
    if (match) {
      imports.push({ line: lineNum, text: line.trim(), source: match[1], type: 'python-from' });
      continue;
    }

    // Python: import ...
    match = line.match(/^import\s+([^\s#]+)/);
    if (match) {
      imports.push({ line: lineNum, text: line.trim(), source: match[1], type: 'python-import' });
      continue;
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Path matching for rules
// ---------------------------------------------------------------------------

function matchesRulePath(filePath, patterns) {
  const normalized = normalizePosix(filePath);
  return patterns.some((pattern) => {
    const glob = pattern.replace(/\\/g, '/');
    // Simple glob matching: ** matches anything, * matches within a segment
    const regex = new RegExp(
      '^' + glob
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '___DOUBLESTAR___')
        .replace(/\*/g, '[^/]*')
        .replace(/___DOUBLESTAR___/g, '.*')
      + '$'
    );
    return regex.test(normalized);
  });
}

// ---------------------------------------------------------------------------
// Import path resolution (for forbid_imports)
// ---------------------------------------------------------------------------

function resolvesToForbidden(importSource, filePath, forbiddenPatterns) {
  // importSource might be relative ('../db/client') or absolute ('src/db/client')
  const fileDir = path.dirname(filePath).replace(/\\/g, '/');

  // Resolve relative imports to absolute paths
  let resolved = importSource;
  if (importSource.startsWith('.')) {
    resolved = normalizePosix(path.join(fileDir, importSource));
  }

  // Check if resolved path matches any forbidden pattern
  return matchesRulePath(resolved, forbiddenPatterns);
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

export function evaluateRules(root, config, snapshot) {
  const rules = config?.architecture_rules || [];
  if (!rules.length) return { findings: [], errors: [] };

  // Validate rules first
  const validationErrors = validateRules(rules);
  if (validationErrors.length) {
    return { findings: [], errors: validationErrors };
  }

  const findings = [];
  const excludePatterns = Array.isArray(config?.exclude) ? config.exclude : DEFAULT_EXCLUDES;
  const trackedFiles = snapshot?.machine_facts
    ? [...(snapshot.content_fingerprints ? Object.keys(snapshot.content_fingerprints) : []),
       ...(snapshot.machine_facts.entrypoints || []),
       ...(snapshot.machine_facts.docs_files || [])]
    : [];

  for (const rule of rules) {
    // Find files matching the rule's match patterns
    const matchingFiles = [];
    if (trackedFiles.length) {
      for (const file of trackedFiles) {
        if (matchesRulePath(file, rule.match) && !isExcluded(file, excludePatterns)) {
          matchingFiles.push(file);
        }
      }
    } else {
      // Fall back to walking the filesystem
      const allFiles = walkFiles(root, excludePatterns);
      for (const file of allFiles) {
        if (matchesRulePath(file, rule.match)) {
          matchingFiles.push(file);
        }
      }
    }

    // Evaluate forbid_imports
    if (Array.isArray(rule.forbid_imports) && rule.forbid_imports.length) {
      for (const file of matchingFiles) {
        const fullPath = path.join(root, file);
        if (!existsSync(fullPath)) continue;

        try {
          const content = normalizeTextContent(readFileSync(fullPath, 'utf8'));
          const imports = extractImports(fullPath, content);

          for (const imp of imports) {
            if (resolvesToForbidden(imp.source, file, rule.forbid_imports)) {
              findings.push({
                id: `rule:${rule.id}:${file}:${imp.line}`,
                severity: rule.severity,
                category: 'architecture_rule',
                title: rule.description,
                evidence: [{
                  file,
                  line: imp.line,
                  text: imp.text
                }],
                recommendation: `Remove or refactor the forbidden import of "${imp.source}" in ${file}.${rule.recommendation ? ` ${rule.recommendation}` : ''}`,
                confidence: 'high',
                evidence_type: 'factual',
                rule_id: rule.id
              });
            }
          }
        } catch {
          // binary or unreadable — skip
        }
      }
    }

    // Evaluate require_files
    if (Array.isArray(rule.require_files) && rule.require_files.length) {
      for (const requiredFile of rule.require_files) {
        const fullPath = path.join(root, requiredFile);
        if (!existsSync(fullPath)) {
          findings.push({
            id: `rule:${rule.id}:missing:${requiredFile}`,
            severity: rule.severity,
            category: 'architecture_rule',
            title: rule.description,
            evidence: [{
              file: requiredFile,
              text: 'File does not exist'
            }],
            recommendation: `Create the required file "${requiredFile}".${rule.recommendation ? ` ${rule.recommendation}` : ''}`,
            confidence: 'high',
            evidence_type: 'factual',
            rule_id: rule.id
          });
        }
      }
    }
  }

  return { findings, errors: [] };
}

// ---------------------------------------------------------------------------
// Suppression model
// ---------------------------------------------------------------------------

function validateSuppressions(suppressions) {
  if (!Array.isArray(suppressions)) return ['suppressions must be an array'];
  const errors = [];
  for (let i = 0; i < suppressions.length; i += 1) {
    const s = suppressions[i];
    if (!s.finding_id || typeof s.finding_id !== 'string') {
      errors.push(`suppressions[${i}]: "finding_id" is required`);
    }
    if (!s.reason || typeof s.reason !== 'string') {
      errors.push(`suppressions[${i}]: "reason" is required`);
    }
    if (!s.expires_at || typeof s.expires_at !== 'string') {
      errors.push(`suppressions[${i}]: "expires_at" is required (ISO 8601 date)`);
    } else if (isNaN(Date.parse(s.expires_at))) {
      errors.push(`suppressions[${i}]: "expires_at" is not a valid date`);
    }
  }
  return errors;
}

export function applySuppressions(findings, suppressions) {
  if (!Array.isArray(suppressions) || !suppressions.length) {
    return { active: findings, suppressed: [], expired: [] };
  }

  const now = new Date();
  const suppressed = [];
  const expired = [];
  const active = [];

  // Build suppression lookup: finding_id → suppression
  const suppressionMap = new Map();
  for (const s of suppressions) {
    suppressionMap.set(s.finding_id, s);
  }

  for (const finding of findings) {
    const suppression = suppressionMap.get(finding.id);

    if (!suppression) {
      active.push(finding);
      continue;
    }

    const expiresAt = new Date(suppression.expires_at);
    if (expiresAt <= now) {
      // Expired suppression → elevated finding
      expired.push({
        ...finding,
        severity: 'high', // Expired suppressions become high severity
        title: `[EXPIRED SUPPRESSION] ${finding.title}`,
        recommendation: `Suppression expired ${suppression.expires_at}. ${finding.recommendation}`,
        evidence: [
          ...finding.evidence,
          { text: `Suppression expired: "${suppression.reason}" (expired ${suppression.expires_at})` }
        ]
      });
    } else {
      suppressed.push({ ...finding, suppression });
    }
  }

  return { active, suppressed, expired };
}

// ---------------------------------------------------------------------------
// CLI: ctx rules validate
// ---------------------------------------------------------------------------

export function rulesValidateCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  if (!existsSync(configPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  const config = readJsonIfExists(configPath);
  const rules = config?.architecture_rules || [];
  const suppressions = config?.suppressions || [];

  if (!rules.length && !suppressions.length) {
    console.log('No architecture rules or suppressions configured.');
    console.log('Add "architecture_rules" and "suppressions" arrays to .contextlock/config.json.');
    return 0;
  }

  if (rules.length) {
    const ruleErrors = validateRules(rules);
    if (ruleErrors.length) {
      return fail('Rule validation failed', {
        reason: ruleErrors.join('; '),
        recovery: 'Fix architecture_rules entries in .contextlock/config.json and retry.',
        command: 'ctx rules validate',
        code: 2
      });
    }
    console.log(`✓ ${rules.length} architecture rule(s) validated`);
    for (const rule of rules) {
      console.log(`  - ${rule.id}: ${rule.description} (${rule.severity})`);
    }
  }

  if (suppressions.length) {
    const suppressionErrors = validateSuppressions(suppressions);
    if (suppressionErrors.length) {
      return fail('Suppression validation failed', {
        reason: suppressionErrors.join('; '),
        recovery: 'Fix suppressions in .contextlock/config.json and retry.',
        command: 'ctx rules validate',
        code: 2
      });
    }
    console.log(`✓ ${suppressions.length} suppression(s) validated`);

    const now = new Date();
    for (const s of suppressions) {
      const expired = new Date(s.expires_at) <= now;
      console.log(`  - ${s.finding_id}: ${expired ? 'EXPIRED' : 'active'} (expires ${s.expires_at})`);
    }
  }

  return 0;
}
