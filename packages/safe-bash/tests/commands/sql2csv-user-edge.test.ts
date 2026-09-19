import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec, type DatabaseProvider, type DatabaseResult } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import reference from "../../../../docs/csvkit/sql2csv-reference.json" with { type: "json" };

function fixture(result: (effects: string[]) => DatabaseResult) {
  const effects: string[] = [];
  const provider: DatabaseProvider = {
    schemes: ["sqlite"], profile: "in-memory-user-edges",
    async connect() {
      effects.push("connect");
      return {
        profile: "in-memory-user-edges",
        async begin() { assert.fail("sql2csv cannot begin a transaction explicitly"); },
        async commit() { assert.fail("sql2csv cannot commit"); },
        async rollback() { effects.push("rollback"); },
        async close() { effects.push("session-close"); },
        async query() { effects.push("query"); return result(effects); }
      };
    }
  };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({
    codecs: [utf8Codec], databases: [provider],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { assert.fail("unexpected locale formatting"); } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  return { effects, shell };
}

for (const item of reference.cases.filter(item => item.name.startsWith("empty-result-"))) {
  test(`actual Shell frozen sql2csv ${item.name} keeps empty-result header quirks`, async () => {
    const f = fixture(effects => ({
      columns: item.columns!, rows: { async *[Symbol.asyncIterator]() { effects.push("iterator-start"); yield* []; } },
      async close() { effects.push("result-close"); }
    }));
    try {
      const argv = item.argv.map(value => "'" + value.split("'").join("'\\''") + "'").join(" ");
      const result = await f.shell.exec(`sql2csv ${argv}`);
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [item.stdout, item.stderr, item.status]);
      assert.deepEqual(f.effects, ["connect", "query", "iterator-start", "result-close", "rollback", "session-close"]);
    } finally { await f.shell.dispose(); }
    assert.equal(f.effects.length, 6);
  });
}

for (const readFails of [false, true]) {
  test(`actual Shell sql2csv caller cancellation drains ${readFails ? "rejected" : "successful"} admitted driver reads`, async () => {
    let announce!: () => void, release!: () => void;
    const admitted = new Promise<void>(resolve => { announce = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const caller = new AbortController();
    const f = fixture(effects => ({
      columns: ["value"],
      rows: { [Symbol.asyncIterator]() { return {
        async next() {
          effects.push("next-start"); announce(); await pending; effects.push("next-settled");
          if (readFails) throw new Error("late driver failure");
          return { done: true as const, value: undefined };
        },
        async return() { effects.push("iterator-return"); return { done: true as const, value: undefined }; }
      }; } },
      async close() { effects.push("result-close"); }
    }));
    const execution = f.shell.exec("sql2csv --query 'SELECT pending'", { signal: caller.signal });
    const rejected = assert.rejects(execution, reason => reason === false);
    try {
      await admitted; caller.abort(false);
      await new Promise<void>(resolve => { setImmediate(resolve); });
      assert.ok(f.effects.includes("iterator-return"), "cooperative return must unblock a pending read");
      assert.ok(!f.effects.includes("result-close"), "result must remain live while read is admitted");
      assert.ok(!f.effects.includes("session-close"), "session must remain live while read is admitted");
      release(); await rejected;
      assert.deepEqual(f.effects, ["connect", "query", "next-start", "iterator-return", "next-settled", "result-close", "rollback", "session-close"]);
    } finally { release(); await rejected; await f.shell.dispose(); }
    assert.equal(f.effects.length, 8, "dispose cannot repeat owned cleanup");
  });
}

test("actual Shell sql2csv explicit query skips unsupported query-file encoding and missing FILE", async () => {
  const f = fixture(effects => ({
    columns: ["value"], rows: { async *[Symbol.asyncIterator]() { yield ["ok"]; } },
    async close() { effects.push("result-close"); }
  }));
  try {
    const result = await f.shell.exec("sql2csv /missing.sql -e nonexistent-codec --query 'SELECT 1'");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["value\nok\n", "", 0]);
    assert.deepEqual(f.effects, ["connect", "query", "result-close", "rollback", "session-close"]);
  } finally { await f.shell.dispose(); }
});

test("actual Shell sql2csv driver read failure survives iterator-close failure and releases database", async () => {
  const driverFailure = new Error("original driver read failure");
  const f = fixture(effects => ({
    columns: ["value"], rows: { [Symbol.asyncIterator]() { return {
      async next() { effects.push("next-failed"); throw driverFailure; },
      async return() { effects.push("iterator-return"); throw new Error("secondary iterator close failure"); }
    }; } },
    async close() { effects.push("result-close"); }
  }));
  try {
    const errors: unknown[] = [];
    const result = await f.shell.exec("sql2csv --query 'SELECT failed'", { onInternalError: error => { errors.push(error); } });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["value\n", "shell: line 1: internal error\n", 1]);
    assert.deepEqual(errors, [driverFailure]);
    assert.deepEqual(f.effects, ["connect", "query", "next-failed", "iterator-return", "result-close", "rollback", "session-close"]);
  } finally { await f.shell.dispose(); }
  assert.equal(f.effects.length, 7);
});
