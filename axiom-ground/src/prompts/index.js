import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, readJsonIfExists, writeJson } from '../utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../utils/schema.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function promptRoot(root) {
  return path.join(root, '.contextlock', 'prompts');
}

function promptTypeDir(root, snapshotHash, promptType) {
  return path.join(promptRoot(root), snapshotHash, promptType);
}

function promptMetadataPath(root, snapshotHash, promptType) {
  return path.join(promptTypeDir(root, snapshotHash, promptType), `${promptType}.json`);
}

function promptMarkdownPath(root, snapshotHash, promptType) {
  return path.join(promptTypeDir(root, snapshotHash, promptType), `${promptType}.md`);
}

// ---------------------------------------------------------------------------
// Metadata read/write
// ---------------------------------------------------------------------------

export function readPromptMetadata(root, snapshotHash, promptType) {
  const file = promptMetadataPath(root, snapshotHash, promptType);
  if (!existsSync(file)) return null;
  return readJsonIfExists(file);
}

export function getLatestSnapshotHash(_root, lock) {
  return lock?.latest_snapshot_hash || null;
}

export function getPromptFreshness(root, latestSnapshotHash) {
  if (!latestSnapshotHash) return 'missing';
  const metadata = readPromptMetadata(root, latestSnapshotHash, 'onboarding');
  if (metadata) return 'fresh';

  const promptsDir = promptRoot(root);
  if (!existsSync(promptsDir)) return 'missing';
  const entries = readdirSync(promptsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const hasAnyPrompt = entries.some((entry) => entry.name !== latestSnapshotHash);
  return hasAnyPrompt ? 'stale' : 'missing';
}

// ---------------------------------------------------------------------------
// Onboarding prompt rendering
// ---------------------------------------------------------------------------

export function renderOnboardingPrompt(snapshot) {
  const facts = snapshot.machine_facts;
  const map = snapshot.project_map;
  const risks = snapshot.inferred_context?.risk_zones || [];
  const readFirst = map.important_files.slice(0, 5).map((item) => item.path);

  const lines = [];
  lines.push(`# ContextLock Onboarding Prompt`);
  lines.push('');
  lines.push(`Snapshot hash: ${snapshot.snapshot_hash}`);
  lines.push(`Source commit: ${snapshot.git.commit || 'unknown'}`);
  lines.push(`Project: ${snapshot.project_id}`);
  lines.push('');
  lines.push('You are onboarding into this repository using the exact snapshot above.');
  lines.push('Follow the project context below and do not assume anything not stated here.');
  lines.push('');
  lines.push('## Task boundary');
  lines.push('Onboarding only. Do not change code unless explicitly asked.');
  lines.push('If details are missing, ask for clarification instead of inventing facts.');
  lines.push('');
  lines.push('## Project summary');
  lines.push(snapshot.inferred_context?.summary || 'No summary inferred yet.');
  lines.push('');
  lines.push('## How to run');
  lines.push(facts.run_commands.length ? facts.run_commands.map((item) => `- ${item}`).join('\n') : '- No run command detected');
  lines.push('');
  lines.push('## How to test');
  lines.push(facts.test_commands.length ? facts.test_commands.map((item) => `- ${item}`).join('\n') : '- No test command detected');
  lines.push('');
  lines.push('## How to build');
  lines.push(facts.build_commands.length ? facts.build_commands.map((item) => `- ${item}`).join('\n') : '- No build command detected');
  lines.push('');
  lines.push('## Entrypoints');
  lines.push(facts.entrypoints.length ? facts.entrypoints.map((item) => `- ${item}`).join('\n') : '- None detected');
  lines.push('');
  lines.push('## Files to read first');
  lines.push(readFirst.length ? readFirst.map((item) => `- ${item}`).join('\n') : '- None detected');
  lines.push('');
  lines.push('## Known risks and constraints');
  lines.push(risks.length ? risks.map((item) => `- ${item}`).join('\n') : '- No obvious risk zones detected');
  lines.push('- Avoid assuming unsupported ecosystems have full extraction coverage.');
  lines.push('- Respect `.contextlock/` exclusion rules and secret redaction policies.');
  lines.push('');
  lines.push('## Relevant facts');
  lines.push(`- Languages: ${facts.languages.length ? facts.languages.join(', ') : 'None detected'}`);
  lines.push(`- Manifests: ${facts.manifests.length ? facts.manifests.join(', ') : 'None detected'}`);
  lines.push(`- Dependencies: ${facts.dependencies.length ? facts.dependencies.join(', ') : 'None detected'}`);
  lines.push('');
  lines.push('## Response format');
  lines.push('Answer with concise, actionable onboarding guidance and cite files/commands when relevant.');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt artifact persistence
// ---------------------------------------------------------------------------

export function writePromptArtifacts(root, snapshot, promptType, promptText) {
  const dir = promptTypeDir(root, snapshot.snapshot_hash, promptType);
  ensureDir(dir);
  const mdPath = promptMarkdownPath(root, snapshot.snapshot_hash, promptType);
  const jsonPath = promptMetadataPath(root, snapshot.snapshot_hash, promptType);
  const existingMetadata = readPromptMetadata(root, snapshot.snapshot_hash, promptType);
  const metadata = {
    schema_version: 1,
    artifact_type: 'prompt',
    prompt_id: existingMetadata?.prompt_id || `ctxprompt_${snapshot.snapshot_hash.slice(-12)}`,
    prompt_type: promptType,
    template_version: 1,
    project_id: snapshot.project_id,
    snapshot_hash: snapshot.snapshot_hash,
    source_commit: snapshot.git.commit,
    created_at: existingMetadata?.created_at || new Date().toISOString(),
    valid_until_snapshot_change: true,
    depends_on: snapshot.project_map.important_files.map((item) => item.path)
  };

  assertValidSchema(metadata, bundledSchemaPath('prompt'), 'prompt metadata');

  if (!existsSync(mdPath) || readFileSync(mdPath, 'utf8') !== `${promptText}\n`) {
    writeFileSync(mdPath, `${promptText}\n`);
  }
  if (!existingMetadata || JSON.stringify(existingMetadata) !== JSON.stringify(metadata)) {
    writeJson(jsonPath, metadata);
  }
  return { mdPath, jsonPath, metadata };
}

