import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonIfExists, resolveGitRoot, fail } from '../utils/core.js';
import { latestAuditArtifact } from '../audit/index.js';
import { recordPlanAudit } from '../progress/index.js';

// ---------------------------------------------------------------------------
// Audit against plan
// ---------------------------------------------------------------------------

function auditAgainstPlan(root, planId) {
  const plansDir = path.join(root, '.contextlock', 'plans');
  const planPath = path.join(plansDir, `${planId}.json`);

  if (!existsSync(planPath)) {
    return { error: `Plan ${planId} not found.` };
  }

  const plan = readJsonIfExists(planPath);
  if (!plan || plan.artifact_type !== 'plan') {
    return { error: `Invalid plan artifact: ${planId}` };
  }

  const lockPath = path.join(root, '.contextlock', 'lock.json');
  const lock = readJsonIfExists(lockPath);
  const currentHash = lock?.latest_snapshot_hash || null;
  const audit = latestAuditArtifact(root, lock);

  const findings = [];

  // Check if plan was based on an older snapshot
  if (currentHash && plan.snapshot_hash && currentHash !== plan.snapshot_hash) {
    findings.push({
      id: 'plan-stale-snapshot',
      severity: 'medium',
      category: 'plan_drift',
      title: 'Plan was based on a different snapshot',
      evidence: [
        { text: `Plan snapshot: ${plan.snapshot_hash}` },
        { text: `Current snapshot: ${currentHash}` }
      ],
      recommendation: 'Regenerate the plan from the latest snapshot.'
    });
  }

  // Check each task for completion signals
  for (const task of plan.tasks) {
    const taskFiles = task.expected_touched_files.filter((f) => !f.startsWith('[proposed:'));

    if (taskFiles.length) {
      const hasTestCmd = task.validation_commands.some((cmd) =>
        cmd.includes('test') || cmd.includes('pytest') || cmd.includes('--test')
      );

      if (hasTestCmd && task.id.includes('implement') && currentHash !== plan.snapshot_hash) {
        const driftIncreased = audit && plan.context.latest_drift_score !== null &&
          audit.final_drift_score > plan.context.latest_drift_score;

        if (driftIncreased) {
          findings.push({
            id: `plan-task-drift:${task.id}`,
            severity: 'medium',
            category: 'plan_drift',
            title: `Task "${task.description}" may have introduced drift`,
            evidence: [
              { text: `Previous drift: ${plan.context.latest_drift_score}/100` },
              { text: `Current drift: ${audit.final_drift_score}/100` }
            ],
            recommendation: 'Review the implementation for architecture violations or missing tests.'
          });
        }
      }
    }

    if (!taskFiles.length && task.validation_commands.length) {
      findings.push({
        id: `plan-task-untracked:${task.id}`,
        severity: 'low',
        category: 'plan_drift',
        title: `Task "${task.description}" has no tracked file targets`,
        evidence: [{ text: 'All expected files are marked as [proposed:]' }],
        recommendation: 'Define concrete file targets for this task and re-audit.'
      });
    }

    // Quality-gate enforcement: every task should carry verifiable gates and
    // detailed steps so completion is checkable rather than assumed.
    if (!Array.isArray(task.quality_gates) || task.quality_gates.length === 0) {
      findings.push({
        id: `plan-task-ungated:${task.id}`,
        severity: 'low',
        category: 'plan_drift',
        title: `Task "${task.description}" has no quality gates`,
        evidence: [{ text: 'Every task should define verifiable quality gates.' }],
        recommendation: 'Regenerate the plan so each task embeds quality gates.'
      });
    }
    if (!Array.isArray(task.steps) || task.steps.length === 0) {
      findings.push({
        id: `plan-task-undetailed:${task.id}`,
        severity: 'low',
        category: 'plan_drift',
        title: `Task "${task.description}" has no detailed steps`,
        evidence: [{ text: 'Every task should break down into concrete steps.' }],
        recommendation: 'Regenerate the plan so each task has detailed steps.'
      });
    }
  }

  // Check if plan audit checkpoints were met
  if (plan.audit_checkpoints.length > 1) {
    const completedCheckpoints = currentHash !== plan.snapshot_hash ? 1 : 0;
    if (completedCheckpoints < plan.audit_checkpoints.length) {
      findings.push({
        id: 'plan-checkpoints-incomplete',
        severity: 'low',
        category: 'plan_drift',
        title: 'Plan audit checkpoints may not be complete',
        evidence: [
          { text: `Checkpoints: ${plan.audit_checkpoints.join(', ')}` },
          { text: `Completed: ${completedCheckpoints} of ${plan.audit_checkpoints.length}` }
        ],
        recommendation: 'Create snapshots and run audits at each checkpoint.'
      });
    }
  }

  const mediumHigh = findings.filter((f) => f.severity === 'high' || f.severity === 'medium');
  const verdict = mediumHigh.length === 0
    ? 'Plan appears on track'
    : `${mediumHigh.length} concerns need attention`;

  const taskResults = plan.tasks.map((task) => {
    const issues = findings.filter((f) => f.id && f.id.endsWith(`:${task.id}`));
    return { id: task.id, gates_verified: issues.length === 0, issue_count: issues.length };
  });

  const progressLedger = recordPlanAudit(root, {
    plan_id: planId,
    plan_type: plan.plan_type,
    verified_at: new Date().toISOString(),
    on_track: mediumHigh.length === 0,
    verdict,
    findings_total: findings.length,
    task_results: taskResults
  });

  return {
    plan_id: planId,
    plan_type: plan.plan_type,
    plan_snapshot: plan.snapshot_hash,
    current_snapshot: currentHash,
    findings,
    verdict,
    progress_ledger: progressLedger.written ? 'updated' : 'not-found'
  };
}

