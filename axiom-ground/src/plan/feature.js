import path from 'node:path';
import { makeTask } from './tasks.js';
import { GATES } from './gates.js';

// ---------------------------------------------------------------------------
// Feature plan
// ---------------------------------------------------------------------------

export function generateFeaturePlan(root, plan, snapshot, audit, targetArea) {
  const facts = snapshot?.machine_facts || {};
  const map = snapshot?.project_map || {};
  const importantFiles = map.important_files || [];
  const directories = map.directories || [];
  const entrypoints = facts.entrypoints || [];
  const testCommands = facts.test_commands || [];
  const buildCommands = facts.build_commands || [];
  const debtMarkers = snapshot?.debt_markers || [];

  const area = targetArea || 'the feature';
  const normalizedArea = area.replace(/^\.?\/?/, '');

  const matchingDirs = directories.filter((d) =>
    d.path === normalizedArea || d.path.startsWith(normalizedArea + '/') || normalizedArea.startsWith(d.path + '/')
  );
  let affectedModules = matchingDirs.length
    ? matchingDirs.map((d) => d.path)
    : [normalizedArea || 'src/'];

  if (targetArea && !affectedModules.includes(normalizedArea) && normalizedArea) {
    affectedModules = [normalizedArea, ...affectedModules];
  }

  const areaFiles = importantFiles.filter((f) =>
    affectedModules.some((mod) => f.path.startsWith(mod + '/') || f.path === mod)
  );
  const testDirs = directories.filter((d) => d.role === 'tests');
  const testFiles = importantFiles.filter((f) =>
    testDirs.some((td) => f.path.startsWith(td.path + '/'))
  );
  const areaDebt = debtMarkers.filter((m) =>
    affectedModules.some((mod) => m.file.startsWith(mod + '/') || m.file.startsWith(mod))
  );

  plan.summary = `Feature plan for "${area}" in ${plan.context.project_name}.`;
  const tasks = [];

  const filesToRead = areaFiles.length
    ? areaFiles.slice(0, 5).map((f) => f.path)
    : entrypoints.slice(0, 3);
  tasks.push(makeTask({
    id: 'task-1-understand',
    description: `Review current implementation in ${affectedModules.join(', ')}`,
    affectedModules,
    touchedFiles: filesToRead.length ? filesToRead : ['[proposed: identify relevant files]'],
    steps: [
      'Read the identified files and note current behavior, patterns, and conventions.',
      'Map the imports and dependencies that touch the affected modules.',
      `Run the test suite (${testCommands.join(', ') || 'define a test command'}) and confirm a green baseline.`,
      'Record the baseline drift score with `ctx audit --since-last --json` before making changes.'
    ],
    acceptanceCriteria: [
      'Existing code patterns and conventions understood',
      'Dependencies and imports mapped',
      'Test coverage baseline noted'
    ],
    qualityGates: [GATES.baseline(), GATES.testsPass(testCommands[0])],
    validationCmds: testCommands.length ? testCommands : ['[proposed: define test command]'],
    rollback: 'No changes made yet — nothing to roll back.',
    deps: [],
    refs: ['onboarding']
  }));

  if (areaDebt.length) {
    tasks.push(makeTask({
      id: 'task-2-cleanup',
      description: 'Address existing debt markers before feature work',
      affectedModules,
      touchedFiles: areaDebt.slice(0, 5).map((m) => m.file),
      steps: [
        'Resolve each listed debt marker, one commit per marker where practical.',
        'Re-run the test suite after each resolution to catch regressions early.',
        'Re-snapshot (`ctx snapshot`) and confirm no new debt markers were introduced.'
      ],
      acceptanceCriteria: areaDebt.slice(0, 3).map((m) => `Resolve ${m.marker} at ${m.file}:${m.line}: ${m.text}`),
      qualityGates: [GATES.testsPass(testCommands[0]), GATES.noNewDebt()],
      validationCmds: testCommands.length ? testCommands : ['[proposed: define test command]'],
      rollback: 'Revert cleanup commits if they introduce regressions.',
      deps: ['task-1-understand'],
      refs: ['onboarding']
    }));
  }

  const nextId = areaDebt.length ? 'task-3-tests' : 'task-2-tests';
  const testDep = areaDebt.length ? 'task-2-cleanup' : 'task-1-understand';
  tasks.push(makeTask({
    id: nextId,
    description: `Write tests for the new ${area} behavior`,
    affectedModules: [...affectedModules, ...testDirs.map((d) => d.path)],
    touchedFiles: testFiles.length ? testFiles.slice(0, 3).map((f) => f.path) : ['[proposed: create test file in tests/]'],
    steps: [
      'Create test files covering the happy path and edge cases for the new behavior.',
      'Include at least one negative-path test.',
      'Run the new tests and confirm they fail before implementation (TDD red).',
      'Run the full suite to confirm the baseline still passes.'
    ],
    acceptanceCriteria: [
      'Tests cover happy path and edge cases',
      'Tests fail before implementation (TDD red)',
      'At least one negative-path test included'
    ],
    qualityGates: [GATES.tddRed(testCommands[0]), GATES.testsPass(testCommands[0])],
    validationCmds: testCommands.length ? testCommands : ['[proposed: define test command]'],
    rollback: 'Delete newly added test files.',
    deps: [testDep],
    refs: ['onboarding']
  }));

  const implId = areaDebt.length ? 'task-4-implement' : 'task-3-implement';
  const implDep = areaDebt.length ? 'task-3-tests' : 'task-2-tests';
  tasks.push(makeTask({
    id: implId,
    description: `Implement ${area} feature`,
    affectedModules,
    touchedFiles: areaFiles.length ? areaFiles.map((f) => f.path) : ['[proposed: files in ' + (affectedModules.join(', ')) + ']'],
    steps: [
      `Implement the feature across ${affectedModules.join(', ')} following existing conventions.`,
      'Run the test suite and fix failures until green.',
      'Re-run `ctx snapshot` and confirm no new debt markers were introduced.',
      'Run `ctx rules validate` to confirm no architecture rule violations.',
      'Run `ctx audit --since-last --json` and confirm no new high-severity drift.'
    ],
    acceptanceCriteria: [
      'All acceptance criteria met',
      `Tests pass: ${testCommands.join(', ') || 'run test suite'}`,
      'No new debt markers introduced',
      'No architecture rule violations'
    ],
    qualityGates: [
      GATES.testsPass(testCommands[0]),
      GATES.noHighDrift(),
      GATES.noRuleViolation(),
      GATES.noNewDebt()
    ],
    validationCmds: [...testCommands, ...buildCommands],
    rollback: 'Revert implementation commit.',
    deps: [implDep],
    refs: ['onboarding']
  }));

  const docsId = areaDebt.length ? 'task-5-docs' : 'task-4-docs';
  const docsDep = areaDebt.length ? 'task-4-implement' : 'task-3-implement';
  const docFiles = importantFiles.filter((f) => f.reason && f.reason.includes('documentation'));
  tasks.push(makeTask({
    id: docsId,
    description: 'Update documentation for the new feature',
    affectedModules: docFiles.length ? [...new Set(docFiles.map((f) => path.dirname(f.path)))] : ['docs/'],
    touchedFiles: docFiles.length ? docFiles.map((f) => f.path) : ['[proposed: README.md, docs/]'],
    steps: [
      'Document the new behavior with runnable examples.',
      'Describe the new API surface and any configuration changes.',
      'Update the README if the feature affects setup or run flow.',
      'Run `ctx audit --since-last --json` and confirm no documentation drift.'
    ],
    acceptanceCriteria: [
      'Usage documented with examples',
      'API surface described',
      'README updated if feature affects setup/run flow'
    ],
    qualityGates: [GATES.docsMatch(), GATES.noHighDrift()],
    validationCmds: [],
    rollback: 'Revert documentation changes.',
    deps: [docsDep],
    refs: []
  }));

  plan.tasks = tasks;
  plan.rollback_plan = `1. Revert implementation commits in reverse order.\n2. Re-run ${testCommands.join(', ') || 'tests'} to confirm baseline.\n3. Remove any feature-specific configuration.`;
  plan.validation_summary = `Validate by running: ${[...testCommands, ...buildCommands].join('; ')}`;
  plan.audit_checkpoints = ['pre-implementation', 'post-tests', 'post-implementation', 'post-docs'];
  return plan;
}
