import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const CLI = path.resolve('src/cli/main.js');

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeLargeRepo(fileCount) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `contextlock-perf-${fileCount}-`));
  runGit(['init'], dir);
  runGit(['branch', '-m', 'main'], dir);
  runGit(['config', 'user.name', 'Moonbuggy'], dir);
  runGit(['config', 'user.email', 'moonbuggy@example.com'], dir);

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: `perf-test-${fileCount}`,
    scripts: { test: 'node --test' }
  }, null, 2) + '\n');
  writeFileSync(path.join(dir, 'README.md'), '# Perf Test\n');

  // Create files in batches to avoid hitting arg limits
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  mkdirSync(path.join(dir, 'tests'), { recursive: true });

  for (let i = 0; i < fileCount; i++) {
    const isTest = i % 4 === 0;
    const subdir = isTest ? 'tests' : 'src';
    const content = isTest
      ? `import test from 'node:test';\ntest('test ${i}', () => {});\n`
      : `// file ${i}\nexport const value${i} = ${i};\n`;
    writeFileSync(path.join(dir, subdir, `file${String(i).padStart(4, '0')}.js`), content);
  }

  runGit(['add', '-A'], dir);
  runGit(['commit', '-m', `initial: ${fileCount} files`], dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Performance thresholds
// ---------------------------------------------------------------------------

test('ctx snapshot completes within 5 seconds for a 100-file repo', () => {
  const dir = makeLargeRepo(100);
  try {
    const start = Date.now();
    const result = spawnSync('node', [CLI, 'bootstrap', '--no-open', '--quiet'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10000
    });
    const elapsed = Date.now() - start;

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(elapsed < 5000, `bootstrap took ${elapsed}ms — expected under 5000ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx snapshot completes within 10 seconds for a 500-file repo', () => {
  const dir = makeLargeRepo(500);
  try {
    const start = Date.now();
    const result = spawnSync('node', [CLI, 'bootstrap', '--no-open', '--quiet'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 20000
    });
    const elapsed = Date.now() - start;

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(elapsed < 10000, `bootstrap took ${elapsed}ms — expected under 10000ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx snapshot is faster on second run due to caching', () => {
  const dir = makeLargeRepo(200);
  try {
    // First run
    spawnSync('node', [CLI, 'bootstrap', '--no-open', '--quiet'], {
      cwd: dir, encoding: 'utf8', timeout: 15000
    });

    // Second run (should benefit from incremental cache)
    const start = Date.now();
    const result = spawnSync('node', [CLI, 'snapshot', '--incremental', '--quiet'], {
      cwd: dir, encoding: 'utf8', timeout: 15000
    });
    const elapsed = Date.now() - start;

    assert.equal(result.status, 0, result.stderr || result.stdout);
    // Incremental should be under 3 seconds since no files changed
    assert.ok(elapsed < 3000, `incremental snapshot took ${elapsed}ms — expected under 3000ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ctx snapshot produces correct artifact counts for 500-file repo', () => {
  const dir = makeLargeRepo(500);
  try {
    const result = spawnSync('node', [CLI, 'bootstrap', '--no-open', '--json'], {
      cwd: dir, encoding: 'utf8', timeout: 15000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    // Verify the snapshot counted all 500 source files + 2 metadata files = 502
    const lockPath = path.join(dir, '.contextlock', 'lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.ok(lock.latest_snapshot_hash);

    const snapPath = path.join(dir, '.contextlock', 'snapshots', `${lock.latest_snapshot_hash}.json`);
    const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
    // 500 source/test files + package.json + README.md = 502
    assert.equal(snapshot.machine_facts.file_count, 502);
    // Should detect 500 fingerprinted files (some may be over MAX_TEXT_BYTES, but these are tiny)
    const fpCount = Object.keys(snapshot.content_fingerprints).length;
    assert.ok(fpCount >= 500, `expected >=500 fingerprints, got ${fpCount}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
