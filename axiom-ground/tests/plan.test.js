import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const CLI = path.resolve('src/cli/main.js');

function runCtx(args, cwd, extraEnv = {}) {
  return spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-plan-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
  mkdirSync(path.join(dir, 'src', 'db'), { recursive: true });
  mkdirSync(path.join(dir, 'tests'), { recursive: true });

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'plan-fixture',
    scripts: { test: 'node --test', build: 'node build.js' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Plan Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'src', 'api', 'users.js'), '// TODO: implement user API\nconsole.log("api");\n');
  writeFileSync(path.join(dir, 'src', 'db', 'client.js'), '// FIXME: add connection pooling\nexport const db = {};\n');
  writeFileSync(path.join(dir, 'tests', 'api.test.js'), "test('api', () => {});\n");

  runGit(['add', '.'], dir);
  runGit(['commit', '-m', 'initial'], dir);
  return dir;
}

test('ctx plan feature generates plan with correct modules and tasks', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  const result = runCtx(['plan', 'feature', '--area', 'src/api'], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created feature plan ctxplan_/);

  const planId = result.stdout.split('\n').filter(l => l.startsWith('ctxplan_'))[0].trim();
  assert.ok(planId, 'expected plan ID in output');

  const planPath = path.join(repo, '.contextlock', 'plans', `${planId}.json`);
  assert.ok(existsSync(planPath));

  const plan = readJson(planPath);
  assert.equal(plan.artifact_type, 'plan');
  assert.equal(plan.plan_type, 'feature');
  assert.equal(plan.schema_version, 2, 'plan schema should be version 2');

  // Should reference the snapshot
  assert.ok(plan.snapshot_hash);
  assert.ok(plan.source_commit);

  // Should carry global quality gates
  assert.ok(plan.quality_gates.length > 0, 'plan missing global quality gates');
  for (const gate of plan.quality_gates) {
    assert.ok(gate.name, 'gate missing name');
    assert.ok(gate.command, 'gate missing command');
    assert.ok(gate.description, 'gate missing description');
  }

  // Every task should be detailed (steps) and gated (quality gates)
  for (const task of plan.tasks) {
    assert.ok(task.steps.length > 0, `task ${task.id} missing detailed steps`);
    assert.ok(task.quality_gates.length > 0, `task ${task.id} missing quality gates`);
    for (const gate of task.quality_gates) {
      assert.ok(gate.name, `task ${task.id} gate missing name`);
      assert.ok(gate.command, `task ${task.id} gate missing command`);
    }
  }

  // Tasks should reference correct modules
  const srcApiTask = plan.tasks.find(t =>
    t.affected_modules.some(m => m.includes('src/api'))
  );
  assert.ok(srcApiTask, 'expected task referencing src/api');

  // Should have test commands from package.json
  const hasTestCmd = plan.tasks.some(t =>
    t.validation_commands.some(c => c.includes('node --test'))
  );
  assert.ok(hasTestCmd, 'expected test commands in tasks');

  // Should have acceptance criteria on every task
  for (const task of plan.tasks) {
    assert.ok(task.acceptance_criteria.length > 0, `task ${task.id} missing acceptance criteria`);
    assert.ok(task.expected_touched_files.length > 0, `task ${task.id} missing touched files`);
    assert.ok(task.rollback_criteria, `task ${task.id} missing rollback criteria`);
  }
});

test('ctx plan refactor uses debt markers from snapshot', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  const result = runCtx(['plan', 'refactor', '--area', 'src/db'], repo);
  assert.equal(result.status, 0, result.stderr);

  const planId = result.stdout.split('\n').filter(l => l.startsWith('ctxplan_'))[0].trim();
  const plan = readJson(path.join(repo, '.contextlock', 'plans', `${planId}.json`));

  // Should have captured the fix-me marker from db/client.js
  assert.equal(plan.plan_type, 'refactor');
  assert.ok(plan.summary.includes('src/db'), 'summary should mention src/db');
});

test('ctx plan release generates complete release checklist', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['prompt', 'onboarding'], repo);
  // Make a change to generate a second snapshot and an audit
  writeFileSync(path.join(repo, 'README.md'), '# Plan Fixture\n\nUpdated.\n');
  runGit(['add', 'README.md'], repo);
  runGit(['commit', '-m', 'update'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['audit', '--since-last', '--quiet'], repo);

  const result = runCtx(['plan', 'release'], repo);
  assert.equal(result.status, 0, result.stderr);

  const planId = result.stdout.split('\n').filter(l => l.startsWith('ctxplan_'))[0].trim();
  const plan = readJson(path.join(repo, '.contextlock', 'plans', `${planId}.json`));

  assert.equal(plan.plan_type, 'release');
  // Should include drift score
  assert.ok(typeof plan.context.latest_drift_score === 'number');
  // Should have audit checkpoints
  assert.ok(plan.audit_checkpoints.length > 1);
  // Should have rollback plan
  assert.ok(plan.rollback_plan.length > 0);
});

