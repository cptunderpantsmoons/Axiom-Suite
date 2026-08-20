import type { MemoryRule } from "../model/schema.js";
import { store } from "./store.js";

/**
 * Layers A/B/C/D retrieval (PLAN §4):
 *   all global rules + all project rules + negative examples matching task_type
 * => flattened into constraints / non_goals.
 */
export async function retrieveFor(
  taskType: string,
  projectPath: string,
): Promise<{ constraints: string[]; nonGoals: string[] }> {
  const all = await store.listAll();
  const constraints: string[] = [];
  const nonGoals: string[] = [];

  for (const rule of all) {
    const matchesScope =
      rule.scope === "global" || rule.project_path === projectPath;
    const matchesTask = !rule.source_task_type || rule.source_task_type === taskType;
    if (!matchesScope) continue;

    if (rule.rule_type === "negative" && matchesTask) {
      nonGoals.push(rule.text);
    } else if (rule.rule_type === "template") {
      nonGoals.push(rule.text);
    } else {
      constraints.push(rule.text);
    }
  }
  return { constraints, nonGoals };
}