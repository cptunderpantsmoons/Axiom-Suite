import path from 'node:path';
import { readJsonIfExists, sha256 } from '../utils/core.js';
import { loadSnapshotArtifact } from '../snapshot/index.js';
import { latestAuditArtifact } from '../audit/index.js';
import { getPromptFreshness } from '../prompts/index.js';
import { globalQualityGates } from './gates.js';
import { generateFeaturePlan } from './feature.js';
import { generateRefactorPlan } from './refactor.js';
import { generateReleasePlan } from './release.js';

// ---------------------------------------------------------------------------
// Plan base builder
// ---------------------------------------------------------------------------

function buildPlanBase(root, planType, snapshot, audit, config) {
  const projectName = config?.project_name || path.basename(root);
  const planIdSource = `${planType}:${snapshot?.snapshot_hash || 'nosnap'}:${new Date().toISOString()}`;
  const planId = `ctxplan_${sha256(planIdSource).slice(0, 16)}`;

  return {
    schema_version: 2,
    artifact_type: 'plan',
    plan_id: planId,
    plan_type: planType,
    project_id: snapshot?.project_id || config?.project_id || projectName,
    snapshot_hash: snapshot?.snapshot_hash || null,
    source_commit: snapshot?.git?.commit || null,
    created_at: new Date().toISOString(),
    summary: '',
    context: {
      project_name: projectName,
      languages: snapshot?.machine_facts?.languages || [],
      entrypoints: snapshot?.machine_facts?.entrypoints || [],
      test_commands: snapshot?.machine_facts?.test_commands || [],
      build_commands: snapshot?.machine_facts?.build_commands || [],
      dependencies: snapshot?.machine_facts?.dependencies || [],
      latest_drift_score: audit?.final_drift_score ?? null,
      audit_findings: (audit?.findings || []).map((f) => ({ id: f.id, title: f.title, severity: f.severity })),
      prompt_freshness: snapshot?.snapshot_hash
        ? getPromptFreshness(root, snapshot.snapshot_hash)
        : 'unknown'
    },
    quality_gates: globalQualityGates(snapshot?.machine_facts || {}),
    tasks: [],
    audit_checkpoints: ['post-implementation'],
    rollback_plan: '',
    validation_summary: ''
  };
}

// ---------------------------------------------------------------------------
// Plan generation dispatcher
// ---------------------------------------------------------------------------

export function generatePlan(root, planType, targetArea = null) {
  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');

  const config = readJsonIfExists(configPath);
  const lock = readJsonIfExists(lockPath);
  const snapshotHash = lock?.latest_snapshot_hash || null;
  const snapshot = snapshotHash ? loadSnapshotArtifact(root, snapshotHash) : null;
  const audit = latestAuditArtifact(root, lock);

  if (!snapshot) {
    return { error: 'No snapshot found. Run `ctx snapshot` first.' };
  }

  const plan = buildPlanBase(root, planType, snapshot, audit, config);

  switch (planType) {
    case 'feature':
      return generateFeaturePlan(root, plan, snapshot, audit, targetArea);
    case 'refactor':
      return generateRefactorPlan(root, plan, snapshot, audit, targetArea);
    case 'release':
      return generateReleasePlan(root, plan, snapshot, audit);
    default:
      return { error: `Unknown plan type: ${planType}. Use feature, refactor, or release.` };
  }
}
