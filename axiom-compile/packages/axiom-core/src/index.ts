/**
  * @axiom/core — public API (headless, UI-agnostic).
 * Everything the Tauri webview, a future CLI, and 3rd-party hooks need to
 * compile messy requests into validated one-shot task packets.
 */
export {
  compileIntent,
  answerQuestions,
  type CompileOptions,
  type CompileResult,
  type QuestionAnswer,
} from "./routes.js";
export { browserContext, type RepoContext } from "./context/repo.js";
export { GroundContext, type GroundContext as GroundContextType } from "./context/ground.js";
export {
  AxiomTaskPacketEnvelope,
  buildTaskPacketEnvelope,
  canonicalJson,
  sha256Digest,
  type AxiomTaskPacketEnvelope as AxiomTaskPacketEnvelopeType,
} from "./integration/envelope.js";
export { renderMarkup } from "./compiler/packet.js";
export {
  IntentResult,
  MemoryRule,
  TaskPacket,
  TaskType,
  IntentQuestion,
  type IntentResult as IntentResultType,
  type MemoryRule as MemoryRuleType,
  type TaskPacket as TaskPacketType,
} from "./model/schema.js";
export { mockProvider } from "./model/mock.js";
export { defaultConfig, type AppConfig, type Singlemode } from "./config.js";
export {
  AxiomError,
  FailClosedError,
  RepairLimitExceeded,
  ConfigError,
} from "./shared/error.js";