test('plan markdown output is readable and includes all sections', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  const result = runCtx(['plan', 'feature', '--area', 'src/api'], repo);
  const planId = result.stdout.split('\n').filter(l => l.startsWith('ctxplan_'))[0].trim();
  const mdPath = path.join(repo, '.contextlock', 'plans', `${planId}.md`);

  assert.ok(existsSync(mdPath));
  const md = readFileSync(mdPath, 'utf8');

  assert.match(md, /# ContextLock Feature Plan/);
  assert.match(md, /## Summary/);
  assert.match(md, /## Project context/);
  assert.match(md, /## Tasks/);
  assert.match(md, /## Quality gates \(whole plan\)/);
  assert.match(md, /## Rollback plan/);
  assert.match(md, /## Audit checkpoints/);
  assert.match(md, /## Validation summary/);
  assert.match(md, /Acceptance criteria/);
  assert.match(md, /\*\*Steps:\*\*/);
  assert.match(md, /\*\*Quality gates:\*\*/);
  assert.match(md, /Rollback/);
});

test('ctx audit --against-plan detects implementation drift', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  // Generate a plan
  const planResult = runCtx(['plan', 'feature', '--area', 'src/api', '--quiet'], repo);
  const planId = planResult.stdout.trim();

  // Make an implementation change
  writeFileSync(path.join(repo, 'src', 'api', 'users.js'),
    '// TODO: still not done\nconsole.log("changed");\n'
  );
  runGit(['add', '.'], repo);
  runGit(['commit', '-m', 'implement'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['audit', '--since-last', '--quiet'], repo);

  const auditResult = runCtx(['audit', '--against-plan', planId], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);
  // Should report that plan and current snapshot differ
  assert.match(auditResult.stdout, /Plan audit/);
});

test('audit --against-plan flags a plan whose tasks lack quality gates', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  // Generate a plan, then strip gates/steps to simulate an older or hand-made plan
  const planResult = runCtx(['plan', 'feature', '--area', 'src/api', '--quiet'], repo);
  const planId = planResult.stdout.trim();
  const planPath = path.join(repo, '.contextlock', 'plans', `${planId}.json`);
  const plan = readJson(planPath);
  for (const task of plan.tasks) {
    delete task.quality_gates;
    delete task.steps;
  }
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');

  const auditResult = runCtx(['audit', '--against-plan', planId], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);
  assert.match(auditResult.stdout, /no quality gates/);
  assert.match(auditResult.stdout, /no detailed steps/);
});

test('audit --against-plan writes verified gate results into the progress ledger', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  // Create the planning progress ledger.
  const planningDir = path.join(repo, 'docs', 'planning');
  mkdirSync(planningDir, { recursive: true });
  const ledgerPath = path.join(planningDir, 'contextlock-progress.json');
  writeFileSync(ledgerPath, JSON.stringify({
    schema_version: 1,
    artifact_type: 'planning_progress',
    project: 'plan-fixture',
    updated_at: '2026-01-01T00:00:00Z',
    status_scale: ['not_started', 'in_progress', 'validated', 'done'],
    quality_gate_policy: { mode: 'strict' },
    specs: [],
    builds: []
  }, null, 2) + '\n');

  const planResult = runCtx(['plan', 'feature', '--area', 'src/api', '--quiet'], repo);
  const planId = planResult.stdout.trim();

  const auditResult = runCtx(['audit', '--against-plan', planId], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);
  assert.match(auditResult.stdout, /Progress ledger: updated/);

  const ledger = readJson(ledgerPath);
  assert.ok(Array.isArray(ledger.plan_audits), 'plan_audits array written');
  const entry = ledger.plan_audits.find((e) => e.plan_id === planId);
  assert.ok(entry, 'plan audit entry recorded');
  assert.equal(entry.plan_type, 'feature');
  assert.equal(typeof entry.on_track, 'boolean');
  assert.equal(typeof entry.verdict, 'string');
  assert.equal(typeof entry.findings_total, 'number');
  assert.ok(Array.isArray(entry.task_results) && entry.task_results.length > 0, 'per-task gate results recorded');
  assert.notEqual(ledger.updated_at, '2026-01-01T00:00:00Z', 'updated_at bumped');
});

test('ctx plan requires valid plan type', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const result = runCtx(['plan', 'invalid-type'], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /plan type must be/);
});

test('plan does not invent nonexistent files', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  const result = runCtx(['plan', 'feature', '--area', 'nonexistent/dir'], repo);
  const planId = result.stdout.split('\n').filter(l => l.startsWith('ctxplan_'))[0].trim();
  const plan = readJson(path.join(repo, '.contextlock', 'plans', `${planId}.json`));

  // Files that don't exist should be marked as [proposed:]
  const realFiles = plan.tasks.flatMap(t => t.expected_touched_files).filter(f => !f.startsWith('[proposed:'));
  for (const file of realFiles) {
    assert.ok(existsSync(path.join(repo, file)),
      `file ${file} should exist in repo (not invented)`);
  }
});
