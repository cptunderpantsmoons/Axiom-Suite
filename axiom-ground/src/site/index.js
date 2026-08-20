import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, escapeHtml, readJsonIfExists, sha256, writeJson } from '../utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../utils/schema.js';
import { writeLockJson } from '../init/index.js';
import { loadSnapshotArtifact } from '../snapshot/index.js';
import { latestAuditArtifact } from '../audit/index.js';
import { promptRoot, readPromptMetadata } from '../prompts/index.js';
import { progressJsonPath } from '../progress/index.js';
import { SITE_CSS, SITE_JS } from './assets.js';

// ---------------------------------------------------------------------------
// HTML rendering helpers
// ---------------------------------------------------------------------------

function renderHtmlDocument(title, body, cssPath = 'assets/contextlock.css') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${cssPath}">
</head>
<body>
${body}
</body>
</html>
`;
}

function renderLinkList(items) {
  if (!items.length) return '<p class="muted">None</p>';
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function renderKeyValueList(entries) {
  return `<dl>${entries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function renderBadge(label, tone = 'neutral') {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function renderTable(rows) {
  if (!rows.length) return '<p class="muted">None</p>';
  return `<table><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderNav(active) {
  const pages = [
    ['index.html', 'Dashboard'],
    ['snapshot.html', 'Snapshot'],
    ['architecture.html', 'Architecture'],
    ['prompts.html', 'Prompts'],
    ['audit.html', 'Audit'],
    ['claims.html', 'Claims'],
    ['progress.html', 'Progress'],
    ['plans.html', 'Plans']
  ];
  return `<nav>${pages.map(([href, label]) => `<a class="${href === active ? 'active' : ''}" href="${href}">${label}</a>`).join('')}</nav>`;
}

// ---------------------------------------------------------------------------
// Prompt status helper
// ---------------------------------------------------------------------------

function loadPlanArtifacts(root) {
  const plansDir = path.join(root, '.contextlock', 'plans');
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJsonIfExists(path.join(plansDir, file)))
    .filter((plan) => plan && plan.artifact_type === 'plan')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function renderGateList(gates, planId, taskId = null) {
  if (!Array.isArray(gates) || !gates.length) return '<p class="muted">No gates defined.</p>';
  return `<ul class="gates">${gates.map((gate) => `<li><label><input type="checkbox" class="gate-check" data-plan="${escapeHtml(planId || '')}"${taskId ? ` data-task="${escapeHtml(taskId)}"` : ''} data-gate="${escapeHtml(gate.name)}"> <strong>${escapeHtml(gate.name)}</strong></label><code>${escapeHtml(gate.command)}</code><div class="muted">${escapeHtml(gate.description)}</div></li>`).join('')}</ul>`;
}

function sitePromptStatus(root, snapshotHash) {
  const metadata = readPromptMetadata(root, snapshotHash, 'onboarding');
  if (metadata) return { status: 'fresh', metadata };
  const promptsDir = promptRoot(root);
  if (!existsSync(promptsDir)) return { status: 'missing', metadata: null };
  return { status: 'stale', metadata: null };
}

// ---------------------------------------------------------------------------
// Export helper
// ---------------------------------------------------------------------------

export function copyDirRecursive(fromDir, toDir) {
  ensureDir(toDir);
  for (const entry of readdirSync(fromDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const src = path.join(fromDir, entry.name);
    const dest = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dest);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(dest));
      copyFileSync(src, dest);
    }
  }
}

// ---------------------------------------------------------------------------
// Site builder
// ---------------------------------------------------------------------------

export function buildSiteArtifacts(root, lock) {
  const snapshotHash = lock?.latest_snapshot_hash || null;
  const snapshot = loadSnapshotArtifact(root, snapshotHash);
  const audit = latestAuditArtifact(root, lock);
  const prompt = snapshotHash ? readPromptMetadata(root, snapshotHash, 'onboarding') : null;
  const promptState = sitePromptStatus(root, snapshotHash);
  const plans = loadPlanArtifacts(root);
  const planSignature = plans.map((plan) => `${plan.plan_id}:${plan.created_at}`).join(',');
  const siteHashSource = JSON.stringify({ snapshotHash, auditId: audit?.audit_id || null, promptId: prompt?.prompt_id || null, promptState: promptState.status, plans: planSignature });
  const siteHash = `ctxsite_${sha256(siteHashSource).slice(0, 16)}`;
  const siteDir = path.join(root, '.contextlock', 'site');
  const assetsDir = path.join(siteDir, 'assets');
  ensureDir(siteDir);
  ensureDir(assetsDir);

  const projectName = readJsonIfExists(path.join(root, '.contextlock', 'config.json'))?.project_name || path.basename(root);
  const branch = lock?.current_branch || snapshot?.git?.branch || 'unknown';
  const commit = lock?.current_commit || snapshot?.git?.commit || 'unknown';
  const driftScore = typeof lock?.latest_drift_score === 'number' ? lock.latest_drift_score : audit?.final_drift_score ?? 0;
  const promptLabel = promptState.status === 'fresh' ? 'Fresh' : promptState.status === 'stale' ? 'Stale' : 'Missing';
  const promptTone = promptState.status === 'fresh' ? 'good' : promptState.status === 'stale' ? 'warn' : 'bad';
  const auditTone = driftScore >= 76 ? 'bad' : driftScore >= 51 ? 'warn' : 'good';

  const snapshotSummary = snapshot ? renderKeyValueList([
    ['Snapshot hash', `<code>${escapeHtml(snapshot.snapshot_hash)}</code>`],
    ['Branch', `<code>${escapeHtml(branch)}</code>`],
    ['Commit', `<code>${escapeHtml(commit)}</code>`],
    ['Languages', renderLinkList(snapshot.machine_facts.languages.map((item) => `<code>${escapeHtml(item)}</code>`))],
    ['Manifests', renderLinkList(snapshot.machine_facts.manifests.map((item) => `<code>${escapeHtml(item)}</code>`))],
    ['Test commands', renderLinkList(snapshot.machine_facts.test_commands.map((item) => `<code>${escapeHtml(item)}</code>`))],
    ['Build commands', renderLinkList(snapshot.machine_facts.build_commands.map((item) => `<code>${escapeHtml(item)}</code>`))],
    ['Entrypoints', renderLinkList(snapshot.machine_facts.entrypoints.map((item) => `<code>${escapeHtml(item)}</code>`))]
  ]) : '<p class="muted">No snapshot available.</p>';

  const topRisks = snapshot?.inferred_context?.risk_zones?.length ? renderLinkList(snapshot.inferred_context.risk_zones.map((item) => `<code>${escapeHtml(item)}</code>`)) : '<p class="muted">None detected.</p>';
  const findings = audit?.findings || [];
  const findingsHtml = findings.length ? `<ul>${findings.map((finding) => `<li><strong>${escapeHtml(finding.title)}</strong> <span class="severity severity-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span><div class="muted">${escapeHtml(finding.recommendation)}</div></li>`).join('')}</ul>` : '<p class="muted">No audit yet.</p>';

  // ---- index.html ----
  const indexHtml = renderHtmlDocument(`ContextLock — ${projectName}`, `
<header class="hero">
  ${renderNav('index.html')}
  <h1>ContextLock</h1>
  <p>${escapeHtml(projectName)}</p>
  <div class="badges">
    ${renderBadge(`Drift ${driftScore}/100`, auditTone)}
    ${renderBadge(`Prompt ${promptLabel}`, promptTone)}
    ${renderBadge(`Branch ${branch}`)}
  </div>
</header>
<main>
  <section>
    <h2>Project health</h2>
    ${renderKeyValueList([
      ['Latest snapshot', snapshot ? `<code>${escapeHtml(snapshot.snapshot_hash)}</code>` : '<span class="muted">None</span>'],
      ['Latest audit', audit ? `<code>${escapeHtml(audit.audit_id)}</code>` : '<span class="muted">None</span>'],
      ['Prompt cache', `<span class="status-${promptState.status}">${escapeHtml(promptLabel)}</span>`],
      ['Last drift score', `<code>${escapeHtml(String(driftScore))}/100</code>`]
    ])}
  </section>
  <section>
    <h2>Top risks</h2>
    ${topRisks}
  </section>
  <section>
    <h2>Latest findings</h2>
    ${findingsHtml}
  </section>
</main>`);

  // ---- snapshot.html ----
  const snapshotHtml = renderHtmlDocument(`Snapshot — ${projectName}`, `
${renderNav('snapshot.html')}
<main>
  <section>
    <h1>Snapshot</h1>
    <p><code>${escapeHtml(snapshotHash || 'unknown')}</code></p>
    ${snapshot ? snapshotSummary : '<p class="muted">No snapshot available.</p>'}
  </section>
  <section>
    <h2>Files to read first</h2>
    ${snapshot ? renderLinkList(snapshot.project_map.important_files.map((item) => `<code>${escapeHtml(item.path)}</code> — ${escapeHtml(item.reason)}`)) : '<p class="muted">None.</p>'}
  </section>
  <section>
    <h2>Debt markers</h2>
    ${snapshot ? renderTable(snapshot.debt_markers.map((item) => [
      `<code>${escapeHtml(item.file)}</code>`,
      escapeHtml(String(item.line)),
      escapeHtml(item.marker),
      escapeHtml(item.text)
    ])) : '<p class="muted">None.</p>'}
  </section>
</main>`);

  // ---- architecture.html ----
  const architectureHtml = renderHtmlDocument(`Architecture — ${projectName}`, `
${renderNav('architecture.html')}
<main>
  <section>
    <h1>Architecture</h1>
    ${snapshot ? renderTable(snapshot.project_map.directories.map((item) => [
      `<code>${escapeHtml(item.path)}</code>`,
      escapeHtml(item.role),
      escapeHtml(String(item.file_count))
    ])) : '<p class="muted">No directory map available.</p>'}
  </section>
  <section>
    <h2>Inferred architecture</h2>
    ${snapshot ? renderLinkList(snapshot.inferred_context.architecture.map((item) => `<code>${escapeHtml(item)}</code>`)) : '<p class="muted">None.</p>'}
  </section>
</main>`);

  // ---- prompts.html ----
  const promptsHtml = renderHtmlDocument(`Prompts — ${projectName}`, `
${renderNav('prompts.html')}
<main>
  <section>
    <h1>Prompts</h1>
    <p>${renderBadge(promptLabel, promptTone)}</p>
    ${prompt ? renderKeyValueList([
      ['Prompt ID', `<code>${escapeHtml(prompt.prompt_id)}</code>`],
      ['Snapshot hash', `<code>${escapeHtml(prompt.snapshot_hash)}</code>`],
      ['Source commit', `<code>${escapeHtml(prompt.source_commit || 'unknown')}</code>`],
      ['Path', `<code>${escapeHtml(path.join('.contextlock', 'prompts', snapshotHash || '', 'onboarding', 'onboarding.md'))}</code>`]
    ]) : '<p class="muted">No prompt available.</p>'}
  </section>
</main>`);

  // ---- audit.html ----
  const auditHtml = renderHtmlDocument(`Audit — ${projectName}`, `
${renderNav('audit.html')}
<main>
  <section>
    <h1>Audit</h1>
    ${audit ? renderKeyValueList([
      ['Audit ID', `<code>${escapeHtml(audit.audit_id)}</code>`],
      ['Drift score', `<code>${escapeHtml(String(audit.final_drift_score))}/100</code>`],
      ['Scoring version', `<code>${escapeHtml(String(audit.scoring_version))}</code>`],
      ['Findings', `<code>${escapeHtml(String(audit.findings.length))}</code>`]
    ]) : '<p class="muted">No audit available.</p>'}
  </section>
  <section>
    <h2>Findings</h2>
    ${audit ? findingsHtml : '<p class="muted">No audit available.</p>'}
  </section>
</main>`);

  // ---- claims.html ----
  const claimsHtml = renderHtmlDocument(`Claims — ${projectName}`, `
${renderNav('claims.html')}
<main>
  <section>
    <h1>Claim ledger</h1>
    ${snapshot?.human_annotations?.architecture_claims?.length ? renderLinkList(snapshot.human_annotations.architecture_claims.map((claim) => `<code>${escapeHtml(JSON.stringify(claim))}</code>`)) : '<p class="muted">No claim ledger entries yet.</p>'}
  </section>
</main>`);

  // ---- progress.html ----
  const progressData = readJsonIfExists(progressJsonPath(root));
  const progressSpecs = progressData?.specs || [];
  const progressBuilds = progressData?.builds || [];
  const doneSpecs = progressSpecs.filter(s => s.status === 'done').length;
  const summaryHtml = `<p><code>${doneSpecs}/${progressSpecs.length}</code> specs done; mode: <code>${escapeHtml(progressData?.quality_gate_policy?.mode || 'unknown')}</code></p>`;
  const specsHtml = progressSpecs.length ? renderTable(progressSpecs.map((s) => [
    `<code>${escapeHtml(s.id)}</code>`,
    escapeHtml(s.status),
    renderBadge(escapeHtml(s.owner || 'unknown'), s.status === 'done' ? 'good' : s.status === 'validated' ? 'good' : s.status === 'in_progress' ? 'warn' : 'neutral'),
    escapeHtml(s.path)
  ])) : '<p class="muted">No specs tracked.</p>';
  const buildsHtml = progressBuilds.length ? renderTable(progressBuilds.map((b) => [
    `<code>Build ${escapeHtml(String(b.id))}</code>`,
    escapeHtml(b.name),
    renderBadge(escapeHtml(b.status), b.status === 'done' ? 'good' : b.status === 'validated' ? 'good' : b.status === 'in_progress' ? 'warn' : b.status === 'blocked' ? 'bad' : 'neutral')
  ])) : '<p class="muted">No builds tracked.</p>';

  const guardrails = progressData?.guardrails || {};
  const activeMap = new Map(Object.entries(guardrails.active_enforcement || {}));
  const plannedMap = new Map(Object.entries(guardrails.planned_enforcement || {}));
  const allKeys = [...new Set([...activeMap.keys(), ...plannedMap.keys()])].sort();
  const guardrailsHtml = allKeys.length ? renderTable(allKeys.map((k) => [
    escapeHtml(k),
    renderBadge(escapeHtml(activeMap.get(k) ?? plannedMap.get(k)), (activeMap.get(k) ?? plannedMap.get(k)) === 'fail' ? 'bad' : (activeMap.get(k) ?? plannedMap.get(k)) === 'warn' ? 'warn' : 'neutral'),
    renderBadge(activeMap.has(k) ? 'active' : 'planned', 'neutral')
  ])) : '<p class="muted">No guardrails tracked.</p>';

  const progressHtml = renderHtmlDocument(`Progress — ${projectName}`, `
${renderNav('progress.html')}
<main>
  <section>
    <h1>Progress</h1>
    ${summaryHtml}
  </section>
  <section>
    <h2>Specs</h2>
    ${specsHtml}
  </section>
  <section>
    <h2>Builds</h2>
    ${buildsHtml}
  </section>
  <section>
    <h2>Guardrails</h2>
    ${guardrailsHtml}
    ${guardrails.notes ? `<p class="muted">${escapeHtml(guardrails.notes)}</p>` : ''}
  </section>
</main>`);

  // ---- plans.html ----
  const plansSummaryHtml = plans.length
    ? renderTable(plans.map((plan) => [
      `<a href="#plan-${escapeHtml(plan.plan_id)}"><code>${escapeHtml(plan.plan_id)}</code></a>`,
      renderBadge(escapeHtml(plan.plan_type)),
      `<code>${escapeHtml(String(plan.context?.latest_drift_score ?? 'unknown'))}/100</code>`,
      `<code>${escapeHtml(String(plan.tasks?.length ?? 0))}</code> tasks`,
      `<code>${escapeHtml(String(plan.quality_gates?.length ?? 0))}</code> gates`
    ]))
    : '<p class="muted">No plans generated yet. Run <code>ctx plan feature</code>, <code>ctx plan refactor</code>, or <code>ctx plan release</code>.</p>';

  const plansDetailHtml = plans.length
    ? plans.map((plan) => {
      const planGateTotal = (plan.quality_gates?.length || 0) + (plan.tasks || []).reduce((sum, task) => sum + (task.quality_gates?.length || 0), 0);
      return `
  <section id="plan-${escapeHtml(plan.plan_id)}">
    <h2>${escapeHtml(plan.plan_type)} plan — <code>${escapeHtml(plan.plan_id)}</code></h2>
    <p class="plan-gate-summary" data-plan="${escapeHtml(plan.plan_id)}"><span class="gate-done">0</span>/<span class="gate-total">${escapeHtml(String(planGateTotal))}</span> gates done</p>
    <div class="gate-progress" data-plan="${escapeHtml(plan.plan_id)}" role="progressbar" aria-valuemin="0" aria-valuemax="${escapeHtml(String(planGateTotal))}" aria-valuenow="0"><div class="gate-progress-fill"></div></div>
    <button type="button" class="clear-gates" data-plan="${escapeHtml(plan.plan_id)}">Clear checked gates</button>
    <p>${escapeHtml(plan.summary || '')}</p>
    ${renderKeyValueList([
      ['Snapshot', `<code>${escapeHtml(plan.snapshot_hash || 'none')}</code>`],
      ['Created', `<code>${escapeHtml(plan.created_at || 'unknown')}</code>`],
      ['Drift score', `<code>${escapeHtml(String(plan.context?.latest_drift_score ?? 'unknown'))}/100</code>`],
      ['Validation', escapeHtml(plan.validation_summary || '')]
    ])}
    <h3>Quality gates</h3>
    ${renderGateList(plan.quality_gates, plan.plan_id)}
    <h3>Tasks</h3>
    ${plan.tasks.map((task) => `
    <div class="plan-task">
      <h4>${escapeHtml(task.id)}: ${escapeHtml(task.description)}</h4>
      ${task.steps?.length ? `<p><strong>Steps</strong></p><ol>${task.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}
      ${task.acceptance_criteria?.length ? `<p><strong>Acceptance criteria</strong></p><ul>${task.acceptance_criteria.map((ac) => `<li>${escapeHtml(ac)}</li>`).join('')}</ul>` : ''}
      <p><strong>Quality gates</strong></p>
      ${renderGateList(task.quality_gates, plan.plan_id, task.id)}
      ${task.validation_commands?.length ? `<p><strong>Validation</strong></p>${renderLinkList(task.validation_commands.map((cmd) => `<code>${escapeHtml(cmd)}</code>`))}` : ''}
      <p class="muted"><strong>Rollback:</strong> ${escapeHtml(task.rollback_criteria || 'Revert the changes for this task.')}</p>
    </div>`).join('')}
  </section>`;
    }).join('')
    : '';

  const plansHtml = renderHtmlDocument(`Plans — ${projectName}`, `
${renderNav('plans.html')}
<main>
  <section>
    <h1>Plans</h1>
    ${plansSummaryHtml}
  </section>
  ${plansDetailHtml}
</main>
<script src="assets/contextlock.js" defer></script>`);

  // ---- Write all files ----
  writeFileSync(path.join(assetsDir, 'contextlock.css'), SITE_CSS + '\n');
  writeFileSync(path.join(assetsDir, 'contextlock.js'), SITE_JS + '\n');
  writeFileSync(path.join(siteDir, 'index.html'), `${indexHtml}`);
  writeFileSync(path.join(siteDir, 'snapshot.html'), `${snapshotHtml}`);
  writeFileSync(path.join(siteDir, 'architecture.html'), `${architectureHtml}`);
  writeFileSync(path.join(siteDir, 'prompts.html'), `${promptsHtml}`);
  writeFileSync(path.join(siteDir, 'audit.html'), `${auditHtml}`);
  writeFileSync(path.join(siteDir, 'claims.html'), `${claimsHtml}`);
  writeFileSync(path.join(siteDir, 'progress.html'), `${progressHtml}`);
  writeFileSync(path.join(siteDir, 'plans.html'), `${plansHtml}`);

  const existingSiteJson = readJsonIfExists(path.join(siteDir, 'site.json'));
  const siteDirJson = {
    schema_version: 1,
    artifact_type: 'site',
    site_hash: siteHash,
    project_id: lock?.project_id || null,
    snapshot_hash: snapshotHash,
    audit_id: audit?.audit_id || null,
    generated_at: existingSiteJson?.site_hash === siteHash && existingSiteJson?.generated_at ? existingSiteJson.generated_at : new Date().toISOString(),
    pages: ['index.html', 'snapshot.html', 'architecture.html', 'prompts.html', 'audit.html', 'claims.html', 'progress.html', 'plans.html']
  };
  assertValidSchema(siteDirJson, bundledSchemaPath('site'), 'site metadata');
  writeJson(path.join(siteDir, 'site.json'), siteDirJson);

  return { siteHash, siteDir, siteDirJson };
}

export function updateLockAfterSite(root, lock, siteData) {
  const next = {
    ...lock,
    latest_site: {
      site_hash: siteData.siteHash,
      snapshot_hash: siteData.siteDirJson.snapshot_hash,
      index_path: '.contextlock/site/index.html',
      generated_at: siteData.siteDirJson.generated_at
    },
    updated_at: new Date().toISOString()
  };
  writeLockJson(root, next);
  return next;
}
