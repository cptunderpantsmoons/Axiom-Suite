import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-prompt-'));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'prompt-fixture',
    scripts: { test: 'node --test', build: 'node build.js', start: 'node main.js' },
    dependencies: { leftpad: '^1.0.0' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Prompt Fixture\n\nRun `npm test`.\n');
  writeFileSync(path.join(dir, 'main.js'), '// TODO: implement\nconsole.log("hello")\n');
  writeFileSync(path.join(dir, 'tests.spec.js'), 'test("ok", () => {});\n');
  runGit(['add', '.'], dir);
  runGit(['commit', '-m', 'initial'], dir);
  return dir;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('ctx prompt onboarding writes markdown and metadata tied to snapshot hash', () => {
  const repo = makeRepo();
  assert.equal(runCtx(['init', '--yes'], repo).status, 0);
  assert.equal(runCtx(['snapshot'], repo).status, 0);

  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const beforePrompt = runCtx(['prompt', 'onboarding'], repo);
  assert.equal(beforePrompt.status, 0, beforePrompt.stderr);
  assert.match(beforePrompt.stdout, /Created onboarding prompt/);

  const promptDir = path.join(repo, '.contextlock', 'prompts', lock.latest_snapshot_hash, 'onboarding');
  const mdPath = path.join(promptDir, 'onboarding.md');
  const jsonPath = path.join(promptDir, 'onboarding.json');

  assert.ok(existsSync(mdPath));
  assert.ok(existsSync(jsonPath));

  const metadata = readJson(jsonPath);
  const prompt = readFileSync(mdPath, 'utf8');

  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.artifact_type, 'prompt');
  assert.equal(metadata.prompt_type, 'onboarding');
  assert.equal(metadata.snapshot_hash, lock.latest_snapshot_hash);
  assert.ok(prompt.includes(`Snapshot hash: ${lock.latest_snapshot_hash}`));
  assert.ok(prompt.includes('## Task boundary'));
  assert.ok(prompt.includes('Onboarding only. Do not change code unless explicitly asked.'));
  assert.ok(prompt.includes('## How to run'));
  assert.ok(prompt.includes('node --test'));
  assert.ok(prompt.includes('## How to test'));
  assert.ok(prompt.includes('## Response format'));
});

test('ctx prompt onboarding is deterministic for the same snapshot and supports stdout', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);

  const first = runCtx(['prompt', 'onboarding'], repo);
  assert.equal(first.status, 0, first.stderr);
  const lock = readJson(path.join(repo, '.contextlock', 'lock.json'));
  const promptPath = path.join(repo, '.contextlock', 'prompts', lock.latest_snapshot_hash, 'onboarding', 'onboarding.md');
  const metadataPath = path.join(repo, '.contextlock', 'prompts', lock.latest_snapshot_hash, 'onboarding', 'onboarding.json');
  const firstPrompt = readFileSync(promptPath, 'utf8');
  const firstMeta = readFileSync(metadataPath, 'utf8');

  const second = runCtx(['prompt', 'onboarding'], repo);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(promptPath, 'utf8'), firstPrompt);
  assert.equal(readFileSync(metadataPath, 'utf8'), firstMeta);

  const stdout = runCtx(['prompt', 'onboarding', '--stdout'], repo);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.match(stdout.stdout, /# ContextLock Onboarding Prompt/);
  assert.match(stdout.stdout, /Onboarding only\. Do not change code unless explicitly asked\./);
});

test('ctx status marks onboarding prompt stale after a new snapshot', () => {
  const repo = makeRepo();
  runCtx(['init', '--yes'], repo);
  runCtx(['snapshot'], repo);
  runCtx(['prompt', 'onboarding'], repo);

  writeFileSync(path.join(repo, 'main.js'), '// TODO: changed\nconsole.log("changed")\n');
  runCtx(['snapshot'], repo);

  const status = runCtx(['status'], repo);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Prompt cache: onboarding stale/);
});
