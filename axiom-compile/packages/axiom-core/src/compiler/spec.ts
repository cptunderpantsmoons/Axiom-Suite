import type { IntentResult, TaskType } from "../model/schema.js";

/** Structured spec build from a validated IntentResult (compiler/spec.ts). */

export interface Spec {
  objective: string;
  taskType: TaskType;
  targetArea: string;
  scopeLock: string;
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  verification: string[];
}

export function buildSpec(intent: IntentResult): Spec {
  return {
    objective: intent.summary,
    taskType: intent.task_type,
    targetArea: intent.target_area,
    scopeLock: intent.scope_lock,
    constraints: [...intent.constraints],
    nonGoals: [...intent.non_goals],
    acceptanceCriteria: [...intent.acceptance_criteria],
    verification: [...intent.verification_hints],
  };
}