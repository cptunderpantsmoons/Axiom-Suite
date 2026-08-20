import { z } from "zod";

/**
 * Strip JSON fences/whitespace wrappers and validate as a Zod schema.
 * On failure return the raw text so a repair retry can be attempted (§6).
 */

export type ParseOutcome<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; raw: string; error: z.ZodError };

export function stripFences(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    t = fence[1]!.trim();
  }
  return t;
}

export function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
): ParseOutcome<T> {
  const candidate = stripFences(raw);
  const result = schema.safeParse(JSON.parse(candidate));
  if (result.success) {
    return { ok: true, data: result.data, raw: candidate };
  }
  // JSON.parse may itself throw -> capture as a parse error against an unknown shape.
  return { ok: false, raw: candidate, error: result.error };
}

/** Robust variant that never throws on unparseable JSON (returns failure outcome). */
export function safeParseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
): ParseOutcome<T> {
  const candidate = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      ok: false,
      raw: candidate,
      error: new z.ZodError([
        { code: "custom", path: [], message: "JSON.parse failed" },
      ]),
    };
  }
  const result = schema.safeParse(parsed);
  return result.success
    ? { ok: true, data: result.data, raw: candidate }
    : { ok: false, raw: candidate, error: result.error };
}