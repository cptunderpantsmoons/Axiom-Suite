import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, runGit, writeJson } from '../utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../utils/schema.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_AUTOMATION = {
  install_hooks: true,
  auto_snapshot: true,
  auto_prompt_refresh: true,
  auto_audit: true,
  auto_sync: false
};

export const DEFAULT_REMOTE = {
  provider: 'huggingface',
  repo: null,
  token_env: 'HF_TOKEN'
};

// ---------------------------------------------------------------------------
// Project identity helpers
// ---------------------------------------------------------------------------

function slugify(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'repo';
}

function inferProjectName(root) {
  const packageJson = path.join(root, 'package.json');
  if (existsSync(packageJson)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJson, 'utf8'));
      if (typeof parsed?.name === 'string' && parsed.name.trim()) return parsed.name.trim();
    } catch {
      // ignore invalid package metadata here; init should still succeed.
    }
  }

  const pyproject = path.join(root, 'pyproject.toml');
  if (existsSync(pyproject)) {
    const content = readFileSync(pyproject, 'utf8');
    const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (match?.[1]) return match[1].trim();
  }

  return path.basename(root);
}

export function getProjectId(root) {
  return `ctxproj_${slugify(path.basename(root))}`;
}

function mergeUnique(base, extra) {
  const out = [...base];
  for (const item of extra) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Config & lockfile builders
// ---------------------------------------------------------------------------

export function buildDefaultConfig(root, existing = null) {
  const projectName = existing?.project_name || inferProjectName(root);
  const projectId = existing?.project_id || getProjectId(root);
  const include = Array.isArray(existing?.include) ? existing.include : ['**/*'];
  const exclude = mergeUnique(
    ['.git/**', '.contextlock/**', 'node_modules/**', 'dist/**', 'build/**', 'coverage/**', '.next/**', 'vendor/**', 'target/**'],
    Array.isArray(existing?.exclude) ? existing.exclude : []
  );
  const automation = { ...DEFAULT_AUTOMATION, ...(existing?.automation || {}) };
  const remote = { ...DEFAULT_REMOTE, ...(existing?.remote || {}) };

  return {
    version: 1,
    project_name: projectName,
    project_id: projectId,
    include,
    exclude,
    automation,
    remote
  };
}

export function buildDefaultLock(projectId, root, existing = null) {
  const branch = runGit(['branch', '--show-current'], root) || null;
  const commit = runGit(['rev-parse', 'HEAD'], root) || null;

  return {
    version: 1,
    project_id: projectId,
    current_branch: branch,
    current_commit: commit,
    latest_snapshot_hash: existing?.latest_snapshot_hash ?? null,
    latest_audit_id: existing?.latest_audit_id ?? null,
    latest_prompt_hashes: existing?.latest_prompt_hashes || {},
    latest_site: existing?.latest_site || null,
    updated_at: new Date().toISOString()
  };
}

export function ensureContextlockDirs(root) {
  const dirs = ['snapshots', 'prompts', 'audits', 'site', 'cache', 'queue', 'logs'];
  mkdirSync(path.join(root, '.contextlock'), { recursive: true });
  for (const dir of dirs) {
    mkdirSync(path.join(root, '.contextlock', dir), { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Schema-validated writers
// ---------------------------------------------------------------------------

export function writeConfigJson(root, config) {
  assertValidSchema(config, bundledSchemaPath('config'), '.contextlock/config.json');
  ensureDir(path.join(root, '.contextlock'));
  writeJson(path.join(root, '.contextlock', 'config.json'), config);
}

export function writeLockJson(root, lock) {
  assertValidSchema(lock, bundledSchemaPath('lock'), '.contextlock/lock.json');
  ensureDir(path.join(root, '.contextlock'));
  writeJson(path.join(root, '.contextlock', 'lock.json'), lock);
}
