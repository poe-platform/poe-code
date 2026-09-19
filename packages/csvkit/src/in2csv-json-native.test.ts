import { test, vi } from "vitest";
import assert from "node:assert/strict";
import reference from "../../../docs/csvkit/in2csv-json-native-reference.json" with { type: "json" };
import originalJson from "../../../docs/csvkit/json-input-operation-reference.json" with { type: "json" };
import userEdgeReference from "../../../docs/csvkit/in2csv-json-user-edge-reference.json" with { type: "json" };
import { execute, run, defaultLimits } from "./engine.js";
import { utf8Codec } from "./codecs/utf8.js";
import { OwnedArguments } from "./argv.js";
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

for (const [index, item] of reference.cases.entries()) test(`JSON native input original regression ${index}`, async () => {
  const f = fixture(item.stdin, item.argv, { columnWarnings: { utilsPath: reference.warningPath } });
  try {
    assert.deepEqual({ status: await execute("in2csv", f.context), ...f.result() },
      { status: item.status, stdout: item.stdout, stderr: item.stderr });
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});

for (const [index, item] of userEdgeReference.cases.entries()) test(`JSON user edge original regression ${index}`, async () => {
  const f = fixture(item.stdin, item.argv);
  try {
    assert.deepEqual({ status: await execute("in2csv", f.context), ...f.result() },
      { status: item.status, stdout: item.stdout, stderr: item.stderr });
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});

test("SDK JSON input uses native numbers through the same engine", async () => {
  const f = fixture('[{"n":12345678901234567890123456789012345}]', []);
  try {
    assert.equal(await run({ command: "in2csv", settings: { filetype: "json" } }, f.context), 0);
    assert.deepEqual(f.result(), { stdout: "n\n12345678901234567890123456789012345\n", stderr: "" });
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});

test("JSON container nesting is admitted before parsing an over-budget child", async () => {
  for (const sdk of [false, true]) {
    const f = fixture('[{"a":{"broken":}}]', ["-f", "json"], { limits: { ...defaultLimits, maxNestingDepth: 1 } });
    assert.equal(sdk ? await run({ command: "in2csv", settings: { filetype: "json" } }, f.context) : await execute("in2csv", f.context), 78);
    assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: JSON nesting budget exceeded\n" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("JSON string codepoints are admitted before native decoding allocates the field", async () => {
  const nativeParse = JSON.parse;
  let excessiveFieldDecoded = false;
  const decoding = vi.spyOn(JSON, "parse").mockImplementation((source: string) => {
    if (source === '"😀😀"') excessiveFieldDecoded = true;
    return nativeParse(source);
  });
  const f = fixture('[{"a":"😀😀"}]', ["-f", "json"], { limits: { ...defaultLimits, maxFieldCharacters: 1 } });
  try {
    assert.equal(await execute("in2csv", f.context), 78);
    assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: JSON string field budget exceeded\n" });
    assert.equal(excessiveFieldDecoded, false);
  } finally {
    decoding.mockRestore();
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("JSON preflight counts escaped and literal surrogate pairs as one codepoint", async () => {
  for (const token of ['"😀"', '"\\ud83d\\ude00"', '"\\/"']) {
    const f = fixture(`[{"a":${token}}]`, ["-f", "json", "-I"], { limits: { ...defaultLimits, maxFieldCharacters: 1 } });
    assert.equal(await execute("in2csv", f.context), 0);
    assert.deepEqual(f.result(), { stdout: token === '"\\/"' ? "a\n/\n" : "a\n😀\n", stderr: "" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("JSON output awaits each write and cancellation preserves the original reason and closes input", async () => {
  const abort = new AbortController(); const reason = new Error("cancel JSON");
  let closed = 0; const output: string[] = []; let active = false;
  const f = fixture("", ["-f", "json"], {
    signal: abort.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      try { yield new TextEncoder().encode('[{"n":2},{"n":3}]'); }
      finally { closed++; }
    } },
    stdout: { write: async bytes => {
      assert.equal(active, false); active = true;
      await Promise.resolve(); output.push(new TextDecoder().decode(bytes)); active = false;
      if (output.length === 2) abort.abort(reason);
    } }
  });
  try {
    await assert.rejects(execute("in2csv", f.context), error => error === reason);
    assert.deepEqual(output, ["n\n", "2\n"]);
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
  assert.equal(closed, 1);
});

test("unnamed JSON scalar rows require injected warning provenance", async () => {
  const f = fixture("[2]", ["-f", "json"]);
  try {
    assert.equal(await execute("in2csv", f.context), 78);
    assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: Agate duplicate/unnamed column warning provenance\n" });
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});

test("native JSON numbers do not silently qualify an unmeasured inference locale", async () => {
  const f = fixture('[{"n":2}]', ["-f", "json", "-L", "fr_FR"]);
  try {
    assert.equal(await execute("in2csv", f.context), 78);
    assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: Agate Number locale fr_FR\n" });
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});

test("original zero-column JSON regression uses the injected Agate deployment identity", async () => {
  const item = originalJson.cases[5]!;
  const path = item.stderr.slice(0, item.stderr.indexOf(":93:"));
  const utilsPath = path.slice(0, -"table/from_object.py".length) + "utils.py";
  const f = fixture(item.stdin, item.argv, { columnWarnings: { utilsPath } });
  try {
    assert.deepEqual({ status: await execute("in2csv", f.context), ...f.result() },
      { status: item.status, stdout: item.stdout, stderr: item.stderr });
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});
