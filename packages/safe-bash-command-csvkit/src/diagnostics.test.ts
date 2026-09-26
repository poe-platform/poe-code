import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import { commands } from "./commands.js";
import type { CsvkitContext } from "./contracts.js";
import { diagnosticReport, fileException, PythonException, warningText } from "./diagnostics/index.js";

function fixture(input: string, argv: readonly string[], overrides: Partial<CsvkitContext> = {}) {
  let stdout = "", stderr = "";
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(arg => encoder.encode(arg)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { assert.fail("unexpected read"); }, writeFile: async () => { assert.fail("unexpected write"); } },
    stdin: (async function* () { yield encoder.encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += decoder.decode(bytes); } },
    stderr: { write: async bytes => { stderr += decoder.decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { assert.fail("unexpected locale"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: () => {}, ...overrides
  };
  return { context, result: () => ({ stdout, stderr }) };
}

test("unknown filesystem codes preserve the original failure including prototype property names", async () => {
  for (const code of ["EUNKNOWN", "constructor", "toString", "__proto__"]) {
    const failure = Object.assign(new Error("opaque adapter failure"), { code });
    assert.equal(fileException(failure, "input.csv"), failure);
    const f = fixture("", ["input.csv"], { fs: {
      readFile: async () => { throw failure; }, writeFile: async () => {}
    } });
    await assert.rejects(execute("csvcut", f.context), caught => caught === failure);
    assert.deepEqual(f.result(), { stdout: "", stderr: "" });
  }
});

test("Python uncaught handler preserves message newline and Unicode special case", () => {
  assert.deepEqual(diagnosticReport(new PythonException("ValueError", "invalid\n"), false, "utf-8"),
    { status: 1, stderr: "ValueError: invalid\n\n" });
  assert.deepEqual(diagnosticReport(new PythonException("UnicodeDecodeError", "reference detail"), false, "latin-1"),
    { status: 1, stderr: 'Your file is not "latin-1" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.\n' });
});

test("explicit Python frames format verbose diagnostics without a JavaScript stack", async () => {
  const f = fixture("", ["-v", "input.csv"], { fs: {
    readFile: async () => { throw new PythonException("ValueError", "bad input", { profile: "CPython-3.14.2-reference", frames: [
      { path: "/reference/csvcut", line: 8, function: "<module>", source: "  sys.exit(launch_new_instance())" },
      { path: "/reference/csvkit/utilities/csvcut.py", line: 42, function: "main" }
    ] }); }, writeFile: async () => {}
  } });
  assert.equal(await execute("csvcut", f.context), 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: 'Traceback (most recent call last):\n  File "/reference/csvcut", line 8, in <module>\n    sys.exit(launch_new_instance())\n  File "/reference/csvkit/utilities/csvcut.py", line 42, in main\nValueError: bad input\n' });
});

test("warning formatting retains category and supplied Python provenance", () => {
  assert.equal(warningText({ path: "/reference/agate/table.py", line: 9, category: "DuplicateColumnWarning", message: "duplicate", source: "  warnings.warn(message)" }),
    "/reference/agate/table.py:9: DuplicateColumnWarning: duplicate\n  warnings.warn(message)\n");
});

test("warning and traceback source lines use frozen Python strip semantics", () => {
  const source = "\u0085\ufeffline\ufeff\u0085";
  assert.equal(warningText({ path: "reference.py", line: 1, category: "UserWarning", message: "test", source }),
    "reference.py:1: UserWarning: test\n  \ufeffline\ufeff\n");
  assert.deepEqual(diagnosticReport(new PythonException("ValueError", "test", {
    profile: "CPython-3.14.2-reference", frames: [{ path: "reference.py", line: 1, function: "main", source }]
  }), true, "utf-8"), {
    status: 1, stderr: 'Traceback (most recent call last):\n  File "reference.py", line 1, in main\n    \ufeffline\ufeff\nValueError: test\n'
  });
});

test("empty source lines follow distinct Python warning and traceback rules", () => {
  for (const source of ["", "   ", "\u0085"]) {
    assert.equal(warningText({ path: "reference.py", line: 1, category: "UserWarning", message: "test", source }),
      "reference.py:1: UserWarning: test\n" + (source ? "  \n" : ""));
    assert.deepEqual(diagnosticReport(new PythonException("ValueError", "test", {
      profile: "CPython-3.14.2-reference", frames: [{ path: "reference.py", line: 1, function: "main", source }]
    }), true, "utf-8"), {
      status: 1, stderr: 'Traceback (most recent call last):\n  File "reference.py", line 1, in main\nValueError: test\n'
    });
  }
});

test("invalid Python frame metadata cannot masquerade as a qualified traceback", () => {
  assert.deepEqual(diagnosticReport(new PythonException("ValueError", "invalid", { profile: "", frames: [
    { path: "reference.py", line: 0, function: "main" }
  ] }), true, "utf-8"), { status: 78, stderr: "csvkit: unsupported or unqualified: frozen Python traceback frames and deployment identity\n" });
});

test("verbose successful operations run without requiring a traceback", async () => {
  const f = fixture("a\nx\n", ["-v"]);
  assert.equal(await execute("csvcut", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a\nx\n", stderr: "" });
});

test("synchronous stream acquisition errors use the same delayed file handler", async () => {
  const f = fixture("", ["missing.csv"], { fs: {
    readFile: async () => { assert.fail("stream access expected"); }, writeFile: async () => {},
    readStream: () => { throw Object.assign(new Error("adapter-specific"), { code: "ENOENT" }); }
  } });
  assert.equal(await execute("csvcut", f.context), 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: "FileNotFoundError: [Errno 2] No such file or directory: 'missing.csv'\n" });
});

test("eager argparse FileType uses str(exception) without the uncaught class prefix", async () => {
  const detail = "[Errno 2] No such file or directory: 'matches'";
  const f = fixture("", ["-f", "matches", "--help"], { openMatchFile: async () => {
    throw new PythonException("FileNotFoundError", detail);
  } });
  assert.equal(await execute("csvgrep", f.context), 2);
  assert.deepEqual(f.result(), { stdout: "", stderr: commands.find(command => command.name === "csvgrep")!.usage +
    `csvgrep: error: argument -f/--file: can't open 'matches': ${detail}\n` });
});

test("delayed missing input uses Python application status and class, after help precedence", async () => {
  let reads = 0;
  const fs = { readFile: async () => { reads++; throw Object.assign(new Error("host-specific text"), { code: "ENOENT" }); }, writeFile: async () => {} };
  const help = fixture("", ["missing.csv", "--help"], { fs });
  assert.equal(await execute("csvcut", help.context), 0);
  assert.equal(reads, 0);
  const f = fixture("", ["missing.csv"], { fs });
  assert.equal(await execute("csvcut", f.context), 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: "FileNotFoundError: [Errno 2] No such file or directory: 'missing.csv'\n" });
});

test("verbose unqualified error frames remain a blocker after actual input acquisition", async () => {
  let reads = 0;
  const f = fixture("", ["-v", "missing.csv"], { fs: {
    readFile: async () => { reads++; throw Object.assign(new Error(), { code: "ENOENT" }); }, writeFile: async () => {}
  } });
  assert.equal(await execute("csvcut", f.context), 78);
  assert.equal(reads, 1);
  assert.equal(f.result().stderr, "csvkit: unsupported or unqualified: frozen Python traceback frames and deployment identity\n");
});
