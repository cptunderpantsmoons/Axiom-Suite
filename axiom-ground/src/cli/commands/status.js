import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, fail } from '../../utils/core.js';
import { detectSupportLevel } from '../../scanner/index.js';
import { getPromptFreshness } from '../../prompts/index.js';
import { hasFlag, outputFormat } from '../shared.js';

export function statusCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const config = readJsonIfExists(configPath);
  const lock = readJsonIfExists(lockPath);
  const supportLevel = detectSupportLevel(root);
  const promptFreshness = getPromptFreshness(root, lock?.latest_snapshot_hash || null);
  const status = {
    schema_version: 1,
    artifact_type: 'status',
    project: config?.project_name || path.basename(root),
    project_id: config?.project_id || lock?.project_id || null,
    branch: lock?.current_branch || 'unknown',
    commit: lock?.current_commit || 'unknown',
    initialized: true,
    support_level: supportLevel,
    prompt_cache: { onboarding: promptFreshness },
    last_drift_score: typeof lock?.latest_drift_score === 'number' ? lock.latest_drift_score : null
  };

  if (outputFormat(args) === 'json') {
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }

  console.log('ContextLock status');
  console.log(`Project: ${status.project}`);
  console.log(`Branch: ${status.branch}`);
  console.log(`Commit: ${status.commit}`);
  console.log(`Init: initialized`);
  console.log(`Support level: ${supportLevel}`);
  console.log(`Prompt cache: onboarding ${promptFreshness}`);
  console.log(`Last drift score: ${typeof status.last_drift_score === 'number' ? `${status.last_drift_score}/100` : 'unknown'}`);
  return 0;
}
