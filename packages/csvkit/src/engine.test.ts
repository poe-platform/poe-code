import { test } from "vitest";
import assert from "node:assert/strict";
import reference from "../../../docs/csvkit/raw-operation-reference.json" with { type: "json" };
import additional from "../../../docs/csvkit/additional-operation-reference.json" with { type: "json" };
import lookReference from "../../../docs/csvkit/look-operation-reference.json" with { type: "json" };
import joinReference from "../../../docs/csvkit/join-operation-reference.json" with { type: "json" };
import sortReference from "../../../docs/csvkit/sort-operation-reference.json" with { type: "json" };
import fixedReference from "../../../docs/csvkit/fixed-operation-reference.json" with { type: "json" };
import jsonTableReference from "../../../docs/csvkit/json-table-operation-reference.json" with { type: "json" };
import jsonInputReference from "../../../docs/csvkit/json-input-operation-reference.json" with { type: "json" };
import sqlSchemaReference from "../../../docs/csvkit/sql-schema-operation-reference.json" with { type: "json" };
import statGuardReference from "../../../docs/csvkit/stat-guard-operation-reference.json" with { type: "json" };
import { execute, run, defaultLimits } from "./engine.js";
import { utf8Codec } from "./codecs/utf8.js";
import { OwnedArguments } from "./argv.js";
import { commands } from "./commands.js";
import { CsvkitBlocked } from "./errors.js";
import type { CsvkitContext } from "./contracts.js";

