import { IntentResult, type IntentQuestion, type TaskPacket } from "./model/schema.js";
import type { IntentResult as IntentResultType } from "./model/schema.js";
import type { ModelProvider } from "./model/provider.js";
import { buildIntentPrompt } from "./model/provider.js";
import { mockProvider } from "./model/mock.js";
import { browserContext, type RepoContext } from "./context/repo.js";
import { retrieveFor } from "./memory/layers.js";
import { computeRisk } from "./compiler/ambiguity.js";
import { buildSpec } from "./compiler/spec.js";
import { buildPacket, renderMarkup } from "./compiler/packet.js";
import { defaultConfig, type AppConfig, type Singlemode } from "./config.js";
import { telemetry } from "./telemetry/logger.js";
import { buildTaskPacketEnvelope, type AxiomTaskPacketEnvelope } from "./integration/envelope.js";

/**
 * routes.ts — the question gate / pipeline wiring (architecture §6).
 * Deterministic split: context+memory are code; the model only does the fuzzy
 * intent extraction; everything eventually validates against the Zod seam.
 */

export interface CompileOptions {
  mode?: Singlemode;
  /** Host-injected deterministic repo context (Node host: context/repo.node.ts). */
  context?: RepoContext;
  cwd?: string;
  provider?: ModelProvider;
  config?: AppConfig;
}

export type CompileResult =
  | {
      status: "needs_answer";
      intent: IntentResult;
      questions: IntentQuestion[];
    }
  | {
      status: "ready";
      intent: IntentResult;
      packet: TaskPacket;
      markup: string;
      envelope: AxiomTaskPacketEnvelope;
    };

export interface QuestionAnswer {
  questionId: string;
  value: string;
}

async function runPipeline(
  rawRequest: string,
  answers: QuestionAnswer[],
  opts: CompileOptions,
): Promise<CompileResult> {
  const config = opts.config ?? defaultConfig;
  const mode = opts.mode ?? config.defaultMode;
  const provider = opts.provider ?? mockProvider;
  const cwd = opts.cwd ?? "";
  const started = Date.now();

  // 1. Deterministic context + memory (code, not model). Host injects RepoContext;
  //    the webview path (no node:fs) falls back to a browser-safe default.
  const repo = opts.context ?? browserContext();
  const memory = await retrieveFor("", cwd);
  const groundMemory = (repo.ground?.memory.entries || [])
    .filter((entry) => !entry.stale && !entry.superseded_by)
    .map((entry) => entry.content);
  const memoryConstraints = [...memory.constraints, ...groundMemory];

  // 2. Model intent extraction, validated against the Zod seam (fail-closed).
  const prompt = buildIntentPrompt(
    rawRequest,
    { language: repo.language, framework: repo.framework, repoState: repo.repoState },
    memoryConstraints,
  );
  const validated = await extractIntent(provider, prompt);
  // Answers from the question gate become constraints (never silently rewrite intent).
  validated.constraints = [
    ...validated.constraints,
    ...memoryConstraints,
    ...answers.map((a) => `${a.questionId}: ${a.value}`),
  ];

  // 3. Risk heuristics reconcile with the model's own score.
  validated.risk = computeRisk(validated, rawRequest);
  const risk = validated.risk;

  // 4. Ruthless question gate.
  const questions = mode === "interactive" && risk.needs_questions ? validated.questions.slice(0, config.maxQuestions) : [];
  if (questions.length > 0) {
    telemetry.record({
      mode,
      provider: provider.id,
      risk: risk.score,
      questions_asked: questions.length,
      default_used: false,
      latency_ms: Date.now() - started,
      ts: new Date().toISOString(),
      intent_id: validated.intent_id,
    });
    return { status: "needs_answer", intent: validated, questions };
  }

  // 5. Compile spec + packet + §7 markup.
  const spec = buildSpec(validated);
  const packet = buildPacket(validated, spec, repo, config.tokenBudgets);
  const markup = renderMarkup(packet);
  const envelope = await buildTaskPacketEnvelope(packet, repo.ground, mode);

  telemetry.record({
    mode,
    provider: provider.id,
    risk: risk.score,
    questions_asked: 0,
    default_used: true,
    latency_ms: Date.now() - started,
    ts: new Date().toISOString(),
    intent_id: validated.intent_id,
    packet_id: packet.packet_id,
  });

  return { status: "ready", intent: validated, packet, markup, envelope };
}

async function extractIntent(
  provider: ModelProvider,
  prompt: { system: string; user: string },
): Promise<IntentResultType> {
  return provider.complete(prompt, IntentResult);
}

/** Primary entrypoint: compile a raw request into a ready packet or gated questions. */
export async function compileIntent(
  rawRequest: string,
  opts: CompileOptions = {},
): Promise<CompileResult> {
  return runPipeline(rawRequest, [], opts);
}

/** Continue an interactive intent after the user answers the gate questions. */
export async function answerQuestions(
  rawRequest: string,
  answers: QuestionAnswer[],
  opts: CompileOptions = {},
): Promise<CompileResult> {
  return runPipeline(rawRequest, answers, opts);
}

export type { TaskPacket, RepoContext };