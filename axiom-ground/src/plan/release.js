import path from 'node:path';
import { makeTask } from './tasks.js';
import { GATES } from './gates.js';

// ---------------------------------------------------------------------------
// Release plan
// ---------------------------------------------------------------------------

export function generateReleasePlan(root, plan, snapshot, audit) {
  const facts = snapshot?.machine_facts || {};
  const testCommands = facts.test_commands || [];
  const buildCommands = facts.build_commands || [];
  const debtMarkers = snapshot?.debt_markers || [];
  const git = snapshot?.git || {};
  const driftScore = audit?.final_drift_score ?? 0;

  plan.summary = `Release plan for ${plan.context.project_name}${git.branch ? ` (${git.branch})` : ''}. Drift score: ${driftScore}/100.`;
  const tasks = [];

  tasks.push(makeTask({
    id: 'task-1-audit',
    description: 'Run full project audit and assess release readiness',
    affectedModules: ['[proposed: all modules]'],
    touchedFiles: ['.contextlock/snapshots/', '.contextlock/audits/'],
    steps: [
      'Run `ctx audit --since-last` and confirm the drift score is acceptable.',
      'Confirm no high-severity audit findings remain unaddressed.',
      'Confirm the prompt cache is fresh (`ctx doctor --json`).',
      'Confirm the secret scan passes before release.'
    ],
    acceptanceCriteria: [
      `Drift score below acceptable threshold (current: ${driftScore}/100)`,
      'No high-severity audit findings unaddressed',
      'Prompt cache is fresh',
      'Secret scan passes'
    ],
    qualityGates: [GATES.driftBelow(driftScore), GATES.promptFresh(), GATES.secretScan()],
    validationCmds: ['ctx audit --since-last', 'ctx status'],
    rollback: 'No changes made — nothing to roll back.',
    deps: [],
    refs: ['onboarding']
  }));

  const highDebt = debtMarkers.filter((m) => m.marker === 'FIXME' || m.marker === 'HACK');
  if (highDebt.length) {
    tasks.push(makeTask({
      id: 'task-2-debt',
      description: `Resolve ${highDebt.length} high-priority debt markers before release`,
      affectedModules: [...new Set(highDebt.map((m) => path.dirname(m.file)))],
      touchedFiles: highDebt.slice(0, 8).map((m) => m.file),
      steps: [
        'Resolve each high-priority debt marker, one commit per marker where practical.',
        'Re-run the test suite after each resolution.',
        'Re-snapshot and confirm no new debt markers were introduced.'
      ],
      acceptanceCriteria: highDebt.slice(0, 5).map((m) => `${m.marker} at ${m.file}:${m.line}: ${m.text}`),
      qualityGates: [GATES.testsPass(testCommands[0]), GATES.noNewDebt()],
      validationCmds: testCommands,
      rollback: 'Revert debt resolution commits.',
      deps: ['task-1-audit'],
      refs: []
    }));
  }

  const nextId = highDebt.length ? 'task-3-tests' : 'task-2-tests';
  const nextDep = highDebt.length ? 'task-2-debt' : 'task-1-audit';
  tasks.push(makeTask({
    id: nextId,
    description: 'Run complete test suite and verify all acceptance criteria',
    affectedModules: ['[proposed: all modules]'],
    touchedFiles: [],
    steps: [
      'Run the full unit test suite and confirm all tests pass.',
      'Run integration tests and confirm no regressions from baseline.',
      'Confirm performance remains within the acceptable range.',
      'Record the final drift score with `ctx audit --since-last --json`.'
    ],
    acceptanceCriteria: [
      'All tests pass',
      'Integration tests pass',
      'No regressions from baseline',
      'Performance within acceptable range'
    ],
    qualityGates: [GATES.testsPass(testCommands[0]), GATES.build(buildCommands[0])],
    validationCmds: [...testCommands, ...buildCommands],
    rollback: 'No changes made — nothing to roll back.',
    deps: [nextDep],
    refs: []
  }));

  const buildId = highDebt.length ? 'task-4-build' : 'task-3-build';
  const buildDep = highDebt.length ? 'task-3-tests' : 'task-2-tests';
  tasks.push(makeTask({
    id: buildId,
    description: 'Build and package the release',
    affectedModules: ['[proposed: build configuration]'],
    touchedFiles: ['[proposed: package.json, build scripts]'],
    steps: [
      'Run the build command and confirm it completes without errors.',
      'Verify generated artifacts are correct and complete.',
      'Bump the version appropriately and confirm the changelog reflects it.'
    ],
    acceptanceCriteria: [
      'Build completes without errors',
      'Artifacts generated correctly',
      'Version bumped appropriately'
    ],
    qualityGates: [GATES.build(buildCommands[0])],
    validationCmds: buildCommands.length ? buildCommands : ['[proposed: define build command]'],
    rollback: 'Delete build artifacts.',
    deps: [buildDep],
    refs: []
  }));

  const docsId = highDebt.length ? 'task-5-docs' : 'task-4-docs';
  const docsDep = highDebt.length ? 'task-4-build' : 'task-3-build';
  tasks.push(makeTask({
    id: docsId,
    description: 'Update changelog and release documentation',
    affectedModules: ['docs/'],
    touchedFiles: ['[proposed: CHANGELOG.md, README.md]'],
    steps: [
      'Update the changelog with all changes in this release.',
      'Write a migration guide if there are breaking changes.',
      'Verify the README reflects the current state of the project.'
    ],
    acceptanceCriteria: [
      'Changelog updated with all changes',
      'Migration guide if breaking changes exist',
      'README reflects current state'
    ],
    qualityGates: [GATES.docsMatch()],
    validationCmds: [],
    rollback: 'Revert documentation changes.',
    deps: [docsDep],
    refs: []
  }));

  const snapId = highDebt.length ? 'task-6-snapshot' : 'task-5-snapshot';
  const snapDep = highDebt.length ? 'task-5-docs' : 'task-4-docs';
  tasks.push(makeTask({
    id: snapId,
    description: 'Generate final release snapshot and sync',
    affectedModules: ['.contextlock/'],
    touchedFiles: ['.contextlock/snapshots/', '.contextlock/lock.json'],
    steps: [
      'Run `ctx snapshot` to capture the final release state.',
      'Refresh the prompt cache with `ctx prompt refresh --all`.',
      'Regenerate the site with `ctx site build`.',
      'Sync to remote with `ctx sync` if a remote is configured.'
    ],
    acceptanceCriteria: [
      'Release snapshot created',
      'Prompt cache refreshed',
      'Site regenerated',
      'Remote synced if configured'
    ],
    qualityGates: [GATES.determinism(), GATES.promptFresh(), GATES.siteBuilds()],
    validationCmds: ['ctx snapshot', 'ctx prompt refresh --all', 'ctx site build', 'ctx sync'],
    rollback: 'Revert to previous snapshot.',
    deps: [snapDep],
    refs: ['onboarding']
  }));

  plan.tasks = tasks;
  plan.rollback_plan = `1. Revert to previous release tag.\n2. Re-run ${testCommands.join(', ') || 'tests'} to confirm.\n3. Notify team of rollback.`;
  plan.validation_summary = `Validate by running: ${[...testCommands, ...buildCommands].join('; ')}; ctx audit --since-last`;
  plan.audit_checkpoints = ['pre-release-audit', 'post-debt-resolution', 'post-test-suite', 'post-build', 'release-ready'];
  return plan;
}
