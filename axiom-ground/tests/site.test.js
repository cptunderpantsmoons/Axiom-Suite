import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-site-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'site-fixture',
    scripts: { test: 'node --test', build: 'node build.js', start: 'node main.js' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Site Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'main.js'), 'console.log("hello")\n');
  writeFileSync(path.join(dir, 'tests.spec.js'), 'test("ok", () => {});\n');
  return dir;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function latestAudit(repo) {
  const auditDir = path.join(repo, '.contextlock', 'audits');
  const files = readdirSync(auditDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({ file, mtime: statSync(path.join(auditDir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  assert.ok(files.length > 0, 'expected audit artifact');
  return readJson(path.join(auditDir, files[0].file));
}

test('ctx site build generates all expected pages and metadata', () => {
  const repo = makeRepo();
  assert.equal(runCtx(['init', '--yes'], repo).status, 0);
  assert.equal(runCtx(['snapshot'], repo).status, 0);
  assert.equal(runCtx(['prompt', 'onboarding'], repo).status, 0);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("changed")\n');
  assert.equal(runCtx(['snapshot'], repo).status, 0);
  assert.equal(runCtx(['audit', '--since-last'], repo).status, 0);

  const build = runCtx(['site', 'build'], repo);
  assert.equal(build.status, 0, build.stderr);
  assert.match(build.stdout, /Built ContextLock site ctxsite_/);

  const siteDir = path.join(repo, '.contextlock', 'site');
  const pages = ['index.html', 'snapshot.html', 'architecture.html', 'prompts.html', 'audit.html', 'claims.html', 'progress.html', 'plans.html'];
  for (const page of pages) {
    assert.ok(existsSync(path.join(siteDir, page)));
  }
  assert.ok(existsSync(path.join(siteDir, 'assets', 'contextlock.css')));
  assert.ok(existsSync(path.join(siteDir, 'assets', 'contextlock.js')));

  const siteJson = readJson(path.join(siteDir, 'site.json'));
  assert.equal(siteJson.artifact_type, 'site');
  assert.equal(siteJson.pages.length, 8);
  assert.ok(siteJson.site_hash.startsWith('ctxsite_'));

  const index = readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  assert.match(index, /href="snapshot\.html"/);
  assert.match(index, /href="architecture\.html"/);
  assert.match(index, /href="prompts\.html"/);
  assert.match(index, /href="audit\.html"/);
  assert.match(index, /href="claims\.html"/);
  assert.match(index, /href="progress\.html"/);
  assert.match(index, /href="plans\.html"/);
  assert.match(index, /assets\/contextlock\.css/);
  assert.match(index, /Drift/);
  assert.match(index, /Prompt/);
  assert.match(index, /Latest snapshot/);

  const audit = latestAudit(repo);
  assert.match(index, new RegExp(audit.audit_id));
  assert.match(index, new RegExp(String(audit.final_drift_score)));
});

test('ctx site build highlights the active page in the nav', () => {
  const repo = makeRepo();
  assert.equal(runCtx(['init', '--yes'], repo).status, 0);
  assert.equal(runCtx(['snapshot'], repo).status, 0);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("changed")\n');
  assert.equal(runCtx(['snapshot'], repo).status, 0);
  assert.equal(runCtx(['audit', '--since-last'], repo).status, 0);
  assert.equal(runCtx(['site', 'build'], repo).status, 0);

  const siteDir = path.join(repo, '.contextlock', 'site');
  const expected = {
    'index.html': 'Dashboard',
    'snapshot.html': 'Snapshot',
    'architecture.html': 'Architecture',
    'prompts.html': 'Prompts',
    'audit.html': 'Audit',
    'claims.html': 'Claims',
    'progress.html': 'Progress',
    'plans.html': 'Plans'
  };
  for (const [page, label] of Object.entries(expected)) {
    const html = readFileSync(path.join(siteDir, page), 'utf8');
    assert.match(html, new RegExp(`<a class="active" href="${page}">${label}</a>`));
  }
});

test('ctx site build renders plan quality gates on plans.html', () => {
  const repo = makeRepo();
  assert.equal(runCtx(['init', '--yes'], repo).status, 0);
  assert.equal(runCtx(['snapshot'], repo).status, 0);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("changed")\n');
  assert.equal(runCtx(['snapshot'], repo).status, 0);
  assert.equal(runCtx(['audit', '--since-last'], repo).status, 0);
  assert.equal(runCtx(['plan', 'feature'], repo).status, 0);
  assert.equal(runCtx(['site', 'build'], repo).status, 0);

  const plansHtml = readFileSync(path.join(repo, '.contextlock', 'site', 'plans.html'), 'utf8');
  assert.match(plansHtml, /Plans/);
  assert.match(plansHtml, /Quality gates/);
  assert.match(plansHtml, /Tests pass/);
  assert.match(plansHtml, /Steps/);
  assert.match(plansHtml, /Acceptance criteria/);
  assert.match(plansHtml, /class="gate-check"/);
  assert.match(plansHtml, /data-plan="/);
  assert.match(plansHtml, /assets\/contextlock\.js/);
  assert.doesNotMatch(plansHtml, /<input type="checkbox" disabled>/);
  assert.match(plansHtml, /class="plan-gate-summary"/);
  assert.match(plansHtml, /gate-done/);
  assert.match(plansHtml, /gate-total/);
  assert.match(plansHtml, /gates done/);
  assert.match(plansHtml, /class="clear-gates"/);
  assert.match(plansHtml, /Clear checked gates/);
  assert.match(plansHtml, /class="gate-progress"/);
  assert.match(plansHtml, /gate-progress-fill/);
  assert.match(plansHtml, /<section id="plan-/);
  assert.match(plansHtml, /href="#plan-/);

  const script = readFileSync(path.join(repo, '.contextlock', 'site', 'assets', 'contextlock.js'), 'utf8');
  assert.match(script, /updateCounts/);
  assert.match(script, /plan-gate-summary/);
  assert.match(script, /gate-progress-fill/);
  assert.match(script, /clearPlan/);
  assert.match(script, /button\.clear-gates/);
});

test('ctx site export copies the built site to a directory', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['prompt', 'onboarding'], repo);
  writeFileSync(path.join(repo, 'main.js'), 'console.log("changed")\n');
  runCtx(['snapshot'], repo);
  runCtx(['audit', '--since-last'], repo);
  runCtx(['site', 'build'], repo);

  const exportDir = path.join(repo, 'exported-site');
  const exported = runCtx(['site', 'export', 'exported-site'], repo);
  assert.equal(exported.status, 0, exported.stderr);
  assert.ok(existsSync(path.join(exportDir, 'index.html')));
  assert.ok(existsSync(path.join(exportDir, 'site.json')));
  assert.ok(existsSync(path.join(exportDir, 'assets', 'contextlock.css')));
  assert.ok(existsSync(path.join(exportDir, 'assets', 'contextlock.js')));
});
