import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJson } from '../utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../utils/schema.js';

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderPlanMarkdown(plan) {
  const lines = [];
  lines.push(`# ContextLock ${plan.plan_type.charAt(0).toUpperCase() + plan.plan_type.slice(1)} Plan`);
  lines.push('');
  lines.push(`- **Plan ID**: \`${plan.plan_id}\``);
  lines.push(`- **Project**: ${plan.context.project_name}`);
  lines.push(`- **Snapshot**: \`${plan.snapshot_hash || 'none'}\``);
  lines.push(`- **Drift score**: ${plan.context.latest_drift_score ?? 'unknown'}/100`);
  lines.push(`- **Prompt freshness**: ${plan.context.prompt_freshness}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(plan.summary);
  lines.push('');
  lines.push('## Project context');
  lines.push(`- Languages: ${plan.context.languages.join(', ') || 'none'}`);
  lines.push(`- Entrypoints: ${plan.context.entrypoints.join(', ') || 'none'}`);
  lines.push(`- Test: ${plan.context.test_commands.join(', ') || 'none'}`);
  lines.push(`- Build: ${plan.context.build_commands.join(', ') || 'none'}`);
  lines.push('');

  if (plan.context.audit_findings.length) {
    lines.push('## Current audit findings');
    for (const f of plan.context.audit_findings) {
      lines.push(`- ${f.severity}: ${f.title}`);
    }
    lines.push('');
  }

  if (plan.quality_gates && plan.quality_gates.length) {
    lines.push('## Quality gates (whole plan)');
    for (const gate of plan.quality_gates) {
      lines.push(`- [ ] **${gate.name}** — \`${gate.command}\``);
      if (gate.description) lines.push(`      ${gate.description}`);
    }
    lines.push('');
  }

  lines.push('## Tasks');
  for (const task of plan.tasks) {
    lines.push(`### ${task.id}: ${task.description}`);
    lines.push(`- **Modules**: ${task.affected_modules.join(', ')}`);
    if (task.expected_touched_files.length) {
      lines.push(`- **Files**: ${task.expected_touched_files.join(', ')}`);
    }
    lines.push(`- **Depends on**: ${task.depends_on.length ? task.depends_on.join(', ') : 'none'}`);
    lines.push('');

    if (task.steps && task.steps.length) {
      lines.push('**Steps:**');
      task.steps.forEach((step, index) => {
        lines.push(`${index + 1}. ${step}`);
      });
      lines.push('');
    }

    lines.push('**Acceptance criteria:**');
    for (const ac of task.acceptance_criteria) {
      lines.push(`- [ ] ${ac}`);
    }
    lines.push('');

    if (task.quality_gates && task.quality_gates.length) {
      lines.push('**Quality gates:**');
      for (const gate of task.quality_gates) {
        lines.push(`- [ ] **${gate.name}** — \`${gate.command}\``);
        if (gate.description) lines.push(`      ${gate.description}`);
      }
      lines.push('');
    }

    lines.push('**Validation:**');
    for (const cmd of task.validation_commands) {
      lines.push(`    ${cmd}`);
    }
    lines.push('');
    lines.push(`**Rollback**: ${task.rollback_criteria}`);
    lines.push('');
  }

  lines.push('## Rollback plan');
  lines.push(plan.rollback_plan);
  lines.push('');
  lines.push('## Audit checkpoints');
  for (const cp of plan.audit_checkpoints) {
    lines.push(`- ${cp}`);
  }
  lines.push('');
  lines.push('## Validation summary');
  lines.push(plan.validation_summary);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Artifact persistence
// ---------------------------------------------------------------------------

export function writePlanArtifacts(root, plan) {
  assertValidSchema(plan, bundledSchemaPath('plan'), 'plan');
  const plansDir = path.join(root, '.contextlock', 'plans');
  ensureDir(plansDir);
  const jsonPath = path.join(plansDir, `${plan.plan_id}.json`);
  const mdPath = path.join(plansDir, `${plan.plan_id}.md`);
  writeJson(jsonPath, plan);
  writeFileSync(mdPath, `${renderPlanMarkdown(plan)}\n`);
  return { jsonPath, mdPath };
}
