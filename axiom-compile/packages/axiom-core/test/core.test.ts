import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compileIntent,
  answerQuestions,
} from "../src/index.js";
import { TaskPacket, IntentResult } from "../src/model/schema.js";

const SECTIONS = [
  "task_contract",
  "project_context",
  "constraints",
  "non_goals",
  "acceptance_criteria",
  "verification",
  "relevant_code",
  "untrusted_content",
  "execution_rules",
  "output_contract",
];

describe("M1 headless core — intent to one-shot packet", () => {
  it('turns "make auth better" into a valid structured one-shot (M1 exit)', async () => {
    const res = await compileIntent("make auth better", { mode: "one-shot" });
    assert.equal(res.status, "ready");
    if (res.status !== "ready") return;

    // The Zod object is canonical: it must be a valid TaskPacket.
    const parsed = TaskPacket.safeParse(res.packet);
    assert.equal(parsed.success, true);

    assert.equal(res.packet.task_contract.task_type, "refactor");
    assert.equal(res.packet.task_contract.target_area, "auth");
    // §7 sections all present, in the documented order, no extras.
    const order = SECTIONS.map((s) => res.markup.indexOf(`<${s}>`));
    for (const s of SECTIONS) {
      assert.ok(res.markup.includes(`<${s}>`), `missing <${s}>`);
      assert.ok(res.markup.includes(`</${s}>`), `missing </${s}>`);
    }
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it("engages the ruthless question gate (max 3) in interactive mode", async () => {
    const res = await compileIntent("make auth better", { mode: "interactive" });
    assert.equal(res.status, "needs_answer");
    if (res.status !== "needs_answer") return;
    assert.ok(res.questions.length > 0);
    assert.ok(res.questions.length <= 3);
    for (const q of res.questions) {
      assert.ok(q.default, "every question has a default");
      assert.ok(q.rationale, "ask only if it materially changes output");
    }

    const done = await answerQuestions(
      "make auth better",
      [
        { questionId: "q1", value: "login" },
        { questionId: "q2", value: "behaviour" },
      ],
      { mode: "one-shot" },
    );
    assert.equal(done.status, "ready");
    if (done.status === "ready") {
      // Answers became constraints (never silently rewrite intent).
      assert.ok(done.packet.constraints.some((c) => c === "q1: login"));
    }
  });

  it("always emits a schema-valid packet (fail-closed, never a half packet)", async () => {
    const res = await compileIntent("add a login endpoint", { mode: "one-shot" });
    assert.equal(res.status, "ready");
    if (res.status !== "ready") return;
    assert.equal(IntentResult.safeParse(res.intent).success, true);
    assert.equal(TaskPacket.safeParse(res.packet).success, true);
  });

  it("one-shot and auto skip the gate; interactive does not", async () => {
    const auto = await compileIntent("make auth better", { mode: "auto" });
    assert.equal(auto.status, "ready");
    const oneShot = await compileIntent("make auth better", { mode: "one-shot" });
    assert.equal(oneShot.status, "ready");
  });
});