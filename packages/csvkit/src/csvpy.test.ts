import { test, expect } from "vitest";
import { execute, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";


function fixture(input: string, argv: readonly string[], overrides: Partial<CsvkitContext> = {}) {
  let stdout = ""; let stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const encoder = new TextEncoder();
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(arg => encoder.encode(arg)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { throw new Error("unexpected file read"); }, writeFile: async () => { throw new Error("unexpected file write"); } },
    stdin: (async function* () { yield encoder.encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  return { context, result: () => ({ stdout, stderr }), cleanups };
}

test("filename access precedes interpreter capability checks", async () => {
  const f = fixture("", ["missing.csv"], { probeInputOpen: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } });
  expect(await execute("csvpy", f.context)).toBe(1);
  expect(f.result().stderr).toBe("FileNotFoundError: [Errno 2] No such file or directory: 'missing.csv'\n");
});
