// ---------------------------------------------------------------------------
// Quality gate factories
//
// A quality gate is a named, verifiable checkpoint with an associated command
// that must pass before a plan task (or the whole plan) is considered done.
// Gates are derived from project facts (detected commands) so they stay
// concrete and runnable rather than aspirational.
// ---------------------------------------------------------------------------

export function makeGate(name, command, description) {
  return { name, command, description };
}

export const GATES = {
  baseline: () => makeGate(
    'Baseline recorded',
    'ctx snapshot && ctx audit --since-last --json',
    'A baseline snapshot and drift score are recorded before changes begin.'
  ),
  testsPass: (testCmd) => makeGate(
    'Tests pass',
    testCmd || '[proposed: define test command]',
    'The full test suite is green before this task is considered done.'
  ),
  tddRed: (testCmd) => makeGate(
    'TDD red confirmed',
    testCmd || '[proposed: define test command]',
    'New tests fail before implementation (red) and pass after it (green).'
  ),
  noHighDrift: () => makeGate(
    'No new high-severity drift',
    'ctx audit --since-last --json',
    'The drift audit reports no new high-severity findings from this work.'
  ),
  noRuleViolation: () => makeGate(
    'No architecture rule violations',
    'ctx rules validate',
    'Architecture rules still validate after the change.'
  ),
  noNewDebt: () => makeGate(
    'No new debt markers',
    'ctx snapshot',
    'No new TODO/FIXME/HACK markers are introduced.'
  ),
  docsMatch: () => makeGate(
    'Docs match reality',
    'ctx audit --since-last --json',
    'No documentation drift is introduced by this task.'
  ),
  build: (buildCmd) => makeGate(
    'Build succeeds',
    buildCmd || '[proposed: define build command]',
    'The project builds without errors.'
  ),
  secretScan: () => makeGate(
    'Secret scan passes',
    'ctx audit --since-last --json',
    'No secret material appears in generated artifacts.'
  ),
  promptFresh: () => makeGate(
    'Prompt cache fresh',
    'ctx prompt refresh --changed',
    'The onboarding prompt is not stale after the change.'
  ),
  driftBelow: (score) => makeGate(
    `Drift at or below ${score}/100`,
    'ctx audit --since-last --json',
    'Release readiness requires the drift score not to exceed the recorded value.'
  ),
  determinism: () => makeGate(
    'Determinism preserved',
    'ctx snapshot',
    'Re-running snapshot on identical input yields an identical hash.'
  ),
  siteBuilds: () => makeGate(
    'Site regenerates',
    'ctx site build',
    'The static site builds successfully from updated artifacts.'
  )
};

// Global gates that apply to every plan, derived from project facts.
export function globalQualityGates(facts) {
  const testCmd = facts?.test_commands?.[0];
  const buildCmd = facts?.build_commands?.[0];
  const gates = [
    GATES.testsPass(testCmd),
    GATES.noHighDrift(),
    GATES.secretScan(),
    GATES.determinism()
  ];
  if (buildCmd) gates.push(GATES.build(buildCmd));
  return gates;
}