export function fixture(input: string, argv: readonly string[], overrides: Partial<CsvkitContext> = {}) {
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

test("csvsort explicit temporal formats preserve Python whitespace and subminute offsets", async () => {
  for (const [argv, input, stdout] of [
    [["--date-format", "%Y  %m  %d"], "d\n2024 02 29\n2023 12 31\n", "d\n2023-12-31\n2024-02-29\n"],
    [["--date-format", "%Y\u0085%m\u0085%d"], "d\n2024\u008502\u008529\n", "d\n2024-02-29\n"],
    [["--datetime-format", "%Y-%m-%d %H:%M:%S%z"], "d\n2024-01-01 00:00:00+00:00\n2024-01-01 00:00:00+00:00:00.000001\n2024-01-01 00:00:00-00:00:01.000001\n", "d\n2024-01-01T00:00:00+00:00:00.000001\n2024-01-01T00:00:00+00:00\n2024-01-01T00:00:00-00:00:01.000001\n"]
  ] as const) {
    const f = fixture(input, ["-y0", ...argv]);
    assert.equal(await execute("csvsort", f.context), 0);
    assert.deepEqual(f.result(), { stdout, stderr: "" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("singleton Agate selector diagnostics retain tuple punctuation separately from raw helpers", async () => {
  for (const command of ["csvcut", "csvsort", "csvjoin"] as const) {
    const f = fixture("a\nx\n", [...(command === "csvcut" ? [] : ["-I", "-y0"]), "-c", "absent"]);
    assert.equal(await execute(command, f.context), 1);
    assert.deepEqual(f.result(), { stdout: "", stderr:
      `ColumnIdentifierError: Column 'absent' is invalid. It is neither an integer nor a column name. Column names are: 'a'${command === "csvcut" ? "" : ","}\n` });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("engine FileType opens before help, closes without reading, and reports eager failures", async () => {
  for (const missing of [false, true]) {
    const events: string[] = [];
    const f = fixture("", ["-f", "matches", "--help"], {
      cwd: "/work",
      openMatchFile: async (path, settings) => {
        events.push(`open:${settings.cwd}/${path}`);
        assert.equal(settings.signal, f.context.signal);
        assert.ok(f.cleanups.length, "cleanup must register before acquisition");
        if (missing) throw new Error("No such file or directory");
        return { async *lines() { assert.fail("parse must not read match-file"); yield ""; },
          async close() { events.push("close"); } };
      }
    });
    const command = commands.find(command => command.name === "csvgrep")!;
    assert.equal(await execute("csvgrep", f.context), missing ? 2 : 0);
    assert.deepEqual(f.result(), missing ? {
      stdout: "", stderr: command.usage + "csvgrep: error: argument -f/--file: can't open 'matches': No such file or directory\n"
    } : { stdout: command.help, stderr: "" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
    assert.deepEqual(events, missing ? ["open:/work/matches"] : ["open:/work/matches", "close"]);
  }
});

test("missing FileType opening capability remains an explicit blocker before help", async () => {
  const f = fixture("", ["-f", "matches", "--help"]);
  assert.equal(await execute("csvgrep", f.context), 78);
  assert.deepEqual(f.result(), { stdout: "", stderr:
    "csvkit: unsupported or unqualified: csvgrep match-file opening capability\n" });
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});

test("SDK and argv report the same missing match-file capability", async () => {
  const cli = fixture("a\nx\n", ["-c", "a", "-f", "matches"]);
  const sdk = fixture("a\nx\n", []);
  try {
    const status = await execute("csvgrep", cli.context);
    assert.equal(await run({ command: "csvgrep", settings: { columns: "a", matchfile: "matches" } }, sdk.context), status);
    assert.deepEqual(sdk.result(), cli.result());
    assert.deepEqual(sdk.result(), { stdout: "", stderr:
      "csvkit: unsupported or unqualified: csvgrep match-file opening capability\n" });
    assert.equal(status, 78);
  } finally {
    await Promise.all([...cli.cleanups, ...sdk.cleanups].map(cleanup => cleanup()));
  }
});

test("SDK match-file capability refusal preserves cancellation and output bounds", async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController();
    const refusal = new CsvkitBlocked("host match-file policy");
    let reads = 0;
    const f = fixture("", [], {
      signal: controller.signal,
      limits: { ...defaultLimits, maxOutputBytes: 0 },
      stdin: { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array(); } },
      openMatchFile: async () => {
        if (cancelled) controller.abort(refusal);
        throw refusal;
      }
    });
    try {
      const execution = run({ command: "csvgrep", settings: { columns: "a", matchfile: "matches" } }, f.context);
      if (cancelled) await assert.rejects(execution, failure => failure === refusal);
      else assert.equal(await execution, 78);
      assert.equal(reads, 0);
      assert.deepEqual(f.result(), { stdout: "", stderr: "" });
    } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
  }
});

for (const [index, item] of jsonTableReference.cases.entries()) {
  test(`frozen JSON table ${index}`, async () => {
    const f = fixture(item.stdin, item.argv);
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  });
}
for (const [index, item] of jsonInputReference.cases.entries()) {
  // Python's path-dependent warning remains an explicit provenance blocker.
  if (index === 5) continue;
  test(`frozen JSON input ${index}`, async () => {
    const f = fixture(item.stdin, item.argv);
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  });
}
for (const [index, item] of sqlSchemaReference.cases.entries()) {
  test(`frozen SQL schema ${index}`, async () => {
    const f = fixture(item.stdin, item.argv);
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  });
}
for (const [index, item] of statGuardReference.cases.entries()) {
  test(`frozen statistics admission ${index}`, async () => {
    const f = fixture(item.stdin, item.argv);
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  });
}

for (const [index, item] of reference.cases.entries()) {
  // Kept in the reference inventory as a blocker, never credited as parity.
  if (index === 37) continue;
  test(`frozen raw operation ${index}: ${item.command} ${item.argv.join(" ")}`, async () => {
    const f = fixture(item.stdin, item.argv);
    const status = await execute(item.command, f.context);
    assert.deepEqual({ status, ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  });
}
test("unimplemented numeric input quoting is explicitly blocked", async () => {
  const f = fixture('"a","b"\n1,2\n', ["-u", "2"]);
  assert.equal(await execute("csvcut", f.context), 78);
  assert.deepEqual(f.result(), { stdout: "a,b\n", stderr: "csvkit: unsupported or unqualified: input quoting mode 2 numeric/null operation cells\n" });
});
for (const [index, item] of additional.cases.entries()) {
  test(`additional frozen operation ${index}: ${item.command} ${item.argv.join(" ")}`, async () => {
    const f = fixture(item.stdin, item.argv);
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
  });
}
test("SDK settings share descriptor defaults and the actual CSV operation", async () => {
  const f = fixture("a,b\nx,y\n", []);
  assert.equal(await run({ command: "csvcut", settings: { columns: "b,a,b", line_numbers: true } }, f.context), 0);
  assert.deepEqual(f.result(), { stdout: "line_number,b,a,b\n1,y,x,y\n", stderr: "" });
});
test("SDK repeatable single-value options preserve the CLI argument sequence", async () => {
  const input = "a,b\nx,y\n";
  const argv = fixture(input, ["-I", "-y0", "--prefix", "OR IGNORE", "--prefix", "OR REPLACE"]);
  const sdk = fixture(input, []);
  const expected = { status: await execute("csvsql", argv.context), ...argv.result() };
  assert.deepEqual({ status: await run({ command: "csvsql", settings: { no_inference: true, sniff_limit: 0, prefix: ["OR IGNORE", "OR REPLACE"] } }, sdk.context), ...sdk.result() }, expected);
  const emptyQueries = fixture(input, []);
  assert.deepEqual({ status: await run({ command: "csvsql", settings: { no_inference: true, sniff_limit: 0, queries: [] } }, emptyQueries.context), ...emptyQueries.result() }, expected);
  // @ts-expect-error JavaScript consumers still receive runtime cardinality validation
  await assert.rejects(run({ command: "csvsql", settings: { prefix: "OR IGNORE" } }, fixture(input, []).context), /argument sequence/);
});
test("SDK rejects settings suppressed by the selected command", async () => {
  const f = fixture("a\nx\n", []);
  // @ts-expect-error JavaScript consumers still receive runtime applicability validation
  await assert.rejects(run({ command: "csvcut", settings: { no_inference: true } }, f.context), /not applicable/);
  assert.deepEqual(f.result(), { stdout: "", stderr: "" });
});
test("SDK checks argument cardinality before acquiring input or databases", async () => {
  const f = fixture("", []);
  // @ts-expect-error exercise untyped caller validation
  await assert.rejects(run({ command: "csvstack", settings: { input_paths: "abc.csv" } }, f.context), /argument sequence/);
  // @ts-expect-error exercise untyped caller validation
  await assert.rejects(run({ command: "sql2csv", settings: { engine_option: ["echo", "True"] } }, f.context), /pairs/);
  // @ts-expect-error exercise untyped caller validation
  await assert.rejects(run({ command: "csvcut", settings: { columns: ["a", "b"] } }, f.context), /text/);
});

test("SDK validates all settings before opening a match file", async () => {
  let opens = 0;
  const f = fixture("a\nx\n", [], {
    openMatchFile: async () => {
      opens++;
      return { async *lines() { yield "x"; }, async close() {} };
    }
  });
  // @ts-expect-error untyped callers can put an invalid setting after the file setting
  await assert.rejects(run({ command: "csvgrep", settings: { matchfile: "matches", columns: ["a"] } }, f.context), /text/);
  assert.equal(opens, 0);
  assert.equal(f.cleanups.length, 0);
  assert.deepEqual(f.result(), { stdout: "", stderr: "" });
});

test("SDK owns later settings before awaiting match-file acquisition", async () => {
  const f = fixture("a\nCUSTOM\n", []);
  let columns = "a";
  let reads = 0;
  const settings = { matchfile: "matches", get columns() { reads++; return columns; } };
  const grep = fixture("a,b\nx,y\n", [], {
    openMatchFile: async () => {
      columns = "b";
      return { async *lines() { yield "x"; }, async close() {} };
    }
  });
  assert.equal(await run({ command: "csvgrep", settings }, grep.context), 0);
  assert.equal(reads, 1);
  assert.deepEqual(grep.result(), { stdout: "a,b\nx,y\n", stderr: "" });
  assert.equal(await run({ command: "csvgrep", settings: { columns: "a", pattern: "CUSTOM", matchfile: null } }, f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a\nCUSTOM\n", stderr: "" });
});

test("SDK rejects sparse argument sequences before output or capability acquisition", async () => {
  for (const [command, key] of [["csvstack", "input_paths"], ["csvsql", "prefix"], ["sql2csv", "engine_option"]] as const) {
    let acquired = false;
    const f = fixture("a\n1\n", [], {
      stdin: { async *[Symbol.asyncIterator]() { acquired = true; yield new Uint8Array(); } },
      fs: { readFile: async () => { acquired = true; throw new Error("unexpected acquisition"); },
        writeFile: async () => { acquired = true; } }
    });
    await assert.rejects(run({ command: command!, settings: { [key!]: new Array(1) } }, f.context), TypeError);
    assert.equal(acquired, false);
    assert.deepEqual(f.result(), { stdout: "", stderr: "" });
    assert.equal(f.cleanups.length, 0);
  }
});

test("SDK admits settings bytes and sequence counts before match-file acquisition", async () => {
  for (const [settings, limits, diagnostic] of [
    [{ matchfile: "matches", columns: "😀" }, { maxArgumentBytes: 10 }, "SDK argument byte budget exceeded"],
    [{ input_paths: ["one", "two"] }, { maxArguments: 1 }, "SDK argument count budget exceeded"],
    [{ matchfile: "matches", columns: "a" }, { maxRetainedBytes: 1 }, "retained byte budget exceeded"]
  ] as const) {
    let acquired = false;
    const f = fixture("a\nx\n", [], {
      limits: { ...defaultLimits, ...limits },
      openMatchFile: async () => { acquired = true; throw new Error("unexpected open"); },
      stdin: { async *[Symbol.asyncIterator]() { acquired = true; yield new Uint8Array(); } }
    });
    const status = await run("input_paths" in settings ? { command: "csvstack", settings } : { command: "csvgrep", settings }, f.context);
    assert.equal(status, 78);
    assert.deepEqual(f.result(), { stdout: "", stderr: `csvkit: unsupported or unqualified: ${diagnostic}\n` });
    assert.equal(acquired, false);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("SDK settings graphs admit nesting and charge each independently cloned setting", async () => {
  let nested: unknown = "value";
  for (let index = 0; index < 4; index++) nested = { child: nested };
  const depth = fixture("", [], { limits: { ...defaultLimits, maxNestingDepth: 2 } });
  assert.equal(await run({ command: "sql2csv", settings: { engine_option: [["nested", nested]] } }, depth.context), 78);
  assert.deepEqual(depth.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: SDK settings nesting budget exceeded\n" });
  const options = [["echo", true]] as const;
  const retained = fixture("", [], { limits: { ...defaultLimits, maxRetainedBytes: 270 } });
  assert.equal(await run({ command: "sql2csv", settings: { engine_option: options, execution_option: options } }, retained.context), 78);
  assert.deepEqual(retained.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: retained byte budget exceeded\n" });
});

test("SDK bigint arguments cannot bypass a zero byte allowance", async () => {
  const f = fixture("a\nx\n", [], { limits: { ...defaultLimits, maxArgumentBytes: 0 } });
  assert.equal(await run({ command: "csvlook", settings: { max_rows: 0n } }, f.context), 78);
  assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: SDK argument byte budget exceeded\n" });
});

test("SDK nesting beyond its clone qualification is a named divergence, never a stack overflow", async () => {
  let nested: unknown = true;
  for (let index = 0; index < 5000; index++) nested = { child: nested };
  const f = fixture("", [], { limits: { ...defaultLimits, maxNestingDepth: 10000, maxArguments: 20000 } });
  assert.equal(await run({ command: "sql2csv", settings: { engine_option: [["nested", nested]] } }, f.context), 78);
  assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: SDK settings nesting beyond qualified depth 256\n" });
});
test("JSON indentation is admitted before constructing multiplied output", async () => {
  const f = fixture("a,b,c\nx,y,z\n", ["--stream", "-I", "-y0", "-i1000"], { limits: { ...defaultLimits, maxRetainedBytes: 1024 } });
  assert.equal(await execute("csvjson", f.context), 78);
  assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: retained byte budget exceeded\n" });
});
test("empty input fragments still consume bounded retained buffer slots", async () => {
  const f = fixture("", [], {
    stdin: (async function* () { for (let index = 0; index < 4; index++) yield new Uint8Array(); })(),
    limits: { ...defaultLimits, maxRetainedBytes: 128 }
  });
  assert.equal(await execute("csvcut", f.context), 78);
  assert.equal(f.result().stderr, "csvkit: unsupported or unqualified: retained byte budget exceeded\n");
});
test("decoded codepoint budget spans multiple input files", async () => {
  const f = fixture("", ["a.csv", "b.csv"], {
    fs: { readFile: async () => new TextEncoder().encode("a\n"), writeFile: async () => {} },
    limits: { ...defaultLimits, maxCodepoints: 3 }
  });
  assert.equal(await execute("csvstack", f.context), 78);
  assert.equal(f.result().stderr, "csvkit: unsupported or unqualified: codepoint budget exceeded\n");
});
test("cancellation returns a cooperative pending stdin iterator without host cleanup dispatch", async () => {
  const controller = new AbortController();
  let started!: () => void;
  let release!: () => void;
  let returns = 0;
  const opened = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = fixture("", [], {
    signal: controller.signal,
    stdin: { [Symbol.asyncIterator]: () => ({
      next: async () => { started(); await pending; return { done: true, value: undefined }; },
      return: async () => { returns++; release(); return { done: true, value: undefined }; }
    }) }
  });
  const executing = execute("csvcut", f.context);
  await opened;
  controller.abort(false);
  // The finite assertion below avoids a timeout/slow hanging canonical test on
  // the unfixed candidate, and only closes resources admitted by this test.
  await Promise.resolve(); await Promise.resolve();
  const observed = returns;
  if (!observed) await Promise.all(f.cleanups.map(cleanup => cleanup()));
  await assert.rejects(executing, failure => failure === false);
  assert.equal(observed, 1);
});
test("exported environment controls inherited input encoding, explicit -e overrides it", async () => {
  const f = fixture("\ufeffa\nx\n", [], { env: { PYTHONIOENCODING: "utf-8" } });
  assert.equal(await execute("csvcut", f.context), 0);
  assert.equal(f.result().stdout, "\ufeffa\nx\n");
  const explicit = fixture("\ufeffa\nx\n", ["-e", "utf-8-sig"], { env: { PYTHONIOENCODING: "utf-8" } });
  assert.equal(await execute("csvcut", explicit.context), 0);
  assert.equal(explicit.result().stdout, "a\nx\n");
});
test("injected compression cannot bypass inflated byte budgets", async () => {
  const f = fixture("", ["input.csv.gz"], {
    fs: { readFile: async () => new Uint8Array(1), writeFile: async () => {} },
    compression: [{ extensions: [".gz"], decode: async function* (source) { for await (const ignoredChunk of source) yield new TextEncoder().encode("abcdefgh\n"); } }],
    limits: { ...defaultLimits, maxInflatedBytes: 3 }
  });
  assert.equal(await execute("csvcut", f.context), 78);
  assert.equal(f.result().stderr, "csvkit: unsupported or unqualified: inflated byte budget exceeded\n");
});
test("injected compression cannot bypass compressed input byte budgets", async () => {
  const f = fixture("", ["input.csv.gz"], {
    fs: { readFile: async () => new Uint8Array(3), writeFile: async () => {} },
    compression: [{ extensions: [".gz"], decode: async function* (source) { for await (const ignoredChunk of source) yield new TextEncoder().encode("a"); } }],
    limits: { ...defaultLimits, maxInputBytes: 2 }
  });
  assert.equal(await execute("csvcut", f.context), 78);
  assert.equal(f.result().stderr, "csvkit: unsupported or unqualified: input byte budget exceeded\n");
});
test("published descriptor metadata cannot change another invocation's grammar", async () => {
  const command = commands.find(item => item.name === "csvcut")!;
  const strings = command.actions.find(action => action.dest === "help")!.optionStrings as string[];
  let mutationAccepted = false;
  try { strings.push("--intruder"); mutationAccepted = true; } catch { /* immutable published metadata */ }
  const f = fixture("", ["--intruder"]);
  const status = await execute("csvcut", f.context);
  // Restore only this test's mutation on an unfixed candidate.
  if (mutationAccepted) strings.pop();
  assert.equal(status, 2);
  assert.match(f.result().stderr, /unrecognized arguments: --intruder/);
});
for (const [index, item] of fixedReference.cases.entries()) test(`fixed-width reference ${index}`, async () => {
  const f = fixture(item.stdin, ["-s", "schema.csv"], {
    fs: { readFile: async path => { assert.equal(path, "/schema.csv"); return new TextEncoder().encode(item.schema); }, writeFile: async () => { assert.fail("unexpected write"); } }
  });
  assert.deepEqual({ status: await execute("in2csv", f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
});

for (const [index, item] of sortReference.cases.entries()) {
  if (index === 6) continue; // Absolute Python warning provenance remains unqualified.
  test(`sort/empty-path frozen operation ${index}`, async () => {
    const f = fixture(item.stdin, item.argv);
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
  });
}

for (const [index, item] of joinReference.cases.entries()) test(`join frozen operation ${index}`, async () => {
  const files = item.files as Record<string, string>;
  const f = fixture(item.stdin, item.argv, { fs: { readFile: async path => {
    assert.ok(Object.hasOwn(files, path)); return new TextEncoder().encode(files[path]);
  }, writeFile: async () => { assert.fail("unexpected join file write"); } } });
  assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
});

test("SDK accepts variadic custom null markers as an owned sequence", async () => {
 const f = fixture("k,v\nCUSTOM,x\na,y\n", []);
 assert.equal(await run({ command: "csvsort", settings: { no_inference: true, sniff_limit: 0, null_values: ["CUSTOM"] } }, f.context), 0);
 assert.deepEqual(f.result(), { stdout: "k,v\na,y\n,x\n", stderr: "" });
});

test("csvpy refuses stdin with the original parser diagnostic before acquisition", async () => {
 const f = fixture("a,b\nx,y\n", []);
 const descriptor = commands.find(command => command.name === "csvpy")!;
 assert.equal(await execute("csvpy", f.context), 2);
 assert.deepEqual(f.result(), { stdout: "", stderr: descriptor.usage + "csvpy: error: csvpy cannot accept input as piped data via STDIN.\n" });
});
test("csvpy loads an injected compatible interpreter and drains its owned session", async () => {
 const effects: unknown[] = [];
 const f = fixture("", ["--dict", "data.csv"], {
  fs: { readFile: async path => { assert.equal(path, "/data.csv"); return new TextEncoder().encode("a,b\nx,y\n"); }, writeFile: async () => { assert.fail("unexpected write"); } },
  interpreter: { modes: ["dict"], load: async (mode, source, settings, signal) => {
   let input = ""; for await (const bytes of source) input += new TextDecoder().decode(bytes);
   effects.push(["load", mode, input, settings.input_path]); signal.throwIfAborted();
   return { profile: "test-only", interact: async banner => { effects.push(["interact", banner]); }, close: async () => { effects.push("close"); } };
  } }
 });
 assert.equal(await execute("csvpy", f.context), 0);
 assert.deepEqual(effects, [["load", "dict", "a,b\nx,y\n", "data.csv"], ["interact", 'Welcome! "data.csv" has been loaded in an agate.csv.DictReader object named "reader".'], "close"]);
 await Promise.all(f.cleanups.map(cleanup => cleanup())); assert.equal(effects.length, 3);
});

for (const [index, item] of lookReference.cases.entries()) test(`look frozen operation ${index}`, async () => {
 const f = fixture(item.stdin, item.argv);
 assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
});

test("csvpy interpreter work budget rejects admission before guest load", async () => {
 let loads = 0;
 const f = fixture("", ["data.csv"], { limits: { ...defaultLimits, maxInterpreterWork: 0 }, interpreter: {
  modes: ["reader"], load: async () => { loads++; return { profile: "test-only", interact: async () => {}, close: async () => {} }; }
 } });
 assert.equal(await execute("csvpy", f.context), 78);
 assert.equal(loads, 0);
 assert.equal(f.result().stderr, "csvkit: unsupported or unqualified: interpreter work budget exceeded\n");
});

test("output refusal retains status 78 when no diagnostic fits the byte budget", async () => {
 const f = fixture("a,b\nx,y\nz,q\n", ["-I", "-y0"], { limits: { ...defaultLimits, maxOutputBytes: 25 } });
 assert.equal(await execute("csvlook", f.context), 78);
 assert.deepEqual(f.result(), { stdout: "| a | b |\n| - | - |\n", stderr: "" });
});

test("execution preflights invocation argv count and byte budgets before copying owned payloads", async () => {
 for (const limits of [{ ...defaultLimits, maxArguments: 0 }, { ...defaultLimits, maxArgumentBytes: 0 }]) {
  let copies = 0;
  class ObservedArguments extends OwnedArguments {
   override bytes(index: number) { copies++; return super.bytes(index); }
  }
  const f = fixture("", [], { argv: new ObservedArguments([new TextEncoder().encode("--help")], defaultLimits), limits });
  assert.equal(await execute("csvcut", f.context), 78);
  assert.deepEqual(f.result(), { stdout: "", stderr: `csvkit: unsupported or unqualified: argv ${limits.maxArguments === 0 ? "count" : "byte"} limit exceeded\n` });
  assert.equal(copies, 0);
 }
});

test("output column admission includes the generated line-number column", async () => {
 const f = fixture("a\nx\n", ["-l"], { limits: { ...defaultLimits, maxColumns: 1 } });
 assert.equal(await execute("csvcut", f.context), 78);
 assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: output column budget exceeded\n" });
});

test("registered guest cleanup retains an already selected interpreter budget refusal", async () => {
 const f = fixture("", ["data.csv"], { limits: { ...defaultLimits, maxInterpreterWork: 1 }, interpreter: {
  modes: ["reader"], load: async (_mode, _source, _settings, _signal, work) => ({ profile: "test-only", interact: async () => { work.consume(); }, close: async () => { throw new Error("secondary close failure"); } })
 } });
 assert.equal(await execute("csvpy", f.context), 78);
 assert.deepEqual(f.result(), { stdout: "", stderr: "csvkit: unsupported or unqualified: interpreter work budget exceeded\n" });
 await assert.doesNotReject(Promise.all(f.cleanups.map(cleanup => cleanup())));
});

test("SDK snapshots all admitted budget fields even when supplied through a prototype", async () => {
 const limits = Object.create({ ...defaultLimits, maxOutputBytes: 0 }) as CsvkitContext["limits"];
 const f = fixture("a\nx\n", [], { limits });
 assert.equal(await run({ command: "csvcut" }, f.context), 78);
 assert.deepEqual(f.result(), { stdout: "", stderr: "" });
});
