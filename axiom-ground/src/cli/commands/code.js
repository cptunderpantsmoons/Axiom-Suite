import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, fail } from '../../utils/core.js';
import { buildCodeIndex, writeCodeIndexArtifacts } from '../../codeindex/index.js';
import { outputFormat, hasFlag } from '../shared.js';

export function codeIndexCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const jsonOut = outputFormat(args) === 'json';
  const lock = readJsonIfExists(lockPath);
  const built = buildCodeIndex(root, lock);
  if (!built.ok) return fail(built.error.message, built.error);

  const { jsonPath } = writeCodeIndexArtifacts(root, built);
  if (jsonOut) {
    console.log(JSON.stringify(built.index, null, 2));
  } else if (!hasFlag(args, '--quiet')) {
    console.log(`Wrote code index ${built.snapshotHash} (${built.index.artifact_counts.files} files, ${built.index.artifact_counts.symbols} symbols, ${built.index.artifact_counts.redacted} redacted)`);
    console.log(`Determinism hash: ${built.determinismHash.slice(0, 16)}`);
    console.log(`Index: ${path.relative(root, jsonPath)}`);
  }
  return 0;
}
