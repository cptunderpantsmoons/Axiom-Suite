import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RepoContext } from "./repo.js";
import { collectGroundContext } from "./ground.node.js";

const execFileAsync = promisify(execFile);

/**
 * NODE-ONLY deterministic context collector. This module imports `node:*` APIs
 * (fs, child_process) and therefore MUST NOT be imported by the browser/webview
 * bundle. Host code (CLI, preview server, Tauri Rust IPC) calls this and injects
 * the resulting RepoContext into the browser-safe `compileIntent`.
 *
 * PLAN §2 #2: runtime facts (repo, git state, manifest) are collected by CODE,
 * not invented by the model. Graceful when repo/manifest are absent.
 */

async function tryGit(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    const root = stdout.trim();
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: root,
    });
    const lines = status.split("\n").filter(Boolean);
    return lines.length === 0 ? "clean" : `dirty (${lines.length} changed file(s))`;
  } catch {
    return "not-a-git-repo";
  }
}

async function readManifest(cwd: string): Promise<{
  language?: string;
  framework?: string;
  testRunner?: string;
}> {
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    return {
      language: "TypeScript",
      framework: pkg.dependencies?.react
        ? "React"
        : Object.keys(pkg.dependencies ?? {}).join(",") || "unknown",
      testRunner: Object.keys(scripts).find((s) => /test/.test(s)),
    };
  } catch {
    return {};
  }
}export async function collectContext(
  cwd: string = process.cwd(),
  options: { groundRequired?: boolean; groundCommand?: string } = {},
): Promise<RepoContext> {
  const [manifest, repoState, ground] = await Promise.all([
    readManifest(cwd),
    tryGit(cwd),
    collectGroundContext(cwd, {
      required: options.groundRequired,
      command: options.groundCommand,
    }),
  ]);
  return {
    ...manifest,
    relevantPaths: ground?.repo_context.important_files
      .map((file) => typeof file.path === "string" ? file.path : "")
      .filter(Boolean) ?? [],
    repoState,
    isPrivateRepo: repoState !== "not-a-git-repo",
    ground,
  };
}
