import { test, expect } from "vitest";
import { execute, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { readCsvRecoverable } from "./csv.js";
import { CsvkitBlocked } from "./errors.js";


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

test.each([
  ["reader", ["-u", "2"], '"name","n"\n"Ada",broken\n"Grace",3\n', ["Grace", 3]],
  ["dict", ["-u", "4"], '"name","n"\n"Ada",broken,ignored\n"Grace",3\n', ["Grace", 3]],
  ["reader", ["-z", "5"], "name,n\nAdaLONG,2\nGrace,3\n", ["Grace", "3"]],
  ["dict", ["-z", "5"], 'name,n\n"Ada\nLONG",2\nGrace,3\n', ["Grace", "3"]]
] as const)("%s csvpy resumes after row errors (%j)", async (mode, options, input, cells) => {
  let closed = false;
  const f = fixture("", [...(mode === "dict" ? ["--dict"] : []), ...options, "data.csv"], {
    fs: { readFile: async () => new TextEncoder().encode(input), writeFile: async () => { throw Error("unexpected write"); } },
    interpreter: {
      modes: ["reader", "dict"],
      load: async () => { throw Error("expected converted reader"); },
      loadConverted: async converted => {
        const reader = await converted.reader();
        expect(reader.next().value?.cells).toEqual(["name", "n"]);
        expect(() => reader.next()).toThrow();
        expect(reader.next().value?.cells).toEqual(cells);
        expect(reader.next().done).toBe(true);
        return { profile: "test-only", interact: async () => 0, close: async () => { closed = true; } };
      }
    }
  });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(closed).toBe(true);
});

test("recoverable reader preserves multiline records, empty rows, Unicode and EOF", () => {
  const reader = readCsvRecoverable('"😀\nAda",2\n\n"Grace",3', { quoting: 2 }, () => {});
  expect(reader.next().value).toEqual({ cells: ["😀\nAda", 2], line: 2 });
  expect(reader.next().value).toEqual({ cells: [], line: 3 });
  expect(reader.next().value).toEqual({ cells: ["Grace", 3], line: 4 });
  expect(reader.next().done).toBe(true);
  expect(reader.next().done).toBe(true);
});

test("recoverable reader skips consecutive invalid physical lines and keeps absolute line numbers", () => {
  const reader = readCsvRecoverable('bad,ignored\r\nwrong\r\n"Grace",3\r\n', { quoting: 2 }, () => {});
  expect(() => reader.next()).toThrow("ValueError");
  expect(() => reader.next()).toThrow("ValueError");
  expect(reader.next().value).toEqual({ cells: ["Grace", 3], line: 3 });
  expect(reader.next().done).toBe(true);
});

test("recoverable reader does not resume after a host work budget failure", () => {
  const failure = new CsvkitBlocked("work budget exceeded");
  const reader = readCsvRecoverable("Ada\nGrace\n", {}, () => { throw failure; });
  expect(() => reader.next()).toThrow(failure);
  expect(reader.next().done).toBe(true);
});
