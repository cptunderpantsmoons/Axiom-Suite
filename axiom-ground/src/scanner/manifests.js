import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizePosix, fastCompare } from '../utils/core.js';
import { normalizeTextContent } from './content.js';

export function detectLanguage(relPath, manifests) {
  const lower = relPath.toLowerCase();
  const ext = path.extname(lower);
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (manifests.includes('package.json') && (ext === '.js' || ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs')) {
    return ext === '.py' ? 'python' : (ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript');
  }
  if (manifests.includes('pyproject.toml') || manifests.includes('requirements.txt')) {
    if (ext === '.py') return 'python';
  }
  return null;
}

export function parsePackageJson(root) {
  const file = path.join(root, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function parseRequirements(root) {
  const file = path.join(root, 'requirements.txt');
  if (!existsSync(file)) return [];
  const content = normalizeTextContent(readFileSync(file, 'utf8'));
  const deps = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)/);
    if (match?.[1]) deps.push(match[1].toLowerCase());
  }
  return deps;
}

export function detectEntryPoints(root, files, packageJson) {
  const candidates = new Set();
  if (typeof packageJson?.main === 'string') candidates.add(normalizePosix(packageJson.main.replace(/^\.\//, '')));
  if (typeof packageJson?.bin === 'string') candidates.add(normalizePosix(packageJson.bin.replace(/^\.\//, '')));
  if (packageJson?.bin && typeof packageJson.bin === 'object') {
    for (const value of Object.values(packageJson.bin)) {
      if (typeof value === 'string') candidates.add(normalizePosix(value.replace(/^\.\//, '')));
    }
  }

  for (const file of files) {
    const base = path.basename(file).toLowerCase();
    if (
      base === 'index.js' || base === 'index.ts' ||
      base === 'main.js' || base === 'main.ts' ||
      base === 'app.js' || base === 'app.ts' ||
      base === 'main.py' || base === 'app.py'
    ) {
      candidates.add(file);
    }
    const lower = file.toLowerCase();
    if (lower === 'src/cli/main.js' || lower === 'src/cli/main.ts') candidates.add(file);
  }

  return [...candidates].map(normalizePosix).sort((a, b) => fastCompare(a, b));
}

export function extractCommands(packageJson, pythonDetected, manifests = []) {
  const testCommands = [];
  const buildCommands = [];
  const runCommands = [];

  const scripts = packageJson?.scripts;
  if (scripts && typeof scripts === 'object') {
    if (typeof scripts.test === 'string' && scripts.test.trim()) testCommands.push(scripts.test.trim());
    if (typeof scripts.build === 'string' && scripts.build.trim()) buildCommands.push(scripts.build.trim());
    if (typeof scripts.start === 'string' && scripts.start.trim()) runCommands.push(scripts.start.trim());
    if (typeof scripts.dev === 'string' && scripts.dev.trim()) runCommands.push(scripts.dev.trim());
  }

  if (pythonDetected) {
    if (testCommands.length === 0) testCommands.push('pytest');
    if (runCommands.length === 0) runCommands.push('python -m <app>');
  }
  if (manifests.includes('go.mod')) {
    testCommands.push('go test ./...');
    buildCommands.push('go build ./...');
  }
  if (manifests.includes('Cargo.toml')) {
    testCommands.push('cargo test');
    buildCommands.push('cargo build');
  }

  return {
    test_commands: [...new Set(testCommands)].sort((a, b) => fastCompare(a, b)),
    build_commands: [...new Set(buildCommands)].sort((a, b) => fastCompare(a, b)),
    run_commands: [...new Set(runCommands)].sort((a, b) => fastCompare(a, b))
  };
}

export function extractDependencies(packageJson, requirementsDeps) {
  const deps = new Set();
  const addObjectKeys = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) deps.add(String(key).toLowerCase());
  };

  addObjectKeys(packageJson?.dependencies);
  addObjectKeys(packageJson?.devDependencies);
  addObjectKeys(packageJson?.peerDependencies);
  addObjectKeys(packageJson?.optionalDependencies);
  for (const dep of requirementsDeps) deps.add(dep.toLowerCase());

  return [...deps].sort((a, b) => fastCompare(a, b));
}

export function extractManifests(root) {
  const manifests = [];
  for (const name of ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod']) {
    if (existsSync(path.join(root, name))) manifests.push(name);
  }
  return manifests.sort((a, b) => fastCompare(a, b));
}

export function buildDirectoryMap(files) {
  const counts = new Map();
  for (const rel of files) {
    const parts = rel.split('/');
    if (parts.length < 2) continue;
    const top = parts[0];
    counts.set(top, (counts.get(top) || 0) + 1);
  }

  const directories = [...counts.entries()].map(([dir, fileCount]) => {
    const lower = dir.toLowerCase();
    let role = 'other';
    if (lower === 'src' || lower === 'app') role = 'source';
    else if (lower === 'docs') role = 'docs';
    else if (lower === 'tests' || lower === 'test') role = 'tests';
    else if (lower === '.github') role = 'config';
    return { path: dir, role, file_count: fileCount };
  });

  return directories.sort((a, b) => fastCompare(a.path, b.path));
}

export function detectSupportLevel(root) {
  const hasNode = existsSync(path.join(root, 'package.json'));
  const hasPython = existsSync(path.join(root, 'pyproject.toml')) || existsSync(path.join(root, 'requirements.txt'));
  const hasGo = existsSync(path.join(root, 'go.mod'));
  const hasRust = existsSync(path.join(root, 'Cargo.toml'));

  if (hasNode || hasPython || hasGo || hasRust) return 'full';
  return 'unknown';
}
