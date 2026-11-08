import assert from "node:assert/strict";
import { test } from "vitest";
import reference from "../../../docs/csvkit/sql-unhashable-reference.json" with { type: "json" };
import { sqlOptions } from "./sql-options.js";
import { diagnosticReport, PythonException } from "./diagnostics/index.js";
import { CsvkitBlocked } from "./errors.js";
import { defaultLimits, execute, run } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext, DatabaseProvider } from "./contracts.js";

// These grammar/line-number profiles are measured refusals, not compatibility passes.
const blockers = ["{[]: 1} if True else {}", "{[]: 1}\n+", "{[]: 1, 1 +: 2}"];
for (const item of reference.cases) test(`original SQL conversion order: ${item.raw}`, () => {
  if (blockers.includes(item.raw)) {
    assert.throws(() => sqlOptions([["option", item.raw]]), CsvkitBlocked);
  } else if (item.kind === "raw") {
    assert.equal(sqlOptions([["option", item.raw]]).option, item.value);
  } else {
    assert.throws(() => sqlOptions([["option", item.raw]]), failure => {
      assert.ok(failure instanceof PythonException);
      assert.equal(failure.exceptionClass, item.kind);
      assert.equal(failure.detail, item.value);
      assert.deepEqual(diagnosticReport(failure, false, "utf-8"), {
        status: 1, stderr: `${item.kind}: ${item.value}\n`
      });
      return true;
    });
  }
});

function fixture(argv: string[], effects: string[]) {
  let stdout = "", stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const provider: DatabaseProvider = {
    schemes: ["sqlite"], profile: "explicit-host-contract-only",
    async connect() {
      effects.push("connect");
      return {
        profile: "explicit-host-contract-only", begin: async () => { effects.push("begin"); },
        commit: async () => { effects.push("commit"); }, rollback: async () => { effects.push("rollback"); },
        close: async () => { effects.push("close"); },
        query: async () => { throw new Error("query must not execute"); }
      };
    }
  };
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { throw new Error("unexpected file read"); }, writeFile: async () => { throw new Error("unexpected file write"); } },
    stdin: (async function* () { yield new TextEncoder().encode("x\n1\n"); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [provider],
    locale: { profile: "C", timezone: "UTC", formatNumber: String }, clock: { now: () => 0 },
    limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  return { context, cleanups, output: () => ({ stdout, stderr }) };
}

for (const item of reference.cliCases) test(`frozen CLI SQL literal failure: ${item.command} ${item.argv.join(" ")}`, async () => {
  const effects: string[] = [];
  const f = fixture(item.argv, effects);
  try {
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.output() }, {
      status: item.status, stdout: item.stdout, stderr: item.stderr
    });
    assert.deepEqual(effects, item.argv.includes("--execution-option") ? ["connect", "rollback", "close"] : []);
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});

for (const command of ["csvsql", "sql2csv"] as const) for (const sdk of [false, true]) {
  test(`${command} ${sdk ? "SDK" : "argv"} reports literal errors before driver acquisition`, async () => {
    const effects: string[] = [];
    const f = fixture(["--db", "sqlite://", "--engine-option", "connect_args", "{([]): 1}"], effects);
    try {
      const status = sdk
        ? await run({ command, settings: { connection_string: "sqlite://", engine_option: [["connect_args", "{([]): 1}"]] } }, f.context)
        : await execute(command, f.context);
      assert.equal(status, 1);
      assert.deepEqual(f.output(), { stdout: "", stderr: "TypeError: cannot use 'list' as a dict key (unhashable type: 'list')\n" });
      assert.deepEqual(effects, []);
    } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
  });
}

for (const sdk of [false, true]) test(`sql2csv ${sdk ? "SDK" : "argv"} execution-option failure releases the acquired driver`, async () => {
  const effects: string[] = [];
  const f = fixture(["--db", "sqlite://", "--query", "select 1", "--execution-option", "option", "{([],)}"], effects);
  try {
    const status = sdk
      ? await run({ command: "sql2csv", settings: { connection_string: "sqlite://", query: "select 1", execution_option: [["option", "{([],)}"]] } }, f.context)
      : await execute("sql2csv", f.context);
    assert.equal(status, 1);
    assert.deepEqual(f.output(), { stdout: "", stderr: "TypeError: cannot use 'tuple' as a set element (unhashable type: 'list')\n" });
    assert.deepEqual(effects, ["connect", "rollback", "close"]);
  } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
});
