import { basename } from "node:path";
import { parse } from "yaml";

export type Test262Variant = {
  mode: "sloppy" | "strict" | "module" | "raw";
  source: string;
  harness: string[];
};

export type PreparedTest262 = { kind: "fixture" } | {
  kind: "test";
  flags: string[];
  features: string[];
  locales: string[];
  negative?: { phase: "parse" | "resolution" | "runtime"; type: string };
  variants: Test262Variant[];
};

const knownFlags = new Set([
  "onlyStrict", "noStrict", "module", "raw", "async", "generated",
  "CanBlockIsFalse", "CanBlockIsTrue", "non-deterministic"
]);

export function prepareTest262(filename: string, source: string): PreparedTest262 {
  if (basename(filename).includes("_FIXTURE")) return { kind: "fixture" };
  const start = source.indexOf("/*---");
  let metadata: Record<string, unknown> = {};
  if (start !== -1) {
    const end = source.indexOf("---*/", start + 5);
    if (end === -1) throw new Error("Unterminated Test262 metadata");
    const yaml = source.slice(start + 5, end).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const parsed: unknown = parse(yaml, { uniqueKeys: true });
    if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed)))
      throw new Error("Test262 metadata must be a mapping");
    metadata = (parsed ?? {}) as Record<string, unknown>;
  }
  const strings = (name: string): string[] => {
    const value = metadata[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every(item => typeof item === "string"))
      throw new Error(`Test262 ${name} must be a string list`);
    return value;
  };
  const flags = strings("flags");
  for (const flag of flags) if (!knownFlags.has(flag)) throw new Error(`Unknown Test262 flag: ${flag}`);
  if (flags.includes("onlyStrict") && flags.includes("noStrict"))
    throw new Error("Contradictory Test262 strictness flags");
  const includes = strings("includes");
  let negative: Extract<PreparedTest262, { kind: "test" }>["negative"];
  if (metadata.negative !== undefined) {
    const value = metadata.negative;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("Test262 negative must be a mapping");
    const { phase, type } = value as Record<string, unknown>;
    if ((phase !== "parse" && phase !== "resolution" && phase !== "runtime") ||
        typeof type !== "string" || type.length === 0)
      throw new Error("Invalid Test262 negative phase or error type");
    negative = { phase, type };
  }
  const modes: Test262Variant["mode"][] = flags.includes("raw") ? ["raw"]
    : flags.includes("module") ? ["module"]
    : flags.includes("onlyStrict") ? ["strict"]
    : flags.includes("noStrict") ? ["sloppy"] : ["sloppy", "strict"];
  return {
    kind: "test", flags, features: strings("features"), locales: strings("locale"),
    ...(negative === undefined ? {} : { negative }),
    variants: modes.map(mode => ({
      mode, source: mode === "strict" ? '"use strict";\n' + source : source,
      harness: mode === "raw" ? [] : ["assert.js", "sta.js",
        ...(flags.includes("async") ? ["doneprintHandle.js"] : []), ...includes]
    }))
  };
}
