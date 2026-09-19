import test from "node:test";
import assert from "node:assert/strict";
import { CsvkitDiagnostic, createSqlTransportProvider, utf8Codec, type DatabaseProvider } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const command of ["sql2csv", "csvsql"]) test(`${command} retains streamed rows before a late driver failure and releases ownership once`, async () => {
  const effects: string[] = [];
  const provider: DatabaseProvider = { profile: "memory-stream-boundary", schemes: ["review"], async connect() {
    return { profile: "memory-stream-boundary", async begin() { effects.push("begin"); },
      async commit() { assert.fail("failed query must not commit"); },
      async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); },
      async query() { return { columns: ["value"], rows: { [Symbol.asyncIterator]() {
        let count = 0;
        return { async next() {
          if (count++ === 0) return { done: false as const, value: ["first\nrow"] };
          throw new CsvkitDiagnostic("OperationalError: late streamed fetch failed");
        }, async return() { effects.push("iterator-return"); return { done: true as const, value: undefined }; } };
      } }, async close() { effects.push("result-close"); } }; }
    };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const result = await shell.exec(`${command} ${command === "csvsql" ? "-y 0" : ""} --db review://owned --query 'SELECT value'`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: 'value\n"first\nrow"\n', stderr: "OperationalError: late streamed fetch failed\n", status: 1
    });
    assert.deepEqual(effects, [...(command === "csvsql" ? ["begin"] : []), "iterator-return", "result-close", "rollback", "session-close"]);
    await shell.dispose();
    assert.equal(effects.filter(effect => effect === "result-close").length, 1);
  } finally { await shell.dispose(); }
});

for (const commitFails of [false, true]) test(`csvsql cancellation drains a late ${commitFails ? "rejected" : "successful"} commit before transaction cleanup`, async () => {
  const effects: string[] = [];
  let announce!: () => void, release!: () => void;
  const admitted = new Promise<void>(resolve => { announce = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const caller = new AbortController();
  const reason = new Error("caller cancelled committing import");
  const provider: DatabaseProvider = { profile: "memory-stream-boundary", schemes: ["review"], async connect() {
    return { profile: "memory-stream-boundary", async begin() { effects.push("begin"); },
      async commit() { effects.push("commit-start"); announce(); await pending; effects.push("commit-settled"); if (commitFails) throw new Error("late commit failure"); },
      async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); },
      async query() { return { columns: null, rows: { [Symbol.asyncIterator]() { assert.fail("non-row result must not acquire iterator"); } },
        async close() { effects.push("result-close"); } }; }
    };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  let settled = false;
  const rejected = assert.rejects(shell.exec("csvsql -y 0 --db review://owned --query 'UPDATE owned SET value=1'", { signal: caller.signal }), caught => caught === reason)
    .then(() => { settled = true; });
  try {
    await admitted; caller.abort(reason);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    assert.deepEqual(effects, ["begin", "result-close", "commit-start"]);
    release(); await rejected;
    assert.deepEqual(effects, ["begin", "result-close", "commit-start", "commit-settled", ...(commitFails ? ["rollback"] : []), "session-close"]);
  } finally { release(); await rejected; await shell.dispose(); }
});

test("actual Shell MSSQL throwing interruption preserves caller cancellation and drains the acquired connection", async () => {
  const effects: string[] = [];
  let announce!: () => void, release!: () => void;
  const admitted = new Promise<void>(resolve => { announce = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const caller = new AbortController();
  const reason = new Error("cancel MSSQL request");
  const provider = createSqlTransportProvider({ profile: "mssql-node-v1", authorize: async () => true,
    driver: {
      acquire: async () => ({}), release: async () => { effects.push("release"); },
      transaction: () => ({ begin: async () => {}, commit: async () => { assert.fail("sql2csv cannot commit"); }, rollback: async () => { effects.push("rollback"); } }),
      request: () => {
        const request = { arrayRowMode: false, input() { return request; },
          query: async () => { effects.push("query-start"); announce(); await pending; effects.push("query-settled"); return {}; },
          cancel: () => { effects.push("cancel"); throw new Error("request interruption failed"); }
        };
        return request;
      }
    }
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  let settled = false;
  const rejected = assert.rejects(shell.exec("sql2csv --db mssql://allowed/db --execution-option stream_results False --query 'SELECT value'", { signal: caller.signal }), caught => caught === reason)
    .then(() => { settled = true; });
  try {
    await admitted; caller.abort(reason);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    assert.deepEqual(effects, ["query-start", "cancel"]);
    release(); await rejected;
    assert.deepEqual(effects, ["query-start", "cancel", "query-settled", "rollback", "release"]);
  } finally { release(); await rejected; await shell.dispose(); }
});
