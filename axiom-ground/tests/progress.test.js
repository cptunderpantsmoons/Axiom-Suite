import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { readJsonIfExists } from '../src/utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../src/utils/schema.js';

const CLI = path.resolve('src/cli/main.js');

function runCtx(args, cwd) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

const PROGRESS = {
  schema_version: 1,
  artifact_type: 'planning_progress',
  project: 'progress-fixture',
  updated_at: '2026-01-01T00:00:00Z',
  status_scale: ['not_started', 'draft_complete', 'in_progress', 'blocked', 'validated', 'done'],
  quality_gate_policy: { mode: 'strict' },
  specs: [
    { id: 'spec-1', path: 'docs/specs/1.md', status: 'in_progress', owner: 'core', gates: [] },
    { id: 'spec-2', path: 'docs/specs/2.md', status: 'validated', owner: 'audit', gates: [] }
  ],
  builds: [
    { id: 1, name: 'ctx init', status: 'in_progress', depends_on: [] },
    { id: 2, name: 'ctx snapshot', status: 'done', depends_on: [1] }
  ],
  guardrails: {
    active_enforcement: { spec_link_check: 'pass', secret_scan_check: 'pass' },
    planned_enforcement: { spec_link_check: 'pass' }
  }
};

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-progress-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);
  const planningDir = path.join(dir, 'docs', 'planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(path.join(planningDir, 'contextlock-progress.json'), JSON.stringify(PROGRESS, null, 2) + '\n');
  return dir;
}

function readProgress(repo) {
  return readJsonIfExists(path.join(repo, 'docs', 'planning', 'contextlock-progress.json'));
}

test('ctx progress set spec marks a spec status and bumps updated_at', () => {
  const repo = makeRepo();

  const result = runCtx(['progress', 'set', 'spec', 'spec-1', 'done'], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /spec "spec-1" \(spec-1\): in_progress -> done/);

  const data = readProgress(repo);
  assert.equal(data.specs.find((s) => s.id === 'spec-1').status, 'done');
  assert.notEqual(data.updated_at, PROGRESS.updated_at, 'updated_at bumped');
});

test('ctx progress set build marks a build status', () => {
  const repo = makeRepo();

  const result = runCtx(['progress', 'set', 'build', '1', 'validated'], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /build "ctx init" \(1\): in_progress -> validated/);

  const data = readProgress(repo);
  assert.equal(data.builds.find((b) => b.id === 1).status, 'validated');
});

test('ctx progress set guardrail marks a guardrail status', () => {
  const repo = makeRepo();

  const result = runCtx(['progress', 'set', 'guardrail', 'active', 'spec_link_check', 'fail'], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /guardrail active_enforcement\.spec_link_check: pass -> fail/);

  const data = readProgress(repo);
  assert.equal(data.guardrails.active_enforcement.spec_link_check, 'fail');
  assert.notEqual(data.updated_at, PROGRESS.updated_at, 'updated_at bumped');
});

test('ctx progress set guardrail rejects an invalid group or status', () => {
  const repo = makeRepo();

  const badGroup = runCtx(['progress', 'set', 'guardrail', 'bogus', 'spec_link_check', 'pass'], repo);
  assert.notEqual(badGroup.status, 0);
  assert.match(badGroup.stderr, /group must be "active" or "planned"/);

  const badStatus = runCtx(['progress', 'set', 'guardrail', 'active', 'spec_link_check', 'maybe'], repo);
  assert.notEqual(badStatus.status, 0);
  assert.match(badStatus.stderr, /Invalid guardrail status "maybe"/);
});

test('ctx progress set rejects an invalid status', () => {
  const repo = makeRepo();

  const result = runCtx(['progress', 'set', 'spec', 'spec-1', 'bogus'], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid status "bogus"/);
});

test('ctx progress set rejects an unknown id', () => {
  const repo = makeRepo();

  const result = runCtx(['progress', 'set', 'spec', 'nope', 'done'], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /spec "nope" not found/);
});

test('ctx progress set is a no-op when status is unchanged', () => {
  const repo = makeRepo();

  const result = runCtx(['progress', 'set', 'build', '2', 'done'], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /unchanged/);
});

test('ctx progress prints a summary and supports --format json', () => {
  const repo = makeRepo();

  const summary = runCtx(['progress'], repo);
  assert.equal(summary.status, 0, summary.stderr || summary.stdout);
  assert.match(summary.stdout, /Progress: 1\/2 specs, 1\/2 builds done/);
  assert.match(summary.stdout, /spec-1 \[in_progress\]/);
  assert.match(summary.stdout, /Build 2 \[done\] ctx snapshot/);

  const json = runCtx(['progress', '--format', 'json'], repo);
  assert.equal(json.status, 0, json.stderr || json.stdout);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.artifact_type, 'planning_progress');
  assert.equal(parsed.specs.length, 2);
});

test('planning progress schema validates the committed ledger', () => {
  const data = readJsonIfExists(path.resolve('docs/planning/contextlock-progress.json'));
  assert.ok(data, 'committed progress ledger present');
  assert.doesNotThrow(() =>
    assertValidSchema(data, bundledSchemaPath('planning-progress'), 'planning progress')
  );
});

test('planning progress schema rejects an invalid spec status', () => {
  const bad = JSON.parse(JSON.stringify(PROGRESS));
  bad.specs[0].status = 'bogus';
  assert.throws(
    () => assertValidSchema(bad, bundledSchemaPath('planning-progress'), 'planning progress'),
    /status/
  );
});

test('planning progress schema rejects an invalid guardrail status', () => {
  const bad = JSON.parse(JSON.stringify(PROGRESS));
  bad.guardrails.active_enforcement.spec_link_check = 'maybe';
  assert.throws(
    () => assertValidSchema(bad, bundledSchemaPath('planning-progress'), 'planning progress'),
    /spec_link_check/
  );
});
