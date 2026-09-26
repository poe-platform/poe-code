import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, defaultLimits } from "./engine.js";
import { Runtime } from "./runtime.js";
import { csvcut } from "./commands/csvcut.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";

function fixture(input: string, argv: readonly string[] = [], overrides: Partial<CsvkitContext> = {}) {
  const cleanups: (() => Promise<void>)[] = [];
  let stdout = ""; let stderr = "";
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C.UTF-8", timezone: "UTC", formatNumber: () => { throw new Error("unexpected number formatting"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  return { context, cleanups, result: () => ({ stdout, stderr }) };
}

test("overlapping registered cleanup and reader finalization close an admitted source once", async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let nextStarted!: () => void;
  const started = new Promise<void>(resolve => { nextStarted = resolve; });
  let returns = 0;
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => { nextStarted(); await barrier; return { done: true, value: undefined }; },
      return: async () => { returns++; release(); return { done: true, value: undefined }; }
    })
  };
  const f = fixture("", [], { stdin: source });
  const runtime = new Runtime(f.context, csvcut, {});
  const reading = runtime.text(null);
  await started;
  const closing = f.cleanups[0]!();
  await assert.rejects(reading, /invocation already closed/);
  await closing;
  await runtime.close();
  assert.equal(returns, 1);
});

test("host field budget remains an explicit blocker instead of a reference CSV diagnostic", async () => {
  const f = fixture("abcdef\nx\n", [], { limits: { ...defaultLimits, maxFieldCharacters: 3 } });
  assert.equal(await execute("csvcut", f.context), 78);
  assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: field character budget exceeded\n" });
});

test("exhausted general work budget returns refusal without attempting unbudgeted diagnostics", async () => {
  for (const maxWork of [0, 1, 2]) {
    const f = fixture("a,b\nx,y\n", [], { limits: { ...defaultLimits, maxWork } });
    assert.equal(await execute("csvcut", f.context), 78);
    assert.deepEqual(f.result(), { stdout: "", stderr: "" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("CSV parser copies producer-owned reused input fragments", async () => {
  const bytes = new Uint8Array(4);
  const source = (async function* () {
    bytes.set(new TextEncoder().encode("a,b\n")); yield bytes;
    bytes.set(new TextEncoder().encode("x,y\n")); yield bytes;
  })();
  const f = fixture("", [], { stdin: source });
  assert.equal(await execute("csvcut", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a,b\nx,y\n", stderr: "" });
});

test("multiline grep line numbers match the frozen reader physical-line profile", async () => {
  const f = fixture('a,b\n"x\ny\nz",z\nx,q\n', ["-c", "a", "-m", "x", "-l"]);
  assert.equal(await execute("csvgrep", f.context), 0);
  assert.deepEqual(f.result(), { stdout: 'line_numbers,a,b\n3,"x\ny\nz",z\n4,x,q\n', stderr: "" });
});

test("released csvkit EOF and closing-quote command regressions preserve exact output", async () => {
  const cases = [
    { command: "csvcut", argv: ["-p", "\\"], input: 'a,b\n"x"\\,y\n', stdout: "a,b\nx\\,y\n" },
    { command: "csvgrep", argv: ["-c", "a", "-m", "x", "-l"], input: 'a\n"x\n', stdout: 'line_numbers,a\n1,"x\n"\n' }
  ];
  for (const entry of cases) {
    const f = fixture(entry.input, entry.argv);
    assert.equal(await execute(entry.command, f.context), 0);
    assert.deepEqual(f.result(), { stdout: entry.stdout, stderr: "" });
  }
});

test("borrowed cancellation preserves a falsey reason and awaits registered source cleanup", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let closed = 0;
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => { started(); await blocked; return { done: true, value: undefined }; },
      return: async () => { closed++; release(); return { done: true, value: undefined }; }
    })
  };
  const f = fixture("", [], { signal: controller.signal, stdin: source });
  const execution = execute("csvcut", f.context);
  await admitted;
  controller.abort(false);
  const rejected = assert.rejects(execution, (reason: unknown) => reason === false);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
  await rejected;
  assert.equal(closed, 1);
});

test("output backpressure prevents later rows from overtaking an awaited sink", async () => {
  let writes = 0;
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const f = fixture("a,b\nx,y\nz,q\n", [], {
    stdout: { write: async () => { writes++; if (writes === 1) { admitted(); await blocked; } } }
  });
  const execution = execute("csvcut", f.context);
  await started;
  assert.equal(writes, 1);
  release();
  assert.equal(await execution, 0);
  assert.equal(writes, 3);
});

test("source failure identity survives a simultaneous cooperative return failure", async () => {
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => { throw false; },
      return: async () => { throw new Error("return failure"); }
    })
  };
  const f = fixture("", [], { stdin: source });
  const execution = execute("csvcut", f.context);
  await assert.rejects(execution, (reason: unknown) => reason === false);
});

