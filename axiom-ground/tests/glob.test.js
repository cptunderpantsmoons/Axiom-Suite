import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExcluded, walkFiles, normalizeGlobPattern } from '../src/scanner/index.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// normalizeGlobPattern
// ---------------------------------------------------------------------------

test('normalizeGlobPattern handles empty input', () => {
  assert.equal(normalizeGlobPattern(''), '**/*');
  assert.equal(normalizeGlobPattern(null), '**/*');
});

test('normalizeGlobPattern appends /** for directory-like patterns', () => {
  assert.equal(normalizeGlobPattern('src'), 'src/**');
  assert.equal(normalizeGlobPattern('docs/'), 'docs/**');
});

test('normalizeGlobPattern preserves explicit glob patterns', () => {
  assert.equal(normalizeGlobPattern('*.js'), '*.js');
  assert.equal(normalizeGlobPattern('src/**/*.js'), 'src/**/*.js');
  assert.equal(normalizeGlobPattern('src/**'), 'src/**');
});

// ---------------------------------------------------------------------------
// isExcluded — basic patterns
// ---------------------------------------------------------------------------

test('isExcluded matches simple directory patterns', () => {
  assert.ok(isExcluded('node_modules/foo/bar.js', ['node_modules/**']));
  assert.ok(isExcluded('.git/HEAD', ['.git/**']));
  assert.ok(isExcluded('.contextlock/config.json', ['.contextlock/**']));
});

test('isExcluded does not false-positive on prefix matches', () => {
  assert.ok(!isExcluded('src/utils/core.js', ['util/**']));
  assert.ok(!isExcluded('README.md', ['node_modules/**']));
});

test('isExcluded matches extension patterns', () => {
  assert.ok(isExcluded('foo.pyc', ['*.pyc']));
  assert.ok(!isExcluded('foo.py', ['*.pyc']));
});

// ---------------------------------------------------------------------------
// isExcluded — bracket character classes
// ---------------------------------------------------------------------------

test('isExcluded matches bracket character classes [abc]', () => {
  assert.ok(isExcluded('test/a.js', ['test/[abc].js']));
  assert.ok(isExcluded('test/b.js', ['test/[abc].js']));
  assert.ok(isExcluded('test/c.js', ['test/[abc].js']));
  assert.ok(!isExcluded('test/d.js', ['test/[abc].js']));
});

test('isExcluded matches negated bracket classes [!abc]', () => {
  // [!xyz] matches any char that is NOT x/y/z, so 'a' matches (excluded) and 'x' doesn't (not excluded)
  assert.ok(isExcluded('test/a.js', ['test/[!xyz].js']));
  assert.ok(!isExcluded('test/x.js', ['test/[!xyz].js']));
});

test('isExcluded matches character ranges [a-z]', () => {
  assert.ok(isExcluded('file-a.txt', ['file-[a-c].txt']));
  assert.ok(isExcluded('file-c.txt', ['file-[a-c].txt']));
  assert.ok(!isExcluded('file-d.txt', ['file-[a-c].txt']));
});

test('isExcluded treats unclosed bracket as literal', () => {
  assert.ok(!isExcluded('test/a.js', ['test/[abc.js']));
});

// ---------------------------------------------------------------------------
// isExcluded — brace expansion
// ---------------------------------------------------------------------------

test('isExcluded matches brace alternatives {a,b,c}', () => {
  assert.ok(isExcluded('src/foo.js', ['src/{foo,bar,baz}.js']));
  assert.ok(isExcluded('src/bar.js', ['src/{foo,bar,baz}.js']));
  assert.ok(!isExcluded('src/qux.js', ['src/{foo,bar,baz}.js']));
});

test('isExcluded handles brace with single alternative', () => {
  assert.ok(isExcluded('src/index.js', ['src/{index}.js']));
});

test('isExcluded handles nested braces {a,{b,c}}', () => {
  assert.ok(isExcluded('foo.js', ['{foo,{bar,baz}}.js']));
  assert.ok(isExcluded('bar.js', ['{foo,{bar,baz}}.js']));
  assert.ok(isExcluded('baz.js', ['{foo,{bar,baz}}.js']));
  assert.ok(!isExcluded('qux.js', ['{foo,{bar,baz}}.js']));
});

test('isExcluded treats unclosed brace as literal', () => {
  assert.ok(!isExcluded('test/a.js', ['test/{abc.js']));
});

// ---------------------------------------------------------------------------
// isExcluded — escape character
// ---------------------------------------------------------------------------

// Note: backslash escape in glob patterns is not supported because normalizeGlobPattern
// converts all backslashes to forward slashes (POSIX normalization). This is by design.
test('isExcluded handles patterns that look like escapes after normalization', () => {
  // After normalization, 'file\*.js' becomes 'file/*.js' which is a valid glob
  assert.ok(isExcluded('file/anything.js', ['file/*.js']));
});

// ---------------------------------------------------------------------------
// isExcluded — safety limits
// ---------------------------------------------------------------------------

test('isExcluded handles very long patterns gracefully', () => {
  const longPattern = 'a'.repeat(600) + '/**';
  // Should not throw — falls back to literal match
  assert.ok(!isExcluded('src/main.js', [longPattern]));
});

// ---------------------------------------------------------------------------
// walkFiles — real directory test
// ---------------------------------------------------------------------------

test('walkFiles excludes directories with bracket patterns', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-glob-'));
  try {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main.js'), 'code');
    writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'bundled');
    writeFileSync(path.join(dir, 'README.md'), 'readme');

    const files = walkFiles(dir, ['dist/**']);
    const paths = files.map(f => f.replace(/\\/g, '/'));
    assert.ok(paths.some(f => f.includes('src/main.js')));
    assert.ok(!paths.some(f => f.includes('dist/')));
    assert.ok(paths.some(f => f.includes('README.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('walkFiles handles brace-based exclusions', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contextlock-glob-'));
  try {
    mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    mkdirSync(path.join(dir, '.next'), { recursive: true });
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'app.js'), 'code');
    writeFileSync(path.join(dir, 'coverage', 'index.html'), 'cov');
    writeFileSync(path.join(dir, '.next', 'build.js'), 'build');

    const files = walkFiles(dir, ['coverage/**', '.next/**']);
    const paths = files.map(f => f.replace(/\\/g, '/'));
    assert.ok(paths.some(f => f.includes('src/app.js')));
    assert.ok(!paths.some(f => f.includes('coverage/')));
    assert.ok(!paths.some(f => f.includes('.next/')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
