import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec, createSqlTransportProvider, type DatabaseProvider } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvsql returns its streamed iterator before closing the result or committing", async () => {
  const effects: string[] = [];
  let resultClosed = false;
  const provider: DatabaseProvider = {
    profile: "in-memory-network-lifecycle-stress", schemes: ["postgresql"],
    async connect() {
      effects.push("connect");
      return {
        profile: "in-memory-network-lifecycle-stress", dialect: "postgresql",
        async begin() { effects.push("begin"); },
        async commit() { effects.push("commit"); },
        async rollback() { effects.push("rollback"); },
        async close() { effects.push("session-close"); },
        async query() {
          effects.push("query");
          let emitted = false;
          return {
            columns: ["value"],
            rows: { [Symbol.asyncIterator]() { return {
              async next() {
                effects.push("next");
                if (emitted) return { done: true as const, value: undefined };
                emitted = true;
                return { done: false as const, value: ["owned"] };
              },
              async return() {
                effects.push("iterator-return");
                assert.equal(resultClosed, false, "result must remain open through iterator cleanup");
                return { done: true as const, value: undefined };
              }
            }; } },
            async close() { resultClosed = true; effects.push("result-close"); }
          };
        }
      };
    }
  };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const result = await shell.exec("csvsql -y 0 --db postgresql://owned --query 'SELECT value'");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "value\nowned\n", stderr: "", status: 0
    });
    assert.deepEqual(effects, ["connect", "begin", "query", "next", "next", "iterator-return", "result-close", "commit", "session-close"]);
    await shell.dispose();
    assert.equal(effects.length, 9);
  } finally { await shell.dispose(); }
});

test("csvsql iterator cleanup failure preserves streamed file bytes and rolls back before session close", async () => {
  const effects: string[] = [];
  const cleanupFailure = new Error("cooperative cursor return failed");
  const provider: DatabaseProvider = {
    profile: "in-memory-network-lifecycle-stress", schemes: ["postgresql"],
    async connect() {
      return {
        profile: "in-memory-network-lifecycle-stress", dialect: "postgresql",
        async begin() { effects.push("begin"); },
        async commit() { effects.push("commit"); },
        async rollback() { effects.push("rollback"); },
        async close() { effects.push("session-close"); },
        async query() {
          let emitted = false;
          return {
            columns: ["value"],
            rows: { [Symbol.asyncIterator]() { return {
              async next() {
                if (emitted) return { done: true as const, value: undefined };
                emitted = true;
                return { done: false as const, value: ["owned"] };
              },
              async return() { effects.push("iterator-return"); throw cleanupFailure; }
            }; } },
            async close() { effects.push("result-close"); }
          };
        }
      };
    }
  };
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const commandResult = await shell.exec("csvsql -y 0 --db postgresql://owned --query 'SELECT value' > /partial.csv");
    assert.deepEqual({ stdout: commandResult.stdout, stderr: commandResult.stderr, status: commandResult.exitCode }, {
      stdout: "", stderr: "shell: line 1: internal error\n", status: 1
    });
    assert.equal(new TextDecoder().decode(await fs.readFile("/partial.csv")), "value\nowned\n");
    assert.deepEqual(effects, ["begin", "iterator-return", "result-close", "rollback", "session-close"]);
    await shell.dispose();
    assert.equal(effects.length, 5);
  } finally { await shell.dispose(); }
});

for (const commitFails of [false, true]) {
  test(`csvsql late cancelled commit drains driver then ${commitFails ? "rolls back" : "preserves completed commit"}`, async () => {
    const effects: string[] = [];
    const controller = new AbortController();
    const reason = new Error("cancel pending commit");
    let announce!: () => void;
    const admitted = new Promise<void>(resolve => { announce = resolve; });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const provider: DatabaseProvider = {
      profile: "in-memory-network-lifecycle-stress", schemes: ["postgresql"],
      async connect() {
        return {
          profile: "in-memory-network-lifecycle-stress", dialect: "postgresql",
          async begin() { effects.push("begin"); },
          async commit() {
            effects.push("commit-start"); announce(); await pending;
            effects.push(commitFails ? "commit-failed" : "commit-complete");
            if (commitFails) throw new Error("driver commit failed");
          },
          async rollback() { effects.push("rollback"); },
          async close() { effects.push("session-close"); },
          async query() { return {
            columns: ["value"], rows: (async function* () { yield ["owned"]; })(),
            async close() { effects.push("result-close"); }
          }; }
        };
      }
    };
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
    let settled = false;
    const execution = shell.exec("csvsql -y 0 --db postgresql://owned --query 'SELECT value'", { signal: controller.signal });
    const rejected = assert.rejects(execution, error => error === reason).then(() => { settled = true; });
    try {
      await admitted; controller.abort(reason);
      await new Promise<void>(resolve => { setImmediate(resolve); });
      assert.equal(settled, false);
      assert.deepEqual(effects, ["begin", "result-close", "commit-start"]);
      release(); await rejected;
      assert.deepEqual(effects, ["begin", "result-close", "commit-start", ...(commitFails ? ["commit-failed", "rollback"] : ["commit-complete"]), "session-close"]);
      await shell.dispose();
      assert.equal(effects.length, commitFails ? 6 : 5);
    } finally { release(); await rejected; await shell.dispose(); }
  });
}

