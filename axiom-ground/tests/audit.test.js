import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { scoreAudit } from '../src/audit/index.js';

const CLI = path.resolve('src/cli/main.js');

function runCtx(args, cwd) {
  return spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-audit-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'audit-fixture',
    scripts: { test: 'node --test', build: 'node build.js' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Audit Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'main.js'), 'console.log("hello")\n');
  writeFileSync(path.join(dir, 'tests.spec.js'), 'test("ok", () => {});\n');
  return dir;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function snapshot(repo) {
  const result = runCtx(['snapshot'], repo);
  assert.equal(result.status, 0, result.stderr);
}

function latestAudit(repo) {
  const auditDir = path.join(repo, '.contextlock', 'audits');
  const files = readdirSync(auditDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({ file, mtime: statSync(path.join(auditDir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  assert.ok(files.length > 0, 'expected an audit artifact');
  return readJson(path.join(auditDir, files[0].file));
}

test('ctx audit --since-last reports documentation drift for README/package mismatch', () => {
  const repo = makeRepo();
  assert.equal(runCtx(['init', '--yes'], repo).status, 0);
  snapshot(repo);
  writeFileSync(path.join(repo, 'notes.md'), 'docs change\n');
  snapshot(repo);

  const auditResult = runCtx(['audit', '--since-last'], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);
  assert.match(auditResult.stdout, /Created audit audit_/);

  const audit = latestAudit(repo);
  assert.equal(audit.artifact_type, 'audit');
  assert.equal(audit.scoring_version, 1);
  assert.ok(audit.findings.some((finding) => finding.id === 'readme-command-mismatch'));
  assert.ok(audit.findings.some((finding) => finding.category === 'documentation_drift'));
  assert.ok(audit.final_drift_score > 0);
});

test('ctx audit detects source changes without tests', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  snapshot(repo);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("changed")\n');
  snapshot(repo);

  const auditResult = runCtx(['audit', '--since-last'], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);

  const audit = latestAudit(repo);
  assert.ok(audit.findings.some((finding) => finding.id === 'source-test-coupling'));
  assert.ok(audit.findings.some((finding) => finding.category === 'test_drift'));
});

test('ctx audit detects debt drift and stale prompts', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  snapshot(repo);
  runCtx(['prompt', 'onboarding'], repo);

  writeFileSync(path.join(repo, 'README.md'), '# Audit Fixture\n\nRun `npm test`.\n\nTODO: track more work\n');
  snapshot(repo);

  const auditResult = runCtx(['audit', '--since-last'], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);

  const audit = latestAudit(repo);
  assert.ok(audit.findings.some((finding) => finding.id === 'debt-drift'));
  assert.ok(audit.findings.some((finding) => finding.id === 'stale-prompt'));
  assert.ok(audit.stale_prompts.includes('onboarding'));
});

test('scoreAudit is null-safe and supports config-driven severity weights', () => {
  assert.deepEqual(scoreAudit(null), { final_drift_score: 0, score_breakdown: [] });
  assert.deepEqual(scoreAudit(undefined), { final_drift_score: 0, score_breakdown: [] });

  const result = scoreAudit([
    { id: 'high-risk', severity: 'high', category: 'test', title: 'High risk' },
    { id: 'stale', severity: 'low', category: 'prompt_drift', title: 'Stale prompt' }
  ], {
    audit: {
      severity_weights: {
        high: 30,
        low: 4,
        stale_prompt: 9
      }
    }
  });

  assert.equal(result.final_drift_score, 43);
  assert.ok(result.score_breakdown.some((item) => item.id === 'stale-prompt-bonus' && item.contribution === 9));
});

test('ctx audit --format=json emits parseable machine-readable audit artifact', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  snapshot(repo);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("json audit")\n');
  snapshot(repo);

  const auditResult = runCtx(['audit', '--since-last', '--format', 'json'], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);
  const audit = JSON.parse(auditResult.stdout);
  assert.equal(audit.schema_version, 1);
  assert.equal(audit.artifact_type, 'audit');
  assert.equal(audit.scoring_version, 1);
  assert.equal(audit.scoring_model, 'weighted_heuristic');
  assert.ok(Array.isArray(audit.findings));
});
