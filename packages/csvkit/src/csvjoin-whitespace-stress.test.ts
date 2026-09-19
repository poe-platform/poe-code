import { test, expect } from "vitest";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";

// csvkit 2.2.0 CSVJoin._parse_join_column_names uses str.strip, not JS trim.
for (const [name, header, selector] of [
  ["Python-only whitespace", "k", "\u001ck\u001f"],
  ["preserved byte-order-mark character", "k\ufeff", "k\ufeff"],
  ["mixed Python-only whitespace and preserved BOM", "k\ufeff", "\u001dk\ufeff\u001e"],
] as const) {
  for (const sdk of [false, true]) test(`csvjoin ${sdk ? "SDK" : "argv"} ${name}`, async () => {
    const files: Readonly<Record<string, string>> = {
      "/left.csv": `${header},a\nx,A\n`, "/right.csv": `${header},b\nx,B\n`,
    };
    let stdout = ""; let stderr = "";
    const cleanups: (() => Promise<void>)[] = [];
    const context: CsvkitContext = {
      argv: new OwnedArguments(["-I", "-y", "0", "-c", selector, "left.csv", "right.csv"].map(value => new TextEncoder().encode(value)), defaultLimits),
      cwd: "/", fs: {
        readFile: async path => { expect(path in files).toBe(true); return new TextEncoder().encode(files[path]); },
        writeFile: async () => { throw new Error("unexpected write"); },
      },
      stdin: (async function* () {})(), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [],
      locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected inference"); } },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
      registerCleanup: cleanup => { cleanups.push(cleanup); },
    };
    try {
      const status = sdk ? await run({ command: "csvjoin", settings: {
        no_inference: true, sniff_limit: 0, columns: selector, input_paths: ["left.csv", "right.csv"],
      } }, context) : await execute("csvjoin", context);
      expect({ stdout, stderr, status }).toEqual({ stdout: `${header},a,b\nx,A,B\n`, stderr: "", status: 0 });
    } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
  });
}
