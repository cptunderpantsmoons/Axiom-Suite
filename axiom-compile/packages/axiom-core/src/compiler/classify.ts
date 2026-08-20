import type { TaskType } from "../model/schema.js";

/** Deterministic task_type detection for the intent compiler (compiler/classify.ts). */
export function classifyTaskType(raw: string): TaskType {
  const t = raw.toLowerCase();
  if (/(fix|bug|broken|failing|issue|error|crash)/.test(t)) return "fix";
  if (/(refactor|improve|clean|better|optimiz|simplif|quality)\b/.test(t))
    return "refactor";
  if (/(test|coverage|spec\b)/.test(t)) return "test";
  if (/(setup|install|init|scaffold|onboard)/.test(t)) return "setup";
  if (/(document|readme|docs|comment)/.test(t)) return "docs";
  if (/(migrat|upgrad|port\b)/.test(t)) return "migration";
  if (/(investigat|analy|trace|debug root|understand)/.test(t))
    return "investigate";
  if (/(add|implement|build|create|make|feature|auth\b)/.test(t))
    return "feature";
  return "other";
}