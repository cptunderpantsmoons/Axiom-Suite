import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, readJsonIfExists, sha256, writeJson } from '../utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../utils/schema.js';
import { classifyFile, normalizeTextContent, parsePackageJson } from '../scanner/index.js';
import { fingerprintKeys, listSnapshotArtifacts, loadSnapshotArtifact } from '../snapshot/index.js';
import { readPromptMetadata } from '../prompts/index.js';
import { evaluateRules, applySuppressions } from '../rules/index.js';

// ---------------------------------------------------------------------------
// Snapshot diffing
// ---------------------------------------------------------------------------

function diffSnapshots(prev, curr) {
  const keys = new Set([...fingerprintKeys(prev), ...fingerprintKeys(curr)]);
  const changed = [];
  const added = [];
  const removed = [];

  for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
    const before = prev?.content_fingerprints?.[key] || null;
    const after = curr?.content_fingerprints?.[key] || null;
    if (before === after) continue;
    if (before && after) {
      changed.push({ file: key, before, after });
    } else if (after) {
      added.push({ file: key, after });
    } else {
      removed.push({ file: key, before });
    }
  }

  return { changed, added, removed };
}

function markerCounts(snapshot) {
  const counts = { TODO: 0, FIXME: 0, HACK: 0 };
  for (const marker of snapshot?.debt_markers || []) {
    const key = marker.marker && counts[marker.marker] !== undefined ? marker.marker : null;
    if (key) counts[key] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Finding factory
// ---------------------------------------------------------------------------

function makeFinding(id, severity, category, title, evidence, recommendation, confidence = 'medium', evidenceType = 'factual') {
  return {
    id,
    severity,
    category,
    title,
    evidence,
    recommendation,
    confidence,
    evidence_type: evidenceType
  };
}

// ---------------------------------------------------------------------------
// Audit finding builders
// ---------------------------------------------------------------------------

export function buildAuditFindings(root, prev, curr, config = null) {
  const findings = [];
  const diff = diffSnapshots(prev, curr);
  const sourceChanged = [...diff.changed, ...diff.added, ...diff.removed].some((item) => classifyFile(item.file) === 'source');
  const testChanged = [...diff.changed, ...diff.added, ...diff.removed].some((item) => classifyFile(item.file) === 'test');

  // 1. Source changed without tests
  if (sourceChanged && !testChanged) {
    findings.push(makeFinding(
      'source-test-coupling',
      'medium',
      'test_drift',
      'Source changed without corresponding test changes',
        [...new Set([...diff.changed, ...diff.added, ...diff.removed]
          .filter((item) => classifyFile(item.file) === 'source')
          .map((item) => item.file))].map((file) => ({ file })),
        'Add or update tests covering the changed source behavior.',
      'high'
    ));
  }

  // 2. README/package.json command mismatch
  const packageJson = parsePackageJson(root);
  const readmePath = path.join(root, 'README.md');
  if (packageJson?.scripts?.test && existsSync(readmePath)) {
    const readmeText = normalizeTextContent(readFileSync(readmePath, 'utf8'));
    if (readmeText.includes('npm test') && !String(packageJson.scripts.test).includes('npm test')) {
      findings.push(makeFinding(
        'readme-command-mismatch',
        'medium',
        'documentation_drift',
        'README test command does not match package script',
        [
          { file: 'README.md', text: 'Run npm test' },
          { file: 'package.json', text: `"test": "${packageJson.scripts.test}"` }
        ],
        'Update README or package.json so the documented test command is correct.',
        'high'
      ));
    }
  }

  // 3. Dependency drift
  const prevDeps = new Set(prev?.machine_facts?.dependencies || []);
  const currDeps = new Set(curr?.machine_facts?.dependencies || []);
  const depAdded = [...currDeps].filter((dep) => !prevDeps.has(dep));
  const depRemoved = [...prevDeps].filter((dep) => !currDeps.has(dep));
  if (depAdded.length || depRemoved.length) {
    findings.push(makeFinding(
      'dependency-drift',
      'medium',
      'dependency_drift',
      'Dependencies changed between snapshots',
      [
        { file: 'package.json', text: `added: ${depAdded.join(', ') || 'none'}` },
        { file: 'package.json', text: `removed: ${depRemoved.join(', ') || 'none'}` }
      ],
      'Review dependency impact and update docs or lockfiles as needed.',
      'medium'
    ));
  }

  // 4. Debt drift
  const prevDebt = markerCounts(prev);
  const currDebt = markerCounts(curr);
  const debtDelta = Object.keys(currDebt).reduce((sum, key) => sum + (currDebt[key] - prevDebt[key]), 0);
  if (debtDelta > 0) {
    findings.push(makeFinding(
      'debt-drift',
      'low',
      'debt_drift',
      'Debt markers increased',
      curr.debt_markers.slice(-3).map((marker) => ({ file: marker.file, line: marker.line, text: marker.text })),
      'Review the new TODO/FIXME/HACK markers and decide whether they should be resolved or tracked.',
      'medium'
    ));
  }

  // 5. Stale prompt
  const prevHadPrompt = Boolean(prev && readPromptMetadata(root, prev?.snapshot_hash, 'onboarding'));
  const currHasPrompt = Boolean(readPromptMetadata(root, curr?.snapshot_hash, 'onboarding'));
  if (prev?.snapshot_hash && prev.snapshot_hash !== curr?.snapshot_hash && prevHadPrompt && !currHasPrompt) {
    findings.push(makeFinding(
      'stale-prompt',
      'low',
      'prompt_drift',
      'Onboarding prompt is stale for the latest snapshot',
      [
        { file: path.join('.contextlock', 'prompts', prev.snapshot_hash, 'onboarding', 'onboarding.md'), text: 'prompt compiled for previous snapshot' },
        { file: path.join('.contextlock', 'snapshots', `${curr.snapshot_hash}.json`), text: 'latest snapshot has no matching onboarding prompt' }
      ],
      'Regenerate the onboarding prompt for the latest snapshot.',
      'high'
    ));
  }

  // --- Rule evaluation ---
  if (config) {
    const ruleResult = evaluateRules(root, config, curr);
    if (ruleResult.findings.length) {
      // Apply suppressions
      const suppressions = config?.suppressions || [];
      const { active, expired } = applySuppressions(ruleResult.findings, suppressions);
      findings.push(...active);
      findings.push(...expired);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const DEFAULT_SEVERITY_WEIGHTS = {
  high: 25,
  medium: 10,
  low: 3,
  stale_prompt: 8,
  expired_suppression: 15
};

function resolveSeverityWeights(config = null) {
  const overrides = config?.audit?.severity_weights && typeof config.audit.severity_weights === 'object'
    ? config.audit.severity_weights
    : {};
  return { ...DEFAULT_SEVERITY_WEIGHTS, ...overrides };
}

/**
 * Compute the drift score as a transparent, configurable weighted heuristic.
 * This is NOT a statistical measurement — each finding contributes a fixed
 * weight (overridable via config.audit.severity_weights) and the sum is capped
 * at 100. Use it as a relative drift indicator, not an absolute metric.
 */
export function scoreAudit(findings, config = null) {
  const safeFindings = Array.isArray(findings) ? findings.filter(Boolean) : [];
  const weights = resolveSeverityWeights(config);
  const breakdown = [];
  let total = 0;

  for (const finding of safeFindings) {
    let contribution = 0;
    if (finding.severity === 'high') contribution = Number(weights.high) || 0;
    else if (finding.severity === 'medium') contribution = Number(weights.medium) || 0;
    else if (finding.severity === 'low') contribution = Number(weights.low) || 0;
    breakdown.push({ id: finding.id, contribution, reason: finding.title });
    total += contribution;
  }

  const stalePromptCount = safeFindings.filter((finding) => finding.category === 'prompt_drift').length;
  if (stalePromptCount) {
    const contribution = stalePromptCount * (Number(weights.stale_prompt) || 0);
    breakdown.push({ id: 'stale-prompt-bonus', contribution, reason: 'stale prompt' });
    total += contribution;
  }

  return { final_drift_score: Math.min(100, total), score_breakdown: breakdown };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderAuditMarkdown(audit) {
  const lines = [];
  lines.push(`# ContextLock Audit`);
  lines.push('');
  lines.push(`- Audit ID: ${audit.audit_id}`);
  lines.push(`- From snapshot: ${audit.from_snapshot}`);
  lines.push(`- To snapshot: ${audit.to_snapshot}`);
  lines.push(`- Drift score: ${audit.final_drift_score}/100`);
  lines.push('');
  lines.push('## Findings');
  if (!audit.findings.length) {
    lines.push('- No meaningful drift detected.');
  } else {
    for (const finding of audit.findings) {
      lines.push(`- **${finding.title}** (${finding.severity})`);
      for (const evidence of finding.evidence) {
        lines.push(`  - ${evidence.file}${evidence.line ? `:${evidence.line}` : ''} ${evidence.text || ''}`.trim());
      }
    }
  }
  lines.push('');
  lines.push('## Score breakdown');
  for (const item of audit.score_breakdown) {
    lines.push(`- ${item.id}: +${item.contribution}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function writeAuditArtifacts(root, audit) {
  assertValidSchema(audit, bundledSchemaPath('audit'), 'audit');
  const dir = path.join(root, '.contextlock', 'audits');
  ensureDir(dir);
  const base = `${audit.from_snapshot}_to_${audit.to_snapshot}`;
  const jsonPath = path.join(dir, `${base}.json`);
  const mdPath = path.join(dir, `${base}.md`);
  writeJson(jsonPath, audit);
  writeFileSync(mdPath, `${renderAuditMarkdown(audit)}\n`);
  return { jsonPath, mdPath };
}

// ---------------------------------------------------------------------------
// Audit lookup
// ---------------------------------------------------------------------------

export function latestAuditArtifact(root, lock) {
  if (lock?.latest_audit_id) {
    const dir = path.join(root, '.contextlock', 'audits');
    if (existsSync(dir)) {
      const match = readdirSync(dir).find((file) => file.endsWith('.json') && readJsonIfExists(path.join(dir, file))?.audit_id === lock.latest_audit_id);
      if (match) return readJsonIfExists(path.join(dir, match));
    }
  }

  const dir = path.join(root, '.contextlock', 'audits');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({ file, mtime: statSync(path.join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
  if (!files.length) return null;
  return readJsonIfExists(path.join(dir, files[0].file));
}

export function chooseAuditPair(root, lock, args) {
  const fromIndex = args.indexOf('--from');
  const toIndex = args.indexOf('--to');
  if (fromIndex !== -1 || toIndex !== -1) {
    const fromHash = fromIndex !== -1 ? args[fromIndex + 1] : null;
    const toHash = toIndex !== -1 ? args[toIndex + 1] : null;
    return { fromHash, toHash };
  }

  const snapshots = listSnapshotArtifacts(root);
  const toHash = lock?.latest_snapshot_hash || snapshots[0]?.hash || null;
  const fromHash = snapshots.find((item) => item.hash !== toHash)?.hash || null;
  return { fromHash, toHash };
}
