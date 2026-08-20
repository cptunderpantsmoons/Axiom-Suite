import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, sha256, fail } from '../../utils/core.js';
import { writeLockJson } from '../../init/index.js';
import { buildAuditFindings, scoreAudit, writeAuditArtifacts, chooseAuditPair } from '../../audit/index.js';
import { loadSnapshotArtifact } from '../../snapshot/index.js';
import { auditPrCommand } from '../../ci/index.js';
import { auditPlanCommand } from '../../plan/audit.js';
import { hasFlag, outputFormat } from '../shared.js';

export function auditCommand(args, cwd) {
  // PR mode
  if (hasFlag(args, '--pr')) {
    return auditPrCommand(args, cwd);
  }

  // Plan audit mode
  if (hasFlag(args, '--against-plan')) {
    return auditPlanCommand(args, cwd);
  }

  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const quiet = hasFlag(args, '--quiet');
  const jsonOut = outputFormat(args) === 'json';
  const lock = readJsonIfExists(lockPath);
  const { fromHash, toHash } = chooseAuditPair(root, lock, args);
  if (!fromHash || !toHash) {
    return fail('unable to determine snapshots to audit; create at least two snapshots or provide --from/--to');
  }

  const fromSnapshot = loadSnapshotArtifact(root, fromHash);
  const toSnapshot = loadSnapshotArtifact(root, toHash);
  if (!fromSnapshot || !toSnapshot) {
    return fail(`missing snapshot artifact(s) for audit: ${fromHash} -> ${toHash}`);
  }

  const config = readJsonIfExists(configPath);
  const findings = buildAuditFindings(root, fromSnapshot, toSnapshot, config);
  const { final_drift_score, score_breakdown } = scoreAudit(findings, config);
  const audit = {
    schema_version: 1,
    artifact_type: 'audit',
    audit_id: `audit_${sha256(`${fromHash}:${toHash}`).slice(0, 16)}`,
    project_id: lock.project_id,
    from_snapshot: fromHash,
    to_snapshot: toHash,
    from_commit: fromSnapshot.git.commit,
    to_commit: toSnapshot.git.commit,
    created_at: new Date().toISOString(),
    scoring_version: 1,
    scoring_model: 'weighted_heuristic',
    final_drift_score,
    score_breakdown,
    findings,
    stale_prompts: findings.filter((finding) => finding.category === 'prompt_drift').map(() => 'onboarding')
  };

  writeAuditArtifacts(root, audit);
  const nextLock = {
    ...lock,
    latest_audit_id: audit.audit_id,
    latest_drift_score: final_drift_score,
    updated_at: new Date().toISOString()
  };
  writeLockJson(root, nextLock);

  if (jsonOut) {
    console.log(JSON.stringify(audit, null, 2));
  } else if (!quiet) {
    console.log(`Created audit ${audit.audit_id}`);
    console.log(`Drift score: ${final_drift_score}/100`);
    console.log(`Findings: ${findings.length}`);
  }
  return 0;
}
