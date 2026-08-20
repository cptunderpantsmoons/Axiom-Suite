import type { IntentResult } from "../model/schema.js";

/**
 * Ambiguity / risk scoring heuristics (compiler/ambiguity.ts).
 * Complements the model's own signal with deterministic rules.
 */

export function computeRisk(intent: IntentResult, rawRequest: string): {
  score: number;
  dangerous: "none" | "destructive" | "require_plan";
  needs_questions: boolean;
} {
  let score = intent.risk.score;
  const t = rawRequest.toLowerCase();

  // Short / under-specified requests are more ambiguous.
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  if (words < 6) score = Math.min(1, score + 0.2);

  // Vague qualifiers raise ambiguity.
  if (/(better|improve|something|thing|fix it|make it|asap)/.test(t)) {
    score = Math.min(1, score + 0.15);
  }

  const dangerous: IntentResult["risk"]["dangerous"] =
    /(delete|drop table|force push|rm -rf|truncate|sudo|shutdown|wipe)/.test(t)
      ? "destructive"
      : "none";

  const needs_questions = intent.questions.length > 0 && score >= 0.5;

  return { score, dangerous, needs_questions };
}