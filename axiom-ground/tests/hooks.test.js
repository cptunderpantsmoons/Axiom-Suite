import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function runGit(args, cwd, extraEnv = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-hooks-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'hooks-fixture',
    scripts: { test: 'node --test', build: 'node build.js' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Hooks Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'main.js'), 'console.log("hello")\n');
  writeFileSync(path.join(dir, 'tests.spec.js'), 'test("ok", () => {});\n');
  runGit(['add', '.'], dir);
  runGit(['commit', '-m', 'initial'], dir);
  return dir;
}

function makeCtxShim(repo) {
  const binDir = path.join(repo, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, 'ctx'), `#!/bin/sh\nexec node ${JSON.stringify(CLI)} "$@"\n`);
  chmodSync(path.join(binDir, 'ctx'), 0o755);
  return binDir;
}

function readFileSafe(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

test('ctx hooks install chains existing post-commit hook and automation runs on commit', () => {
  const repo = makeRepo();
  const binDir = makeCtxShim(repo);
  const env = { PATH: `${binDir}:${process.env.PATH}` };

  assert.equal(runCtx(['init', '--yes'], repo, env).status, 0);
  assert.equal(runCtx(['snapshot'], repo, env).status, 0);
  assert.equal(runCtx(['prompt', 'onboarding'], repo, env).status, 0);

  const originalHook = path.join(repo, '.git', 'hooks', 'post-commit');
  writeFileSync(originalHook, `#!/bin/sh\nROOT="$(git rev-parse --show-toplevel)"\necho original >> "$ROOT/.git/original-hook.log"\n`);
  chmodSync(originalHook, 0o755);

  const install = runCtx(['hooks', 'install'], repo, env);
  assert.equal(install.status, 0, install.stderr);
  assert.match(readFileSafe(originalHook), /Managed by ContextLock/);
  assert.ok(existsSync(path.join(repo, '.contextlock', 'hooks', 'post-commit.original')));

  writeFileSync(path.join(repo, 'main.js'), 'console.log("change 1")\n');
  runGit(['add', 'main.js'], repo, env);
  const commit = runGit(['commit', '-m', 'change 1'], repo, env);
  assert.match(commit, /change 1/);

  const automationLog = readFileSafe(path.join(repo, '.contextlock', 'logs', 'automation.log'));
  assert.match(automationLog, /hooks:install pre-commit, post-commit/);
  assert.match(automationLog, /post-commit:start:snapshot/);
  assert.match(automationLog, /post-commit:done:site:0/);
  assert.ok(existsSync(path.join(repo, '.contextlock', 'site', 'index.html')));
  assert.ok(existsSync(path.join(repo, '.contextlock', 'prompts')));
  assert.ok(existsSync(path.join(repo, '.git', 'original-hook.log')));

  const uninstall = runCtx(['hooks', 'uninstall'], repo, env);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.ok(!readFileSafe(originalHook).includes('Managed by ContextLock'));

  const logBefore = readFileSafe(path.join(repo, '.contextlock', 'logs', 'automation.log'));
  writeFileSync(path.join(repo, 'main.js'), 'console.log("change 2")\n');
  runGit(['add', 'main.js'], repo, env);
  runGit(['commit', '-m', 'change 2'], repo, env);

  const logAfter = readFileSafe(path.join(repo, '.contextlock', 'logs', 'automation.log'));
  assert.equal(logAfter, logBefore);
  const originalHookLog = readFileSafe(path.join(repo, '.git', 'original-hook.log')).trim().split('\n').filter(Boolean);
  assert.equal(originalHookLog.length, 2);
});
