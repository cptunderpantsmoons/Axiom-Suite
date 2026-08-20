import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectContext } from "../src/context/repo.node.js";
import { compileIntent } from "../src/index.js";
import { AxiomTaskPacketEnvelope, canonicalJson, sha256Digest } from "../src/integration/envelope.js";

const groundFixture = {
  schema_version: "ground.context.v1",
  project: { project_id: "ctxproj_fixture", project_name: "fixture" },
  snapshot: {
    snapshot_hash: "ctxsnap_fixture",
    snapshot_schema_version: 1,
    hash_spec_version: 1,
    created_at: "2026-08-18T00:00:00.000Z",
    git: { branch: "main", commit: "abc123", dirty: false },
  },
  prompt_pack: {
    prompt_id: "ctxprompt_fixture",
    prompt_type: "onboarding",
    snapshot_hash: "ctxsnap_fixture",
    available: true,
  },
  drift: {
    audit_id: "audit_fixture",
    score: 4,
    status: "pass",
    snapshot_hash: "ctxsnap_fixture",
  },
  repo_context: {
    languages: ["typescript"],
    frameworks: ["react"],
    test_commands: ["npm test"],
    build_commands: ["npm run build"],
    run_commands: [],
    entrypoints: ["src/main.ts"],
    important_files: [{ path: "src/main.ts", reason: "entrypoint" }],
  },
  memory: {
    entries: [{
      id: "mem_fixture",
      type: "procedural",
      content: "Never change auth without tests.",
      anchor_hash: "ctxsnap_fixture",
      related_files: ["src/auth.ts"],
      stale: false,
      stale_reason: null,
      superseded_by: null,
      redacted: false,
      schema_version: 1,
    }],
  },
  code_index: {
    available: true,
    snapshot_hash: "ctxsnap_fixture",
    index_determinism_hash: "index_fixture",
  },
  security: {
    secret_scan_passed: true,
    redaction_count: 0,
    sensitive_paths_skipped: 0,
  },
} as const;

function fakeGroundCommand(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "axiom-ground-command-"));
  const script = path.join(dir, "ctx-fixture");
  writeFileSync(script, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(groundFixture))});\n`);
  chmodSync(script, 0o755);
  return script;
}

describe("Ground and Compile integration", () => {
  it("loads curated GroundContext and carries references into the packet envelope", async () => {
    const context = await collectContext(process.cwd(), {
      groundRequired: true,
      groundCommand: fakeGroundCommand(),
    });
    assert.ok(context.ground);
    assert.equal(context.ground.snapshot.snapshot_hash, "ctxsnap_fixture");
    assert.ok(context.relevantPaths.includes("src/main.ts"));

    const result = await compileIntent("make auth better", {
      mode: "one-shot",
      cwd: process.cwd(),
      context,
    });
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;

    assert.equal(result.packet.ground_context?.project_id, "ctxproj_fixture");
    assert.equal(result.packet.ground_context?.snapshot_hash, "ctxsnap_fixture");
    assert.equal(result.packet.constraints.includes("Never change auth without tests."), true);
    assert.equal(AxiomTaskPacketEnvelope.safeParse(result.envelope).success, true);
    assert.equal(result.envelope.ground?.snapshot_hash, "ctxsnap_fixture");
    assert.equal(result.envelope.taskpacket_id, result.packet.packet_id);
    assert.equal(result.envelope.packet_hash, await sha256Digest(result.packet));
  });

  it("uses stable canonical JSON key ordering for packet hashes", async () => {
    assert.equal(canonicalJson({ b: 1, a: { d: true, c: 2 } }), '{"a":{"c":2,"d":true},"b":1}');
    const first = await sha256Digest({ b: 1, a: 2 });
    const second = await sha256Digest({ a: 2, b: 1 });
    assert.equal(first, second);
  });
});
