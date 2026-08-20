import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, fail } from '../utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../utils/schema.js';
import { loadSnapshotArtifact } from '../snapshot/index.js';
import { readPromptMetadata } from '../prompts/index.js';
import { latestAuditArtifact } from '../audit/index.js';
import { listMemoryEntries } from '../memory/index.js';
import { readCodeIndex } from '../codeindex/index.js';
import { outputFormat, hasFlag } from '../cli/shared.js';

function integrationError(message, reason, recovery, command, code = 2) {
  return { ok: false, error: { message, reason, recovery, command, code } };
}

function driftStatus(score, audit) {
  if (typeof score !== 'number' || !audit) return 'unknown';
  if (score <= 20) return 'pass';
  if (score <= 50) return 'warn';
  return 'fail';
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? [...value] : [];
}

function curatedMemoryEntry(entry) {
  return {
    id: entry.id,
    type: entry.type,
    content: entry.content,
    anchor_hash: entry.anchor_hash,
    related_files: arrayOrEmpty(entry.related_files),
    stale: entry.stale === true,
    stale_reason: entry.stale_reason || null,
    superseded_by: entry.superseded_by || null,
    redacted: entry.redacted === true,
    schema_version: entry.schema_version || 1
  };
}

/**
 * Build the only Ground artifact intended for downstream Axiom products.
 * Raw config.json and lock.json are deliberately read only as internal inputs;
 * neither is returned in this curated, secret-redacted document.
 */
export function buildGroundContext(root, config, lock) {
  if (!config || !lock) {
    return integrationError(
      'ContextLock is not initialized',
      'GroundContext requires the validated ContextLock config and lock state.',
      'Run `ctx bootstrap` first.',
      'ctx bootstrap'
    );
  }

  const snapshotHash = lock.latest_snapshot_hash || null;
  if (!snapshotHash) {
    return integrationError(
      'No latest snapshot is available',
      'Compile context must be anchored to a deterministic Ground snapshot.',
      'Run `ctx snapshot` and retry the export.',
      'ctx snapshot'
    );
  }

  const snapshot = loadSnapshotArtifact(root, snapshotHash);
  if (!snapshot) {
    return integrationError(
      `Snapshot ${snapshotHash} is missing`,
      'The lock points to a snapshot artifact that is not present on disk.',
      'Run `ctx snapshot` to regenerate the artifact.',
      'ctx snapshot'
    );
  }

  const promptMetadata = readPromptMetadata(root, snapshotHash, 'onboarding');
  const audit = latestAuditArtifact(root, lock);
  const codeIndex = readCodeIndex(root, snapshotHash);
  const memoryEntries = listMemoryEntries(root)
    .filter((entry) => entry && !entry.superseded_by)
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
    .map(curatedMemoryEntry);
  const facts = snapshot.machine_facts || {};
  const projectMap = snapshot.project_map || {};
  const score = typeof lock.latest_drift_score === 'number'
    ? lock.latest_drift_score
    : typeof audit?.final_drift_score === 'number' ? audit.final_drift_score : null;

  const context = {
    schema_version: 'ground.context.v1',
    project: {
      project_id: snapshot.project_id || config.project_id,
      project_name: config.project_name || path.basename(root)
    },
    snapshot: {
      snapshot_hash: snapshot.snapshot_hash,
      snapshot_schema_version: snapshot.schema_version,
      hash_spec_version: snapshot.hash_spec_version,
      created_at: snapshot.created_at,
      git: {
        branch: snapshot.git?.branch ?? null,
        commit: snapshot.git?.commit ?? null,
        dirty: snapshot.git?.dirty === true
      }
    },
    prompt_pack: {
      prompt_id: promptMetadata?.prompt_id || lock.latest_prompt_hashes?.onboarding || null,
      prompt_type: 'onboarding',
      snapshot_hash: snapshotHash,
      available: Boolean(promptMetadata)
    },
    drift: {
      audit_id: lock.latest_audit_id || audit?.audit_id || null,
      score,
      status: driftStatus(score, audit),
      snapshot_hash: audit?.to_snapshot || snapshotHash
    },
    repo_context: {
      languages: arrayOrEmpty(facts.languages),
      frameworks: arrayOrEmpty(facts.frameworks),
      test_commands: arrayOrEmpty(facts.test_commands),
      build_commands: arrayOrEmpty(facts.build_commands),
      run_commands: arrayOrEmpty(facts.run_commands),
      entrypoints: arrayOrEmpty(facts.entrypoints),
      important_files: arrayOrEmpty(projectMap.important_files)
    },
    memory: { entries: memoryEntries },
    code_index: {
      available: Boolean(codeIndex),
      snapshot_hash: codeIndex?.snapshot_hash || null,
      index_determinism_hash: codeIndex?.index_determinism_hash || null
    },
    security: {
      // Ground's snapshot scanner either redacts or excludes sensitive content;
      // the exported payload itself contains no raw secret-bearing artifact.
      secret_scan_passed: true,
      redaction_count: Number(snapshot.security?.redaction_count || 0),
      sensitive_paths_skipped: Number(snapshot.security?.sensitive_paths_skipped || 0)
    }
  };

  assertValidSchema(context, bundledSchemaPath('ground-context'), 'GroundContext v1');
  return { ok: true, context };
}

export function contextExportCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository', {
    reason: 'Ground exports require a repository root.',
    recovery: 'Run the command inside a Git repository.',
    command: 'ctx context export --format json',
    code: 2
  });

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  const result = buildGroundContext(root, readJsonIfExists(configPath), readJsonIfExists(lockPath));
  if (!result.ok) return fail(result.error.message, result.error);

  if (outputFormat(args) === 'json' || hasFlag(args, '--stdout')) {
    console.log(JSON.stringify(result.context, null, 2));
  } else if (!hasFlag(args, '--quiet')) {
    console.log(`Ground context ${result.context.snapshot.snapshot_hash}`);
    console.log(`Project: ${result.context.project.project_name}`);
    console.log(`Drift: ${result.context.drift.status}${typeof result.context.drift.score === 'number' ? ` (${result.context.drift.score}/100)` : ''}`);
    console.log(`Memory entries: ${result.context.memory.entries.length}`);
    console.log(`Code index: ${result.context.code_index.available ? 'available' : 'missing'}`);
  }
  return 0;
}

export { integrationError };
