import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, fail } from '../utils/core.js';
import { generatePlan } from './generate.js';
import { writePlanArtifacts } from './render.js';

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

export { generatePlan } from './generate.js';
export { writePlanArtifacts } from './render.js';

// ---------------------------------------------------------------------------
// CLI: ctx plan
// ---------------------------------------------------------------------------

export function planCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const [planType, ...rest] = args;

  if (!planType || !['feature', 'refactor', 'release'].includes(planType)) {
    return fail('plan type must be feature, refactor, or release', {
      reason: 'Unsupported or missing plan type.',
      recovery: 'Choose one of the implemented plan types.',
      command: 'ctx plan feature',
      code: 2
    });
  }

  const areaIndex = rest.indexOf('--area');
  const targetArea = areaIndex !== -1 ? rest[areaIndex + 1] : null;
  const quiet = rest.includes('--quiet');

  const result = generatePlan(root, planType, targetArea);

  if (result.error) {
    return fail(result.error, {
      reason: 'The plan generator could not produce a valid plan from the current project artifacts.',
      recovery: 'Run snapshot and audit first, then retry planning.',
      command: 'ctx snapshot && ctx audit --since-last && ctx plan feature',
      code: 1
    });
  }

  const artifacts = writePlanArtifacts(root, result);

  if (!quiet) {
    console.log(`Created ${planType} plan ${result.plan_id}`);
    console.log(`Tasks: ${result.tasks.length}`);
    console.log(`Plan written to ${path.relative(root, artifacts.mdPath)}`);
  }

  console.log(result.plan_id);
  return 0;
}
