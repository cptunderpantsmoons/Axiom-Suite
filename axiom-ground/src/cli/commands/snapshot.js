import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, fail } from '../../utils/core.js';
import { buildSnapshot, writeSnapshotArtifacts, updateLockAfterSnapshot } from '../../snapshot/index.js';
import { snapshotCiCommand } from '../../ci/index.js';
import { hasFlag, outputFormat } from '../shared.js';

export function snapshotCommand(args, cwd) {
  // CI mode
  if (hasFlag(args, '--ci')) {
    return snapshotCiCommand(args, cwd);
  }

  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const jsonOut = outputFormat(args) === 'json';
  const quiet = hasFlag(args, '--quiet');
  const incremental = hasFlag(args, '--incremental');
  const config = readJsonIfExists(configPath);
  const lock = readJsonIfExists(lockPath);
  const snapshot = buildSnapshot(root, config, lock, {
    generationMode: incremental ? 'incremental' : 'full',
    incrementalBaseSnapshotHash: incremental ? lock?.latest_snapshot_hash || null : null
  });
  writeSnapshotArtifacts(root, snapshot);
  updateLockAfterSnapshot(root, config, lock, snapshot);

  if (jsonOut) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else if (!quiet) {
    console.log(`Created snapshot ${snapshot.snapshot_hash}`);
    console.log(`Files: ${snapshot.machine_facts.file_count}`);
    console.log(`Snapshot written to .contextlock/snapshots/${snapshot.snapshot_hash}.json`);
  }
  return 0;
}