test("SDK csvsort lowercases custom null markers as frozen Agate Text does", async () => {
  const f = fixture("a,b\nCUSTOM,1\ncustom,2\n Custom ,3\nZ,4\n", ["-I", "-y", "0", "-c", "a", "--null-value", "CUSTOM"]);
  assert.equal(await execute("csvsort", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a,b\nZ,4\n,1\n,2\n,3\n", stderr: "" });
});

test("SDK csvsort ignores Unicode in unrelated columns when case-folding ASCII sort keys", async () => {
  const f = fixture("a,b\nz,😀\nA,α\n", ["-I", "-y", "0", "-c", "a", "-i"]);
  assert.equal(await execute("csvsort", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a,b\nA,α\nz,😀\n", stderr: "" });
});

test("SDK raw Agate null normalization follows Python whitespace rather than JavaScript trim", async () => {
  const f = fixture("a,b\n\u0085NA\u0085,nel\n\ufeffNA\ufeff,bom\nZ,plain\n", ["-I", "-y", "0", "-c", "a"]);
  assert.equal(await execute("csvsort", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a,b\nZ,plain\n\ufeffNA\ufeff,bom\n,nel\n", stderr: "" });
});

test("SDK csvpy preserves falsey interact failure after awaiting failing owned cleanup", async () => {
  let closed = 0;
  const f = fixture("", ["data.csv"], { interpreter: {
    modes: ["reader"], load: async () => ({ profile: "test-only", interact: async () => { throw false; }, close: async () => { closed++; throw new Error("cleanup failure"); } })
  } });
  await assert.rejects(execute("csvpy", f.context), reason => reason === false);
  assert.equal(closed, 1);
});

test("SDK in2csv JSON preserves CPython nonfinite number spelling without inference", async () => {
  const f = fixture('[{"a":NaN},{"a":Infinity},{"a":-Infinity}]', ["-I", "-f", "json"]);
  assert.equal(await execute("in2csv", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a\nnan\ninf\n-inf\n", stderr: "" });
});

test("SDK in2csv rejects integers beyond the frozen CPython decimal-string profile", async () => {
  const f = fixture('[{"a":' + "1".repeat(4301) + "}]", ["-I", "-f", "json"]);
  assert.equal(await execute("in2csv", f.context), 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: "ValueError: Exceeds the limit (4300 digits) for integer string conversion: value has 4301 digits; use sys.set_int_max_str_digits() to increase the limit\n" });
});

test("unpaired JSON surrogates remain explicit output-profile blockers while emoji pairs survive", async () => {
  for (const escaped of ["\\ud800", "\\udc80"]) {
    const f = fixture('[{"a":"' + escaped + '"}]', ["-I", "-f", "json"]);
    assert.equal(await execute("in2csv", f.context), 78);
    assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: JSON unpaired surrogate output encoding profile\n" });
  }
  const f = fixture('[{"a":"\\ud83d\\ude00"}]', ["-I", "-f", "json"]);
  assert.equal(await execute("in2csv", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a\n😀\n", stderr: "" });
});

test("SDK csvsql preserves SQLAlchemy uniqueness-column deduplication", async () => {
  const f = fixture("id,val\nx,y\n", ["-I", "-y0", "--unique-constraint", "id,id"]);
  assert.equal(await execute("csvsql", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "CREATE TABLE stdin (\n\tid VARCHAR NOT NULL, \n\tval VARCHAR NOT NULL, \n\tUNIQUE (id)\n);\n", stderr: "" });
});

test("SDK csvsql preserves SQLAlchemy parameter-style percent escaping in identifiers", async () => {
  const f = fixture("a%b\nx\n", ["-I", "-y0", "-i", "mysql", "--tables", "t%q"]);
  assert.equal(await execute("csvsql", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "CREATE TABLE `t%%q` (\n\t`a%%b` VARCHAR(1) NOT NULL\n);\n", stderr: "" });
});

test("SDK csvsql preserves missing MySQL length compilation failure without constraints", async () => {
  const f = fixture("a,b\n😀,\n", ["-I", "-y0", "-i", "mysql", "--no-constraints"]);
  assert.equal(await execute("csvsql", f.context), 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: "CompileError: (in table 'stdin', column 'a'): VARCHAR requires a length on dialect mysql\n" });
});

test("SDK in2csv NDJSON error offsets retain complete physical line endings", async () => {
  for (const [input, detail] of [
    ["\n", "Expecting value: line 2 column 1 (char 1)"],
    ["\r\n", "Expecting value: line 2 column 1 (char 2)"],
    ["\r", "Expecting value: line 1 column 2 (char 1)"],
    ["{\n", "Expecting property name enclosed in double quotes: line 2 column 1 (char 2)"],
    ["{\r\n", "Expecting property name enclosed in double quotes: line 2 column 1 (char 3)"],
    ["{\r", "Expecting property name enclosed in double quotes: line 1 column 3 (char 2)"]
  ]) {
    const f = fixture(input!, ["-I", "-f", "ndjson"]);
    assert.equal(await execute("in2csv", f.context), 1);
    assert.deepEqual(f.result(), { stdout: "", stderr: `JSONDecodeError: ${detail}\n` });
  }
});
