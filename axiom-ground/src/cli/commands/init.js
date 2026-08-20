import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, sha256, fail, ensureDir } from '../../utils/core.js';
import { buildDefaultConfig, buildDefaultLock, ensureContextlockDirs, getProjectId, writeConfigJson, writeLockJson } from '../../init/index.js';

export function initCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const force = args.includes('--force');
  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  const existingConfig = readJsonIfExists(configPath);
  const existingLock = readJsonIfExists(lockPath);

  ensureContextlockDirs(root);

  if (existingConfig && !force) {
    if (!existingLock) {
      writeLockJson(root, buildDefaultLock(existingConfig.project_id || getProjectId(root), root));
      console.log(`ContextLock initialized lockfile in ${root}`);
      return 0;
    }
    console.log(`ContextLock already initialized in ${root}`);
    return 0;
  }

  const config = buildDefaultConfig(root, force ? existingConfig : null);
  const lock = buildDefaultLock(config.project_id, root, force ? existingLock : null);

  writeConfigJson(root, config);
  writeLockJson(root, lock);

  console.log(`ContextLock initialized in ${root}`);
  console.log('Created .contextlock/config.json and .contextlock/lock.json');
  return 0;
}
