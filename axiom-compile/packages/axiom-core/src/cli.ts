/**
 * Headless Axiom CLI (M1). `npx tsx src/cli.ts --test` proves the M1 exit
 * gate with zero UI and zero network. Also supports `--auto "<request>"` to
 * print the rendered §7 one-shot packet for a request.
 */
import { compileIntent } from "./routes.js";
import { renderMarkup } from "./compiler/packet.js";
import { collectContext } from "./context/repo.node.js";

const REPORT_SECTIONS = [
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

async function runTest(): Promise<void> {
  const request = "make auth better";
  try {
    const res = await compileIntent(request, {
      mode: "one-shot",
      cwd: process.cwd(),
      context: await collectContext(process.cwd()),
    });
    if (res.status !== "ready") {
      console.error("FAIL: expected a ready packet, got a resolution gate.");
      process.exitCode = 1;
      return;
    }
    const missing = REPORT_SECTIONS.filter(
      (s) => !res.markup.includes(`<${s}>`),
    );
    if (missing.length) {
      console.error(`FAIL: packet missing §7 sections: ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS: "${request}" -> valid structured one-shot packet.`);
    console.log(`  packet_id: ${res.packet.packet_id}`);
    console.log(`  task_type: ${res.packet.task_contract.task_type}`);
    console.log(`  target_area: ${res.packet.task_contract.target_area}`);
    console.log(`  §7 sections rendered: ${REPORT_SECTIONS.length}/${REPORT_SECTIONS.length}`);
  } catch (e) {
    console.error("FAIL:", e);
    process.exitCode = 1;
  }
}

async function runAuto(request: string): Promise<void> {
  const res = await compileIntent(request, {
    mode: "one-shot",
    context: await collectContext(process.cwd()),
  });
  if (res.status !== "ready") {
    console.log("Resolution gate engaged:");
    console.table(
      res.questions.map((q) => ({
        id: q.id,
        question: q.question,
        default: q.default,
      })),
    );
    return;
  }
  console.log(renderMarkup(res.packet));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--test")) {
    await runTest();
    return;
  }
  const ai = args.indexOf("--auto");
  if (ai !== -1 && args[ai + 1]) {
    await runAuto(args[ai + 1]!);
    return;
  }
  console.log(
    "usage: axiom --test | --auto \"<request>\"\n  --test   prove M1 exit gate (make auth better -> valid one-shot)",
  );
}

void main();