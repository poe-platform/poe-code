import { test, expect } from "vitest";
import { Runtime } from "../runtime.js";
import { commands } from "../commands.js";
import { defaultLimits, execute } from "../engine.js";
import { OwnedArguments } from "../argv.js";
import { utf8Codec } from "../codecs/utf8.js";
import type { CsvkitContext } from "../contracts.js";
import { LazyInput } from "./index.js";

function setup(input: string, argv: string[] = []) {
  const reads: string[] = [], cleanups: (() => Promise<void>)[] = [];
  let stdout = "", stderr = "";
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits),
    cwd: "/work", fs: {
      async readFile(path) { reads.push(path); return new TextEncoder().encode(input); },
      async writeFile() { throw new Error("unexpected write"); }
    },
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(input); } },
    stdinIsDefault: true, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [], clock: { now: () => 0 },
    locale: { profile: "C", timezone: "UTC", formatNumber: () => "" }, limits: defaultLimits,
    signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  return { context, reads, cleanups, result: () => ({ stdout, stderr }) };
}

test("named CSV iteration strips NUL while stdin iteration and bulk read preserve it", async () => {
  const f = setup("a\0,b\r\nx\0,y\r");
  const runtime = new Runtime(f.context, commands.find(command => command.name === "csvcut")!, {});
  expect(await runtime.text("data.csv", 0)).toBe("a\0,b\nx\0,y\n");
  const named = [];
  for await (const record of runtime.records("data.csv")) named.push(record.cells);
  expect(named).toEqual([["a", "b"], ["x", "y"]]);
  const stdin = [];
  for await (const record of runtime.records("-")) stdin.push(record.cells);
  expect(stdin).toEqual([["a\0", "b"], ["x\0", "y"]]);
  await runtime.close();
});

test.each([
  { chunks: ["x\0\n"], lines: ["x\n"] },
  { chunks: ["x\0", "\n"], lines: ["x\n"] },
  { chunks: ["x\0\n", "y\0\n"], lines: ["x\n", "y\n"] },
  { chunks: ["x\0\ny\0\n"], lines: ["x\n", "y\n"] },
  { chunks: ["x\0"], lines: ["x"] }
])("named line iteration removes NUL across decoded buffer boundaries: $chunks", async ({ chunks, lines }) => {
  const input = new LazyInput("data.csv", () => ({ async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield new TextEncoder().encode(chunk);
  } }), utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {});
  try {
    const actual = [];
    for await (const line of input.lines()) actual.push(line);
    expect(actual).toEqual(lines);
  } finally { await input.close(); }
});

test("stdin has one cursor even when injected source is reusable", async () => {
  const f = setup("a\nx\n");
  const runtime = new Runtime(f.context, commands[0]!, {});
  const input = runtime.input("-");
  expect(await input.read()).toBe("a\nx\n");
  expect(await input.read()).toBe("");
  expect(await runtime.input(null, true).read()).toBe("");
  await runtime.close();
});

test("help leaves LazyFile unopened and file paths stay in the injected namespace", async () => {
  const f = setup("a\nx\n", ["missing.csv", "--help"]);
  expect(await execute("csvcut", f.context)).toBe(0);
  expect(f.reads).toEqual([]);
  const runtime = new Runtime(f.context, commands[0]!, {});
  await runtime.text("../data.csv", 0);
  await runtime.text("/mounted/data.csv", 0);
  expect(f.reads).toEqual(["/data.csv", "/mounted/data.csv"]);
  await runtime.close();
});

test("csvformat terminal waiting message precedes writer validation", async () => {
  const f = setup("", ["-Q", ","]);
  const context = { ...f.context, terminal: { ...f.context.terminal, stdinIsTTY: true } };
  expect(await execute("csvformat", context)).toBe(1);
  expect(f.result()).toEqual({ stdout: "", stderr:
    "No input file or piped data provided. Waiting for standard input:\nValueError: bad delimiter or quotechar value\n" });
});

test("optional zstandard absence leaves named .zst input as ordinary text", async () => {
  const f = setup("a,b\nx,y\n", ["data.zst"]);
  expect(await execute("csvcut", f.context)).toBe(0);
  expect(f.result()).toEqual({ stdout: "a,b\nx,y\n", stderr: "" });
});

test("common compression dispatch accepts only exact reference extensions", async () => {
  let decoded = 0;
  const f = setup("a\nx\n", ["data.GZ"]);
  const context = { ...f.context, compression: [{ extensions: [".GZ", ".csv"],
    async *decode() { decoded++; yield new TextEncoder().encode("wrong\n"); } }] };
  expect(await execute("csvcut", context)).toBe(0);
  expect(decoded).toBe(0);
  expect(f.result()).toEqual({ stdout: "a\nx\n", stderr: "" });
});

test("binary source bytes do not pass through common text compression", async () => {
  const f = setup("binary");
  const runtime = new Runtime(f.context, commands[0]!, {});
  const bytes = [];
  for await (const chunk of runtime.bytes("workbook.xlsx.gz")) bytes.push(...chunk);
  expect(new TextDecoder().decode(Uint8Array.from(bytes))).toBe("binary");
  await runtime.close();
});

test("common opener uses Python splitext semantics for leading-dot basenames", async () => {
  for (const path of [".gz", "..bz2", "...xz", ".zst", "/dir.gz/plain"]) {
    let decoded = 0;
    const f = setup("a\nx\n", [path]);
    const context = { ...f.context, compression: [{ extensions: [".gz", ".bz2", ".xz", ".zst"],
      async *decode() { decoded++; yield new TextEncoder().encode("wrong\n"); } }] };
    expect(await execute("csvcut", context)).toBe(0);
    expect(decoded).toBe(0);
    expect(f.result()).toEqual({ stdout: "a\nx\n", stderr: "" });
  }
});

for (const input of ["a\0,b\n", "a\0,b"]) test(`last buffered physical line strips NUL only for named input: ${JSON.stringify(input)}`, async () => {
  for (const [path, expected] of [["data.csv", "a,b\n"], ["-", "a\0,b\n"]]) {
    const fixture = setup(input, [path!]);
    try {
      expect(await execute("csvcut", fixture.context)).toBe(0);
      expect(fixture.result()).toEqual({ stdout: expected, stderr: "" });
    } finally { await Promise.all(fixture.cleanups.map(cleanup => cleanup())); }
  }
});