// ---------------------------------------------------------------------------
// CLI: ctx audit --against-plan
// ---------------------------------------------------------------------------

export function auditPlanCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const planIndex = args.indexOf('--against-plan');
  if (planIndex === -1) {
    return fail('--against-plan <plan_id> is required', {
      reason: 'Plan audit requires an explicit plan id.',
      recovery: 'Pass the id of a generated plan artifact.',
      command: 'ctx audit --against-plan <plan_id>',
      code: 2
    });
  }

  const planId = args[planIndex + 1];
  if (!planId) {
    return fail('--against-plan requires a plan ID', {
      reason: 'The flag was provided without a following plan id.',
      recovery: 'Pass the id of a generated plan artifact.',
      command: 'ctx audit --against-plan <plan_id>',
      code: 2
    });
  }

  const result = auditAgainstPlan(root, planId);

  if (result.error) {
    return fail(result.error, {
      reason: 'The requested plan audit could not be completed.',
      recovery: 'Verify the plan id exists and regenerate snapshots if needed.',
      command: 'ctx plan feature',
      code: 1
    });
  }

  console.log(`# Plan Audit: ${result.plan_type} plan ${result.plan_id}`);
  console.log(`Plan snapshot: ${result.plan_snapshot || 'unknown'}`);
  console.log(`Current snapshot: ${result.current_snapshot || 'unknown'}`);
  console.log(`Verdict: ${result.verdict}`);
  if (result.progress_ledger === 'updated') {
    console.log('Progress ledger: updated (docs/planning/contextlock-progress.json)');
  } else {
    console.log('Progress ledger: not found — results printed to stdout only.');
  }
  console.log('');

  if (result.findings.length) {
    console.log('## Findings');
    for (const f of result.findings) {
      console.log(`- **${f.title}** (${f.severity})`);
      for (const e of f.evidence) {
        console.log(`  - ${e.text}`);
      }
    }
  } else {
    console.log('No findings — plan appears on track.');
  }

  return result.findings.filter((f) => f.severity === 'high').length > 0 ? 1 : 0;
}
