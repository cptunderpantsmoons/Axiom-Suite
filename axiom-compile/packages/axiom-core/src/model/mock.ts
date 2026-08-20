import type { z } from "zod";
import type { ModelProvider, CompletionRequest } from "./provider.js";
import type { IntentResult as IntentResultType } from "./schema.js";
import { newId } from "../shared/ids.js";
import { classifyTaskType } from "../compiler/classify.js";

/**
 * M1 deterministic "fake model" (PLAN M1 exit: no network dependency).
 * This stands in for the DeepSeek intent compiler until M2. It is pure code —
 * no LLM call, fully testable. It emits a schema-valid IntentResult.
 */

function pickTargetArea(raw: string): string {
  if (/auth|login|session|sign.?in|token|permission/i.test(raw)) return "auth";
  if (/crud|table|list|endpoint|api/i.test(raw)) return "api";
  if (/worker|job|queue|scheduler/i.test(raw)) return "worker";
  if (/ui|page|screen|component|frontend/i.test(raw)) return "ui";
  return "app";
}

function acceptanceFor(raw: string, targetArea: string): string[] {
  const base = "The requested change is implemented in the target area";
  return [
    `${base} ("${targetArea}") exactly as scoped.`,
    "Existing behaviour is preserved wherever the request does not explicitly change it.",
    "All relevant tests pass; the project type-checks where configured.",
    "The result is verifiable by a reviewer from the output report alone.",
  ];
}

function verificationHints(targetArea: string): string[] {
  return [
    "Run the project test runner and any type-check script.",
    "Manually exercise the changed path in the target area.",
    `Confirm no changes leak outside "${targetArea}".`,
  ];
}

export const mockProvider: ModelProvider = {
  id: "mock",
  privateSafe: true, // deterministic local code — never touches a network.

  async complete<T>(req: CompletionRequest, schema: z.ZodType<T>): Promise<T> {
    // The mock only produces intent; the Zod schema stays the filter of record.
    return schema.parse(buildMockIntent(req.user)) as T;
  },
};

/** Turn the raw request line back out of the prompt for deterministic extraction. */
function rawFrom(reqUser: string): string {
  const m = reqUser.match(/Raw request:\s*("(?:[^"\\]|\\.)*")\s*(?:\n|$)/);
  if (m) {
    try {
      return JSON.parse(m[1]!);
    } catch {
      /* fall through */
    }
  }
  return reqUser;
}

export function buildMockIntent(reqUser: string): IntentResultType {
  const raw = rawFrom(reqUser);
  const targetArea = pickTargetArea(raw);
  const taskType = classifyTaskType(raw);

  const questions =
    targetArea === "auth"
      ? [
          {
            id: "q1",
            question: "Which part of auth do you want changed?",
            kind: "single_choice" as const,
            options: [
              { label: "Login flow", value: "login" },
              { label: "Permissions / roles", value: "permissions" },
              { label: "Tokens / sessions", value: "tokens" },
              { label: "Password handling", value: "passwords" },
            ],
            default: "login",
            rationale: "Auth spans login, permissions, tokens and passwords; the change differs materially per area.",
          },
          {
            id: "q2",
            question: "Is this a behaviour change or a code-quality refactor?",
            kind: "boolean" as const,
            options: [
              { label: "Behaviour change", value: "behaviour" },
              { label: "Refactor / quality", value: "quality" },
            ],
            default: "behaviour",
            rationale: "Determines acceptance criteria and how risky the change is.",
          },
        ]
      : [];

  const needsQuestions = questions.length > 0;
  const dangerous = /delete|drop table|drop\s+table|force push|sudo|rm -rf|truncate/i.test(
    raw,
  )
    ? ("destructive" as const)
    : "none";

  return {
    contract_v: 1,
    intent_id: newId(),
    task_type: taskType,
    summary: raw.trim(),
    target_area: targetArea,
    scope_lock: `Implement the requested ${taskType} in "${targetArea}" only; no scope expansion.`,
    assumptions: [
      `User intent interpreted as: "${raw.trim()}". Confirm if that is wrong.`,
      `Target area inferred as "${targetArea}" from the request wording.`,
    ],
    constraints: [],
    non_goals: [
      "No unrelated refactors outside the target area.",
      "No new features beyond the request.",
      "No rework of infrastructure the request does not touch.",
    ],
    acceptance_criteria: acceptanceFor(raw, targetArea),
    verification_hints: verificationHints(targetArea),
    risk: {
      score: needsQuestions ? 0.6 : 0.2,
      dangerous,
      needs_questions: needsQuestions,
    },
    questions,
  };
}