import path from 'node:path';
import { readJsonIfExists, writeJson } from '../utils/core.js';

// ---------------------------------------------------------------------------
// Planning progress ledger
//
// `docs/planning/contextlock-progress.json` is the version-controlled record of
// spec/build/guardrail status. `ctx progress` reads and updates it so progress
// is marked off through a checked command rather than hand-editing.
// ---------------------------------------------------------------------------

const PROGRESS_RELATIVE_PATH = path.join('docs', 'planning', 'contextlock-progress.json');

const GUARDRAIL_GROUPS = { active: 'active_enforcement', planned: 'planned_enforcement' };
const GUARDRAIL_STATUSES = ['pass', 'fail', 'warn'];

export function progressJsonPath(root) {
  return path.join(root, PROGRESS_RELATIVE_PATH);
}

export function loadProgress(root) {
  return readJsonIfExists(progressJsonPath(root));
}

export function setProgressStatus(root, kind, id, status) {
  const data = loadProgress(root);
  if (!data) {
    return { error: `Progress file not found at ${PROGRESS_RELATIVE_PATH}` };
  }

  const scale = Array.isArray(data.status_scale) ? data.status_scale : [];
  if (scale.length && !scale.includes(status)) {
    return { error: `Invalid status "${status}". Allowed: ${scale.join(', ')}` };
  }

  let collection;
  let label;
  if (kind === 'spec') {
    collection = Array.isArray(data.specs) ? data.specs : [];
    label = (item) => item.id;
  } else if (kind === 'build') {
    collection = Array.isArray(data.builds) ? data.builds : [];
    label = (item) => item.name || String(item.id);
  } else {
    return { error: 'kind must be "spec" or "build"' };
  }

  const target = collection.find((item) => String(item.id) === String(id));
  if (!target) {
    return { error: `${kind} "${id}" not found in progress file` };
  }

  const previous = target.status;
  if (previous === status) {
    return { ok: true, kind, id, label: label(target), previous, status, unchanged: true };
  }

  target.status = status;
  data.updated_at = new Date().toISOString();
  writeJson(progressJsonPath(root), data);

  return { ok: true, kind, id, label: label(target), previous, status, unchanged: false };
}

export function setGuardrailStatus(root, group, name, status) {
  const data = loadProgress(root);
  if (!data) {
    return { error: `Progress file not found at ${PROGRESS_RELATIVE_PATH}` };
  }

  const key = GUARDRAIL_GROUPS[group];
  if (!key) {
    return { error: 'guardrail group must be "active" or "planned"' };
  }

  if (!GUARDRAIL_STATUSES.includes(status)) {
    return { error: `Invalid guardrail status "${status}". Allowed: ${GUARDRAIL_STATUSES.join(', ')}` };
  }

  if (!data.guardrails || typeof data.guardrails !== 'object' || Array.isArray(data.guardrails)) {
    data.guardrails = {};
  }
  if (typeof data.guardrails[key] !== 'object' || data.guardrails[key] === null || Array.isArray(data.guardrails[key])) {
    data.guardrails[key] = {};
  }

  const previous = data.guardrails[key][name];
  const unchanged = previous === status;
  data.guardrails[key][name] = status;
  data.updated_at = new Date().toISOString();
  writeJson(progressJsonPath(root), data);

  return { ok: true, group: key, name, previous: previous ?? null, status, unchanged };
}

export function recordPlanAudit(root, entry) {
  const data = loadProgress(root);
  if (!data) {
    return { written: false, reason: 'progress file not found' };
  }

  if (!Array.isArray(data.plan_audits)) data.plan_audits = [];
  data.plan_audits = data.plan_audits.filter((e) => e && e.plan_id !== entry.plan_id);
  data.plan_audits.push(entry);
  data.updated_at = new Date().toISOString();

  writeJson(progressJsonPath(root), data);
  return { written: true };
}
