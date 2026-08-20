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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-rules-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  // Create directories
  mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
  mkdirSync(path.join(dir, 'src', 'db'), { recursive: true });
  mkdirSync(path.join(dir, 'src', 'services'), { recursive: true });

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'rules-fixture',
    scripts: { test: 'node --test' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Rules Fixture\n\nRun `npm test`.\n');

  // API layer imports DB directly (should be caught by a rule)
  writeFileSync(path.join(dir, 'src', 'api', 'users.js'),
    "import { db } from '../db/client.js';\n" +
    "import { auth } from '../services/auth.js';\n" +
    "console.log(db.query('SELECT * FROM users'));\n"
  );

  // DB client (allowed)
  writeFileSync(path.join(dir, 'src', 'db', 'client.js'),
    "export const db = { query: (sql) => [] };\n"
  );

  // Service layer (allowed to import DB)
  writeFileSync(path.join(dir, 'src', 'services', 'auth.js'),
    "import { db } from '../db/client.js';\n" +
    "export const auth = { check: () => true };\n"
  );

  runGit(['add', '.'], dir);
  runGit(['commit', '-m', 'initial'], dir);
  return dir;
}

test('ctx rules validate reports valid rules', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.architecture_rules = [{
    id: 'api-no-db-direct',
    description: 'API layer must not import database client directly',
    severity: 'high',
    match: ['src/api/**'],
    forbid_imports: ['src/db/**'],
    recommendation: 'Route database access through service layer.'
  }];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const result = runCtx(['rules', 'validate'], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 architecture rule\(s\) validated/);
  assert.match(result.stdout, /api-no-db-direct/);
});

test('ctx rules validate reports invalid rules', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.architecture_rules = [{
    // Missing id, description, match
    severity: 'invalid-severity',
    forbid_imports: []
  }];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const result = runCtx(['rules', 'validate'], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Rule validation failed/);
});

test('forbidden import rule triggers in audit findings', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.architecture_rules = [{
    id: 'api-no-db-direct',
    description: 'API layer must not import database client directly',
    severity: 'high',
    match: ['src/api/**'],
    forbid_imports: ['src/db/**'],
    recommendation: 'Route database access through service layer.'
  }];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  runCtx(['snapshot'], repo);

  // Make a minor change to trigger a second snapshot
  writeFileSync(path.join(repo, 'README.md'), '# Rules Fixture\n\nUpdated.\n');
  runGit(['add', 'README.md'], repo);
  runGit(['commit', '-m', 'update readme'], repo);
  runCtx(['snapshot'], repo);

  const auditResult = runCtx(['audit', '--since-last'], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);

  // Check audit output for rule finding
  const auditDir = path.join(repo, '.contextlock', 'audits');
  const files = readdirSync(auditDir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0, 'expected audit artifacts');

  const audit = readJson(path.join(auditDir, files[files.length - 1]));
  const ruleFinding = audit.findings.find(f => f.category === 'architecture_rule');
  assert.ok(ruleFinding, 'expected an architecture_rule finding');
  assert.equal(ruleFinding.rule_id, 'api-no-db-direct');
  assert.equal(ruleFinding.severity, 'high');
  assert.match(ruleFinding.evidence[0].file, /src\/api\/users\.js/);
  assert.match(ruleFinding.evidence[0].text, /db/);
});

test('active suppression hides rule finding', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.architecture_rules = [{
    id: 'api-no-db-direct',
    description: 'API must not import DB',
    severity: 'high',
    match: ['src/api/**'],
    forbid_imports: ['src/db/**']
  }];

  // Add suppression that expires far in the future
  config.suppressions = [{
    finding_id: 'rule:api-no-db-direct:src/api/users.js:1',
    reason: 'Temporary migration bridge',
    expires_at: '2099-01-01T00:00:00Z',
    approved_by: 'local-user'
  }];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  runCtx(['snapshot'], repo);
  writeFileSync(path.join(repo, 'README.md'), '# Updated\n');
  runGit(['add', 'README.md'], repo);
  runGit(['commit', '-m', 'update'], repo);
  runCtx(['snapshot'], repo);

  const auditResult = runCtx(['audit', '--since-last'], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);

  const auditDir = path.join(repo, '.contextlock', 'audits');
  const auditFiles = readdirSync(auditDir).filter(f => f.endsWith('.json'));
  const audit = readJson(path.join(auditDir, auditFiles[auditFiles.length - 1]));

  // Should NOT have the forbidden import finding (it's suppressed)
  const ruleFindings = audit.findings.filter(f => f.rule_id === 'api-no-db-direct');
  assert.equal(ruleFindings.length, 0, 'suppressed finding should not appear');
});

test('expired suppression produces high-severity finding', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.architecture_rules = [{
    id: 'api-no-db-direct',
    description: 'API must not import DB',
    severity: 'high',
    match: ['src/api/**'],
    forbid_imports: ['src/db/**']
  }];

  // Expired suppression
  config.suppressions = [{
    finding_id: 'rule:api-no-db-direct:src/api/users.js:1',
    reason: 'Was temporary',
    expires_at: '2020-01-01T00:00:00Z',
    approved_by: 'local-user'
  }];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  runCtx(['snapshot'], repo);
  writeFileSync(path.join(repo, 'README.md'), '# Updated\n');
  runGit(['add', 'README.md'], repo);
  runGit(['commit', '-m', 'update'], repo);
  runCtx(['snapshot'], repo);

  const auditResult = runCtx(['audit', '--since-last'], repo);
  assert.equal(auditResult.status, 0, auditResult.stderr);

  const auditDir = path.join(repo, '.contextlock', 'audits');
  const auditFiles = readdirSync(auditDir).filter(f => f.endsWith('.json'));
  const audit = readJson(path.join(auditDir, auditFiles[auditFiles.length - 1]));

  // Should have an EXPIRED SUPPRESSION finding with high severity
  const expiredFinding = audit.findings.find(f =>
    f.rule_id === 'api-no-db-direct' && f.title.includes('EXPIRED SUPPRESSION')
  );
  assert.ok(expiredFinding, 'expired suppression should produce elevated finding');
  assert.equal(expiredFinding.severity, 'high');
});

test('ctx rules validate detects expired suppressions', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);

  const configPath = path.join(repo, '.contextlock', 'config.json');
  const config = readJson(configPath);
  config.suppressions = [{
    finding_id: 'test-finding',
    reason: 'old suppression',
    expires_at: '2020-01-01T00:00:00Z',
    approved_by: 'local-user'
  }];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const result = runCtx(['rules', 'validate'], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /EXPIRED/);
});
