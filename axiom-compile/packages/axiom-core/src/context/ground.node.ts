import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GroundContext, type GroundContext as GroundContextType } from "./ground.js";

const execFileAsync = promisify(execFile);

export interface GroundContextOptions {
  required?: boolean;
  command?: string;
}

/**
 * Invoke Ground through its public CLI contract. Compile never reads
 * .contextlock internals directly, which keeps the two products versionable
 * independently and preserves Ground's secret-redaction boundary.
 */
export async function collectGroundContext(
  cwd: string,
  options: GroundContextOptions = {},
): Promise<GroundContextType | undefined> {
  const command = options.command ?? process.env.CONTEXTLOCK_CTX_BIN ?? "ctx";
  try {
    const { stdout } = await execFileAsync(command, ["context", "export", "--format", "json"], {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
    const parsed: unknown = JSON.parse(stdout);
    const validated = GroundContext.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`GroundContext v1 validation failed: ${validated.error.message}`);
    }
    return validated.data;
  } catch (error) {
    if (options.required) {
      throw new Error(`Ground context export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }
}
