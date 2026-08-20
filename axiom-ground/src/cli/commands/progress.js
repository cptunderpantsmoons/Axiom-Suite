import { resolveGitRoot, fail } from '../../utils/core.js';
import { loadProgress, setProgressStatus, setGuardrailStatus } from '../../progress/index.js';
import { outputFormat } from '../shared.js';

function renderSummary(data) {
  const specs = data.specs || [];
  const builds = data.builds || [];
  const doneSpecs = specs.filter((s) => s.status === 'done' || s.status === 'validated').length;
  const doneBuilds = builds.filter((b) => b.status === 'done' || b.status === 'validated').length;
  const lines = [];
  lines.push(`Progress: ${doneSpecs}/${specs.length} specs, ${doneBuilds}/${builds.length} builds done`);
  lines.push(`Policy: ${data.quality_gate_policy?.mode || 'unknown'}`);
  lines.push('');
  lines.push('Specs:');
  for (const spec of specs) lines.push(`  ${spec.id} [${spec.status}] ${spec.path}`);
  lines.push('');
  lines.push('Builds:');
  for (const build of builds) lines.push(`  Build ${build.id} [${build.status}] ${build.name}`);
  lines.push('');
  lines.push('Guardrails:');
  const guardrails = data.guardrails || {};
  const active = guardrails.active_enforcement || {};
  const planned = guardrails.planned_enforcement || {};
  for (const [name, status] of Object.entries(active)) lines.push(`  active: ${name} [${status}]`);
  for (const [name, status] of Object.entries(planned)) lines.push(`  planned: ${name} [${status}]`);
  return lines.join('\n');
}

export function progressCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const [subcommand, ...rest] = args;

  if (subcommand === 'set') {
    const [kind, ...setArgs] = rest;

    if (kind === 'guardrail') {
      const [group, name, status] = setArgs;
      if (!group || !name || !status) {
        return fail('progress set guardrail requires <active|planned> <name> <status>', {
          reason: 'The guardrail group, name, and status must be provided.',
          recovery: 'Run `ctx progress` to see guardrail names; status is pass, fail, or warn.',
          command: 'ctx progress set guardrail active spec_link_check pass',
          code: 2
        });
      }
      const result = setGuardrailStatus(root, group, name, status);
      if (result.error) {
        return fail(result.error, {
          reason: 'The guardrail status could not be updated.',
          recovery: 'Verify the group, name, and status, then retry.',
          command: 'ctx progress',
          code: 1
        });
      }
      const verb = result.unchanged ? 'unchanged' : 'updated';
      console.log(`guardrail ${result.group}.${result.name}: ${result.previous ?? 'unset'} -> ${result.status} (${verb})`);
      return 0;
    }

    const [id, status] = setArgs;
    if (!id || !status || (kind !== 'spec' && kind !== 'build')) {
      return fail('progress set requires <spec|build> <id> <status>', {
        reason: 'A valid kind (spec or build), id, and target status must be provided.',
        recovery: 'Run `ctx progress` to see current ids and the status scale.',
        command: 'ctx progress set spec spec-19 validated',
        code: 2
      });
    }

    const result = setProgressStatus(root, kind, id, status);
    if (result.error) {
      return fail(result.error, {
        reason: 'The planning progress status could not be updated.',
        recovery: 'Verify the id and status against `ctx progress`, then retry.',
        command: 'ctx progress',
        code: 1
      });
    }

    const verb = result.unchanged ? 'unchanged' : 'updated';
    console.log(`${kind} "${result.label}" (${result.id}): ${result.previous} -> ${result.status} (${verb})`);
    return 0;
  }

  const data = loadProgress(root);
  if (!data) {
    return fail('progress file not found', {
      reason: 'docs/planning/contextlock-progress.json does not exist.',
      recovery: 'Create the planning progress ledger, then retry.',
      command: 'ctx progress',
      code: 1
    });
  }

  if (outputFormat(args) === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(renderSummary(data));
  }
  return 0;
}
