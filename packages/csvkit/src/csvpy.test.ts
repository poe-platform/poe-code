import { test, expect } from "vitest";
import { createCsvpyInterpreter } from "./csvpy-interpreter.js";
import { PythonSession } from "@poe-code/safe-python";
import { execute, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import objectReference from "../../../docs/csvkit/csvpy-object-reference.json" with { type: "json" };


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

async function objectConsole(csv: string, lines: string[], argv: string[] = []) {
  const interpreter = createCsvpyInterpreter({
    createSession: options => new PythonSession({ ...options, limits: { maxSteps: 2000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }),
    terminal: { readLine: async () => lines.shift() ?? null }
  });
  const f = fixture("", [...argv, "data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode(csv), writeFile: async () => { throw Error("unexpected write"); } } });
  const status = await execute("csvpy", f.context);
  return { status, ...f.result() };
}

for (const id of ["line-numbers", "raw-reader-dialect", "imports-config-errors", "factory-kind", "dictionary-blank-lines"]) {
  test(`csvpy exact frozen CPython object transcript: ${id}`, async () => {
    const reference = objectReference.results.find(case_ => case_.id === id)!;
    expect(await objectConsole(reference.csv, reference.expressions.map(line => line + "\n"), reference.mode === "dict" ? ["--dict"] : [])).toEqual({
      status: reference.status, stdout: reference.stdout, stderr: reference.stderr
    });
  });
}

test("Agate Reader line_numbers mutation uses physical line_num and header", async () => {
  expect(await objectConsole('a,b\n"first\nsecond",2\nthird,3\n', [
    "reader.line_numbers=True\n", "next(reader)\n", "next(reader)\n", "reader.header=False\n", "next(reader)\n", "reader.line_num\n"
  ])).toEqual({ status: 0, stdout: ">>> >>> ['line_numbers', 'a', 'b']\n>>> ['2', 'first\\nsecond', '2']\n>>> >>> ['4', 'third', '3']\n>>> 4\n>>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n' });
});

test("Reader forwards its raw iterator and dialect with CPython read-only properties", async () => {
  expect(await objectConsole("a,b\n1,2\n", [
    "(reader.dialect.delimiter,reader.dialect.quotechar,reader.dialect.escapechar,reader.dialect.quoting,reader.dialect.doublequote,reader.dialect.skipinitialspace,reader.dialect.lineterminator,reader.dialect.strict)\n",
    "reader.line_num=99\n", "reader.dialect.delimiter=';'\n", "next(reader.reader)\n", "reader.line_num\n", "next(reader)\n"
  ])).toEqual({ status: 0, stdout: ">>> (',', '\"', None, 0, True, False, '\\r\\n', False)\n>>> >>> >>> ['a', 'b']\n>>> 1\n>>> ['1', '2']\n>>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\nTraceback (most recent call last):\n  File "<console>", line 1, in <module>\nAttributeError: property \'line_num\' of \'Reader\' object has no setter\nTraceback (most recent call last):\n  File "<console>", line 1, in <module>\nAttributeError: attribute \'delimiter\' of \'_csv.Dialect\' objects is not writable\n\nnow exiting InteractiveConsole...\n' });
});

test("Agate imports expose canonical reader module, configuration aliases and exception classes", async () => {
  expect(await objectConsole("a\n", [
    "import agate, agate.csv_py3, agate.exceptions\n",
    "agate.csv is agate.csv_py3\n", "agate.get_option('default_locale')\n",
    "agate.set_option('custom',42); agate.get_option('custom')\n",
    "from agate.exceptions import FieldSizeLimitError\n",
    "isinstance(FieldSizeLimitError(2,3),ValueError)\n",
    "str(FieldSizeLimitError(2,3))\n"
  ])).toEqual({ status: 0, stdout: ">>> >>> True\n>>> 'en_US_POSIX'\n>>> 42\n>>> >>> False\n>>> 'CSV contains a field longer than the maximum length of 2 characters on line 3. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.'\n>>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n' });
});

test("numeric CSV conversion failures raise guest ValueError through interpreter evaluation", async () => {
  expect(await objectConsole('"name"\ninvalid\n', [
    "next(reader)\n", "try:\n", " next(reader)\n", "except ValueError as error:\n", " print(type(error).__name__,str(error))\n", "\n"
  ], ["-u2"])).toEqual({ status: 0, stdout: ">>> ['name']\n>>> ... ... ... ... ValueError could not convert string to float: 'invalid'\n>>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n' });
});

test("CSV error and dialect identities use _csv while the stdlib module is named csv", async () => {
  expect(await objectConsole("a\n", [
    "import csv,agate\n", "(csv.__name__,csv.Error.__module__,type(reader.dialect).__module__)\n",
    "agate.csv.csv is csv\n", "agate.csv.POSSIBLE_DELIMITERS\n"
  ])).toEqual({ status: 0, stdout: ">>> >>> ('csv', '_csv', '_csv')\n>>> True\n>>> [',', '\\t', ';', ' ', ':', '|']\n>>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n' });
});

test("csvpy runs Python reader expressions with original banner, prompts and EOF", async () => {

  const lines = ["next(reader)\n", "list(reader)\n"];
  const interpreter = createCsvpyInterpreter({
    createSession: (options) => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }),
    terminal: { readLine: async () => lines.shift() ?? null }
  });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a,b\n1,2\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(f.result().stdout).toBe(">>> ['a', 'b']\n>>> [['1', '2']]\n>>> ");
  expect(f.result().stderr).toBe('Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n');
});

test("plain csvpy defers field limit failures until reader iteration", async () => {

  const lines = ["next(reader)\n", "next(reader)\n"];
  const interpreter = createCsvpyInterpreter({
    createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }),
    terminal: { readLine: async () => lines.shift() ?? null }
  });
  const f = fixture("", ["-z2", "data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\nlong\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(f.result().stdout).toBe(">>> ['a']\n>>> >>> ");
  expect(f.result().stderr).toContain("FieldSizeLimitError: CSV contains a field longer than the maximum length of 2 characters on line 2. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.\n");
});

test("filename access precedes interpreter capability checks", async () => {
  const f = fixture("", ["missing.csv"], { probeInputOpen: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } });
  expect(await execute("csvpy", f.context)).toBe(1);
  expect(f.result().stderr).toBe("FileNotFoundError: [Errno 2] No such file or directory: 'missing.csv'\n");
});

test("reader retains Python module identity and exposes inherited header setting", async () => {

  const lines = ["type(reader).__module__\n", "reader.header\n", "from agate.csv import Reader as klass\n", "isinstance(reader,klass)\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["-H", "data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(f.result().stdout).toBe(">>> 'agate.csv_py3'\n>>> False\n>>> >>> True\n>>> ");
});

test("console SystemExit exits without an EOF banner or traceback", async () => {
  const lines = ["raise SystemExit(7)\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(7);
  expect(f.result()).toEqual({ stdout: ">>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\n' });
});

test("number ellipsis configuration is visible in a scoped Agate config module", async () => {
  const lines = ["from agate import config\n", "config.get_option('number_truncation_chars')\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["--no-number-ellipsis", "data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(f.result().stdout).toBe(">>> >>> ''\n>>> ");
});

test("guest reader iteration retains the engine row budget", async () => {
  const lines = ["list(reader)\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\nb\n"), writeFile: async () => { throw Error("write"); } } });
  const context = { ...f.context, limits: { ...f.context.limits, maxRows: 1 } };
  expect(await execute("csvpy", context)).toBe(78);
  expect(f.result().stderr).toContain("row budget exceeded\n");
});

test("synchronous guest output cannot bypass retained byte admission", async () => {
  const lines = ["print('x'*2000)\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  const context = { ...f.context, limits: { ...f.context.limits, maxRetainedBytes: 1024 } };
  expect(await execute("csvpy", context)).toBe(78);
  expect(f.result().stdout).toBe(">>> ");
  expect(f.result().stderr).toContain("retained byte budget exceeded\n");
});

test("overlapping guest close calls share cooperative failure completion", async () => {
  const failure = Error("close");
  let calls = 0;
  class FailingClose extends PythonSession { override close(): void { calls++; super.close(); throw failure; } }
  const interpreter = createCsvpyInterpreter({ createSession: options => new FailingClose({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => null } });
  const session = await interpreter.loadConverted!({ mode: "reader", settings: {}, retainOutput: () => {}, write: async () => {}, reader: async () => [][Symbol.iterator](), table: async () => { throw Error("unused"); } }, new AbortController().signal, { limit: 1000000, consume: () => {} });
  const results = await Promise.allSettled([session.close(), session.close()]);
  expect(results).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
  expect(calls).toBe(1);
});

test("agate loading cannot report a tuple-backed substitute as an Agate Table", async () => {
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => null } });
  const f = fixture("", ["--agate", "-I", "-y0", "data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\nb\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(78);
  expect(f.result()).toEqual({ stdout: "", stderr: "csvkit: unsupported or unqualified: csvpy Agate Table object library\n" });
});

test("console uses Python single-input compilation for semicolons, brackets and suites", async () => {
  const lines = ["1;2\n", "(\n", "3+\n", "4)\n", "def f():\n", " return 5\n", "\n", "f()\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(f.result()).toEqual({ stdout: ">>> 1\n2\n>>> ... ... 7\n>>> ... ... >>> 5\n>>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n' });
});

test("guest output reaches the terminal before its following exception traceback", async () => {
  const lines = ["print('before');1/0\n"];
  const events: { channel: string; text: string }[] = [];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const sink = (channel: string) => ({ write: async (bytes: Uint8Array) => { events.push({ channel, text: new TextDecoder().decode(bytes) }); } });
  const f = fixture("", ["data.csv"], { interpreter, stdout: sink("stdout"), stderr: sink("stderr"), fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(events.findIndex(event => event.text === "before\n")).toBeLessThan(events.findIndex(event => event.text.startsWith("Traceback")));
});

test("console exception formatting preserves user globals and ignores shadowed builtins", async () => {
  const lines = ["_csvpy_error='keep'; type=0; str=0; isinstance=0\n", "1/0\n", "_csvpy_error\n", "42\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(f.result()).toEqual({ stdout: ">>> >>> >>> 'keep'\n>>> 42\n>>> ", stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\nTraceback (most recent call last):\n  File "<console>", line 1, in <module>\nZeroDivisionError: division by zero\n\nnow exiting InteractiveConsole...\n' });
});

test("console calls a guest exception message formatter once", async () => {
  const lines = ["calls=[]\n", "class E(Exception):\n", " def __str__(self):\n", "  calls.append(1)\n", "  return 'message'\n", "\n", "raise E()\n", "calls\n"];
  const interpreter = createCsvpyInterpreter({ createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }), terminal: { readLine: async () => lines.shift() ?? null } });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("write"); } } });
  expect(await execute("csvpy", f.context)).toBe(0);
  expect(f.result().stdout).toBe(">>> >>> ... ... ... ... >>> >>> [1]\n>>> ");
  expect(f.result().stderr).toContain("E: message\n");
});

test("console recovers when a guest exception string formatter raises", async () => {
  expect(await objectConsole("a\n", [
    "class E(Exception):\n", " def __str__(self):raise ValueError('broken')\n", "\n", "raise E()\n", "42\n"
  ])).toEqual({
    status: 0, stdout: ">>> ... ... >>> >>> 42\n>>> ",
    stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\nTraceback (most recent call last):\n  File "<console>", line 1, in <module>\nE: <exception str() failed>\n\nnow exiting InteractiveConsole...\n'
  });
});

test("exception string formatting cannot swallow an output admission failure", async () => {
  const lines = ["class E(Exception):\n", " def __str__(self):\n", "  print('x'*2000)\n", "  return 'message'\n", "\n", "raise E()\n", "42\n"];
  const interpreter = createCsvpyInterpreter({
    createSession: options => new PythonSession({ ...options, limits: { maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100 }, hashSeed: [1n, 2n] }),
    terminal: { readLine: async () => lines.shift() ?? null }
  });
  const f = fixture("", ["data.csv"], { interpreter, fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => { throw Error("unexpected write"); } } });
  expect(await execute("csvpy", { ...f.context, limits: { ...defaultLimits, maxRetainedBytes: 1024 } })).toBe(78);
  expect(f.result()).toEqual({
    stdout: ">>> ... ... ... ... >>> ",
    stderr: 'Welcome! "data.csv" has been loaded in an agate.csv.reader object named "reader".\ncsvkit: unsupported or unqualified: retained byte budget exceeded\n'
  });
});