test("native PostgreSQL Shell refuses absent streaming capability before client acquisition", async () => {
  const effects: string[] = [];
  const provider = createSqlTransportProvider({ profile: "postgresql-pg-cursor-v1", authorize: async () => { effects.push("authorize"); return true; },
    driver: { acquire: async () => { effects.push("acquire"); return {}; }, release: async () => { effects.push("release"); } } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const result = await shell.exec("sql2csv --db postgresql://owned --query 'SELECT value'");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: PostgreSQL explicit server cursor binding\n", status: 78
    });
    assert.deepEqual(effects, ["authorize"]);
  } finally { await shell.dispose(); }
});

test("native mysql2 Shell refuses streaming without buffering a substitute and cleans its session", async () => {
  const effects: string[] = [];
  const provider = createSqlTransportProvider({ profile: "mysql-mysql2-v1", authorize: async () => true,
    executionOptions: { stream_results: { target: "stream_results", convert: value => value } },
    driver: { acquire: async () => ({ execute: async () => { assert.fail("missing streaming cannot silently buffer rows"); },
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { effects.push("rollback"); } }),
      release: async () => { effects.push("release"); } } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const result = await shell.exec("sql2csv --db mysql://owned --query 'SELECT value'");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: mysql2 explicit server cursor binding\n", status: 78
    });
    assert.deepEqual(effects, ["rollback", "release"]);
  } finally { await shell.dispose(); }
});

test("native Oracle Shell cancellation drains late client acquisition and preserves falsey abort reason", async () => {
  const effects: string[] = [];
  const controller = new AbortController();
  let announce!: () => void;
  const admitted = new Promise<void>(resolve => { announce = resolve; });
  let release!: () => void;
  const acquisition = new Promise<void>(resolve => { release = resolve; });
  const provider = createSqlTransportProvider({ profile: "oracle-oracledb-v1", authorize: async () => true,
    driver: {
      acquire: async () => { effects.push("acquire"); announce(); await acquisition; return {
        execute: async () => { assert.fail("late cancelled native client cannot query"); },
        commit: async () => {}, rollback: async () => { effects.push("rollback"); }
      }; },
      release: async () => { effects.push("release"); }
    } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  let settled = false;
  const execution = shell.exec("sql2csv --db oracle://owned --query 'SELECT value'", { signal: controller.signal });
  const rejected = assert.rejects(execution, error => error === 0).then(() => { settled = true; });
  try {
    await admitted; controller.abort(0);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    assert.deepEqual(effects, ["acquire"]);
    release(); await rejected;
    assert.deepEqual(effects, ["acquire", "rollback", "release"]);
    await shell.dispose(); assert.equal(effects.length, 3);
  } finally { release(); await rejected; await shell.dispose(); }
});

test("native mysql2 Shell scalar refusal preserves the header before cleanup", async () => {
  const effects: string[] = [];
  const provider = createSqlTransportProvider({ profile: "mysql-mysql2-v1", authorize: async () => true,
    executionOptions: { stream_results: { target: "stream_results", convert: value => value } },
    driver: { acquire: async () => ({ execute: async () => [[[new Date(0)]], [{ name: "stamp" }]],
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { effects.push("rollback"); } }),
      release: async () => { effects.push("release"); } } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const result = await shell.exec("sql2csv --db mysql://owned --query 'SELECT stamp' --execution-option stream_results False");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "stamp\n", stderr: "csvkit: unsupported or unqualified: native SQL result scalar codec\n", status: 78
    });
    assert.deepEqual(effects, ["rollback", "release"]);
  } finally { await shell.dispose(); }
});

test("native Oracle Shell exact temporal insert refuses absent scalar codec before execution", async () => {
  const effects: string[] = [];
  const provider = createSqlTransportProvider({ profile: "oracle-oracledb-v1", authorize: async () => true,
    driver: { acquire: async () => ({ execute: async () => { assert.fail("missing temporal codec cannot reach native execution"); },
      commit: async () => { effects.push("commit"); }, rollback: async () => { effects.push("rollback"); } }),
      release: async () => { effects.push("release"); } } });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const result = await shell.exec("csvsql -y 0 --db oracle://owned --insert --no-create", { stdin: "stamp\n2026-09-18\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: native SQL exact scalar binding codec\n", status: 78
    });
    assert.deepEqual(effects, ["rollback", "release"]);
  } finally { await shell.dispose(); }
});
