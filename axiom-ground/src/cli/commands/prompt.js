import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, fail } from '../../utils/core.js';
import { writeLockJson } from '../../init/index.js';
import { getLatestSnapshotHash, getPromptFreshness, renderOnboardingPrompt, writePromptArtifacts } from '../../prompts/index.js';
import { loadSnapshotArtifact } from '../../snapshot/index.js';
import { hasFlag } from '../shared.js';

export function promptRefreshCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(lockPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  const lock = readJsonIfExists(lockPath);
  const snapshotHash = getLatestSnapshotHash(root, lock);
  if (!snapshotHash) return fail('no latest snapshot found; run `ctx snapshot` first');

  const force = hasFlag(args, '--all');
  const changed = hasFlag(args, '--changed');
  const quiet = hasFlag(args, '--quiet');
  const freshness = getPromptFreshness(root, snapshotHash);
  if (changed && !force && freshness === 'fresh') {
    if (!quiet) console.log('Onboarding prompt already fresh');
    return 0;
  }
  return promptCommand(['onboarding', ...(quiet ? ['--quiet'] : [])], cwd);
}

export function promptCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const [promptType] = args;
  if (promptType === 'refresh') {
    return promptRefreshCommand(args.slice(1), cwd);
  }

  if (promptType !== 'onboarding') {
    return fail(`prompt type "${promptType || ''}" is not implemented yet`, {
      reason: 'Only the onboarding prompt compiler is available in the current alpha flow.',
      recovery: 'Use the implemented onboarding prompt command.',
      command: 'ctx prompt onboarding',
      code: 2
    });
  }

  const stdoutOnly = hasFlag(args, '--stdout');
  const quiet = hasFlag(args, '--quiet');
  const lock = readJsonIfExists(lockPath);
  const snapshotHash = getLatestSnapshotHash(root, lock);
  if (!snapshotHash) return fail('no latest snapshot found; run `ctx snapshot` first');

  const snapshot = loadSnapshotArtifact(root, snapshotHash);
  if (!snapshot) return fail(`snapshot ${snapshotHash} is missing; regenerate it with 'ctx snapshot'`);

  const promptText = renderOnboardingPrompt(snapshot);
  const artifacts = writePromptArtifacts(root, snapshot, promptType, promptText);
  const nextLock = {
    ...lock,
    latest_prompt_hashes: {
      ...(lock?.latest_prompt_hashes || {}),
      onboarding: artifacts.metadata.prompt_id
    },
    updated_at: new Date().toISOString()
  };
  if (!stdoutOnly) {
    writeLockJson(root, nextLock);
  }

  if (stdoutOnly) {
    console.log(promptText);
  } else if (!quiet) {
    console.log(`Created onboarding prompt ${artifacts.metadata.prompt_id}`);
    console.log(`Prompt freshness: ${getPromptFreshness(root, snapshotHash)}`);
    console.log(`Prompt written to ${path.relative(root, artifacts.mdPath)}`);
  }
  return 0;
}
