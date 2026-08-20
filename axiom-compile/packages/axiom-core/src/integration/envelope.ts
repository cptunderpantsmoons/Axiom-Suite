import { z } from "zod";
import type { GroundContext } from "../context/ground.js";
import { TaskPacket, type TaskPacket as TaskPacketType } from "../model/schema.js";

export const GroundRefs = z.object({
  project_id: z.string(),
  snapshot_hash: z.string(),
  prompt_pack_id: z.string().nullable(),
  drift_score: z.number().nullable(),
  code_index_hash: z.string().nullable(),
});

export const AxiomTaskPacketEnvelope = z.object({
  schema_version: z.literal("axiom.taskpacket.v1"),
  taskpacket_id: z.string().uuid(),
  packet_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  compile: z.object({
    contract_version: z.literal(1),
    intent_id: z.string().uuid(),
    mode: z.enum(["auto", "interactive", "one-shot"]),
    risk_score: z.number().min(0).max(1),
    dangerous: z.enum(["none", "destructive", "require_plan"]),
  }),
  ground: GroundRefs.nullable(),
  task_packet: TaskPacket,
});

export type AxiomTaskPacketEnvelope = z.infer<typeof AxiomTaskPacketEnvelope>;

/** Stable JSON encoding used for the packet digest across integration tests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export async function sha256Digest(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is required to hash Axiom packets");
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function buildTaskPacketEnvelope(
  packet: TaskPacketType,
  ground: GroundContext | undefined,
  mode: "auto" | "interactive" | "one-shot",
): Promise<AxiomTaskPacketEnvelope> {
  const packetHash = await sha256Digest(packet);
  const envelope = {
    schema_version: "axiom.taskpacket.v1" as const,
    taskpacket_id: packet.packet_id,
    packet_hash: packetHash,
    compile: {
      contract_version: packet.contract_v,
      intent_id: packet.intent_id,
      mode,
      risk_score: packet.risk_score ?? 0,
      dangerous: packet.risk_dangerous ?? "none",
    },
    ground: ground ? {
      project_id: ground.project.project_id,
      snapshot_hash: ground.snapshot.snapshot_hash,
      prompt_pack_id: ground.prompt_pack.prompt_id,
      drift_score: ground.drift.score,
      code_index_hash: ground.code_index.index_determinism_hash,
    } : null,
    task_packet: packet,
  };
  return AxiomTaskPacketEnvelope.parse(envelope);
}
