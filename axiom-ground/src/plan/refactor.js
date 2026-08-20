import path from 'node:path';
import { makeTask } from './tasks.js';
import { GATES } from './gates.js';

// ---------------------------------------------------------------------------
// Refactor plan
// ---------------------------------------------------------------------------

export function generateRefactorPlan(root, plan, snapshot, audit, targetArea) {
  const facts = snapshot?.machine_facts || {};
  const map = snapshot?.project_map || {};
  const directories = map.directories || [];
  const debtMarkers = snapshot?.debt_markers || [];
  const testCommands = facts.test_commands || [];
  const buildCommands = facts.build_commands || [];
  const importantFiles = map.important_files || [];

  const area = targetArea || 'identified debt zones';
  const normalizedArea = area.replace(/^\.?\/?/, '');

  let affectedModules;
  let targetDebt;

  if (targetArea) {
    affectedModules = directories
      .filter((d) => d.path === normalizedArea || d.path.startsWith(normalizedArea + '/') || normalizedArea.startsWith(d.path + '/'))
      .map((d) => d.path);
    if (!affectedModules.length) affectedModules = [normalizedArea];
    if (!affectedModules.includes(normalizedArea) && normalizedArea) {
      affectedModules = [normalizedArea, ...affectedModules];
    }
    targetDebt = debtMarkers.filter((m) =>
      affectedModules.some((mod) => m.file.startsWith(mod + '/') || m.file.startsWith(mod))
    );
  } else {
    const auditDebt = (audit?.findings || []).filter((f) =>
      f.category === 'debt_drift' || f.category === 'test_drift' || f.category === 'documentation_drift'
    );
    affectedModules = [...new Set(auditDebt.flatMap((f) =>
      (f.evidence || []).map((e) => path.dirname(e.file || ''))
    ))].filter(Boolean);
    targetDebt = debtMarkers;
  }

  if (!affectedModules.length) affectedModules = ['src/'];

  plan.summary = `Refactor plan for ${affectedModules.join(', ')} based on ${targetDebt.length} debt markers${audit ? ` and drift score ${audit.final_drift_score}/100` : ''}.`;
  const tasks = [];

  tasks.push(makeTask({
    id: 'task-1-audit',
    description: `Audit current state of ${affectedModules.join(', ')}`,
    affectedModules,
    touchedFiles: importantFiles.filter((f) => affectedModules.some((m) => f.path.startsWith(m + '/'))).map((f) => f.path).slice(0, 5),
    steps: [
      'Run the full test suite and confirm all existing tests pass as baseline.',
      'Catalogue the debt markers and record the current drift score.',
      'Map the dependency graph for the affected modules.',
      'Record the baseline drift score with `ctx audit --since-last --json`.'
    ],
    acceptanceCriteria: [
      'All existing tests pass as baseline',
      'Debt markers catalogued',
      'Dependency graph mapped',
      'Current drift score recorded'
    ],
    qualityGates: [GATES.baseline(), GATES.testsPass(testCommands[0])],
    validationCmds: testCommands.length ? testCommands : ['[proposed: define test command]'],
    rollback: 'No changes made — nothing to roll back.',
    deps: [],
    refs: ['onboarding']
  }));

  if (targetDebt.length) {
    const priorityDebt = targetDebt
      .sort((a, b) => (b.marker === 'FIXME' ? 3 : b.marker === 'HACK' ? 2 : 1) - (a.marker === 'FIXME' ? 3 : a.marker === 'HACK' ? 2 : 1))
      .slice(0, 8);
    tasks.push(makeTask({
      id: 'task-2-debt',
      description: `Resolve ${priorityDebt.length} debt markers in ${affectedModules.join(', ')}`,
      affectedModules,
      touchedFiles: priorityDebt.map((m) => m.file),
      steps: [
        'Resolve each debt marker, keeping behavior identical.',
        'Re-run the test suite after each resolution.',
        'Re-snapshot and confirm no new debt markers were introduced.'
      ],
      acceptanceCriteria: priorityDebt.map((m) => `Resolve ${m.marker} at ${m.file}:${m.line}`),
      qualityGates: [GATES.testsPass(testCommands[0]), GATES.noNewDebt()],
      validationCmds: testCommands,
      rollback: 'Revert debt resolution commits.',
      deps: ['task-1-audit'],
      refs: ['onboarding']
    }));
  }

  const restId = targetDebt.length ? 'task-3-restructure' : 'task-2-restructure';
  const restDep = targetDebt.length ? 'task-2-debt' : 'task-1-audit';
  tasks.push(makeTask({
    id: restId,
    description: `Restructure ${affectedModules.join(', ')} for improved cohesion`,
    affectedModules,
    touchedFiles: ['[proposed: files identified during task-1-audit]'],
    steps: [
      'Move and reorganize modules to clarify boundaries without changing behavior.',
      'Update imports to the new module locations.',
      'Run the full test suite until green.',
      'Run `ctx rules validate` to confirm no architecture rule violations.',
      'Run `ctx audit --since-last --json` and confirm no new high-severity drift.'
    ],
    acceptanceCriteria: [
      'Module boundaries clarified',
      'No new architecture rule violations',
      'All tests continue to pass',
      'Import graph simplified where possible'
    ],
    qualityGates: [
      GATES.testsPass(testCommands[0]),
      GATES.noRuleViolation(),
      GATES.noHighDrift()
    ],
    validationCmds: [...testCommands, ...buildCommands],
    rollback: 'Revert restructure commits.',
    deps: [restDep],
    refs: ['onboarding']
  }));

  const testId = targetDebt.length ? 'task-4-tests' : 'task-3-tests';
  const testDep = targetDebt.length ? 'task-3-restructure' : 'task-2-restructure';
  tasks.push(makeTask({
    id: testId,
    description: 'Update tests for restructured code',
    affectedModules: [...affectedModules],
    touchedFiles: ['[proposed: test files corresponding to restructured modules]'],
    steps: [
      'Update test imports and paths to match the restructured modules.',
      'Maintain or improve test coverage across the affected modules.',
      'Run the full suite including integration tests until green.',
      'Run `ctx audit --since-last --json` and confirm no test drift.'
    ],
    acceptanceCriteria: [
      'Test coverage maintained or improved',
      'Integration tests pass',
      'No test drift introduced'
    ],
    qualityGates: [GATES.testsPass(testCommands[0]), GATES.noHighDrift()],
    validationCmds: testCommands,
    rollback: 'Revert test changes.',
    deps: [testDep],
    refs: []
  }));

  const docsId = targetDebt.length ? 'task-5-docs' : 'task-4-docs';
  const docsDep = targetDebt.length ? 'task-4-tests' : 'task-3-tests';
  tasks.push(makeTask({
    id: docsId,
    description: 'Update documentation to reflect refactored structure',
    affectedModules: ['docs/'],
    touchedFiles: ['[proposed: README.md, architecture docs]'],
    steps: [
      'Document the new module structure and responsibilities.',
      'Update entrypoint documentation if paths changed.',
      'Verify README commands still match the project.',
      'Run `ctx audit --since-last --json` and confirm no documentation drift.'
    ],
    acceptanceCriteria: [
      'New module structure documented',
      'Entrypoints updated if changed',
      'README commands verified'
    ],
    qualityGates: [GATES.docsMatch()],
    validationCmds: [],
    rollback: 'Revert documentation changes.',
    deps: [docsDep],
    refs: []
  }));

  plan.tasks = tasks;
  plan.rollback_plan = `1. Revert all commits in reverse task order.\n2. Run ${testCommands.join(', ') || 'tests'} to confirm baseline.\n3. Verify drift score returns to pre-refactor level.`;
  plan.validation_summary = `Validate by running: ${[...testCommands, ...buildCommands].join('; ')} and ctx audit --since-last`;
  plan.audit_checkpoints = ['pre-refactor', 'post-debt', 'post-restructure', 'post-tests', 'post-docs'];
  return plan;
}
