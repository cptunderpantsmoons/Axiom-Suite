// ---------------------------------------------------------------------------
// Task factory
//
// Every plan task carries detailed steps and verifiable quality gates so its
// completion is checkable rather than assumed. All fields are additive and
// validated against schemas/plan.schema.json.
// ---------------------------------------------------------------------------

export function makeTask({
  id,
  description,
  affectedModules,
  touchedFiles,
  steps = [],
  acceptanceCriteria,
  qualityGates = [],
  validationCmds,
  rollback,
  deps = [],
  refs = []
}) {
  return {
    id,
    description,
    affected_modules: affectedModules,
    expected_touched_files: touchedFiles,
    steps,
    acceptance_criteria: acceptanceCriteria,
    quality_gates: qualityGates,
    validation_commands: validationCmds,
    rollback_criteria: rollback || 'Revert the changes for this task.',
    depends_on: deps,
    references_prompts: refs
  };
}
