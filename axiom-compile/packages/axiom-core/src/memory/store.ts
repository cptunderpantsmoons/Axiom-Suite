import type { MemoryRule } from "../model/schema.js";

/**
 * M1 memory store skeleton. Per PLAN §4 the full 4-layer SQLite store ships in
 * M4. In M1 we keep an in-memory rule list so pipeline retrieval is wired and
 * testable without a DB dependency. The schema (`MemoryRule`) is already locked.
 */
const rules: MemoryRule[] = [];

export const store = {
  async listAll(): Promise<MemoryRule[]> {
    return [...rules];
  },
  async add(rule: MemoryRule): Promise<MemoryRule> {
    rules.push(rule);
    return rule;
  },
  async clear(): Promise<void> {
    rules.length = 0;
  },
};