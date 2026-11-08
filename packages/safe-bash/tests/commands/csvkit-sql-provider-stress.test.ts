import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseProvider } from "safe-bash-command-csvkit";
import { utf8Codec } from "safe-bash-command-csvkit";
import urlReference from "../../../../docs/csvkit/sql-url-reference.json" with { type: "json" };
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";

function fixture(assertOptions?: (engine: Readonly<Record<string, unknown>>, execution: Readonly<Record<string, unknown>>) => void) {
  const effects: unknown[] = [];
  let engine: Readonly<Record<string, unknown>>;
  const provider: DatabaseProvider = {
    profile: "in-memory-driver-stress", schemes: ["bound"],
    async connect(url, options, signal, invocation) {
      signal.throwIfAborted(); engine = options;
      effects.push(["connect", url, invocation?.cwd]);
      return {
        profile: "in-memory-driver-stress",
        async begin() { assert.fail("sql2csv must not begin an explicit import transaction"); },
        async commit() { assert.fail("sql2csv must not commit"); },
        async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); },
        async query(sql, values, options, signal) {
          signal.throwIfAborted(); assertOptions?.(engine, options);
          effects.push(["query", sql, values]);
          return {
            columns: ["duplicate", "duplicate", "", "value,quoted"],
            rows: (async function* () { yield [9223372036854775807n, null, "line\nbreak", new Uint8Array([0x61, 0x27])]; })(),
            async close() { effects.push("result-close"); }
          };
        }
      };
    }
  };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  return { shell, effects };
}

test("SQL provider actual Shell preserves URL bytes, duplicate labels, scalar identity and result order", async () => {
  const { shell, effects } = fixture();
  const url = "bound://user:p%40ss@allowed/db%2Fname?schema=a%2Bb&schema=c";
  try {
    const result = await shell.exec(`sql2csv --db ${quote(url)} --query ' SELECT ordered '`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: 'duplicate,duplicate,,"value,quoted"\n9223372036854775807,,"line\nbreak","b""a\'"""\n', stderr: "", status: 0
    });
    assert.deepEqual(effects, [["connect", url, "/"], ["query", "SELECT ordered", []], "result-close", "rollback", "session-close"]);
    await shell.dispose();
    assert.equal(effects.length, 5);
  } finally { await shell.dispose(); }
});

test("SQL literal ValueError fallback remains raw and executable expressions are never evaluated", async () => {
  const { shell, effects } = fixture((engine, execution) => {
    assert.equal(engine.path, "foo/bar"); assert.equal(execution.callback, "call()");
    assert.equal(execution.no_parameters, true); assert.equal(execution.stream_results, true);
  });
  try {
    const result = await shell.exec("sql2csv --db bound://owned --query 'SELECT ordered' --engine-option path foo/bar --execution-option callback 'call()'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(effects.length, 5);
  } finally { await shell.dispose(); }
});

test("SQL option names cannot mutate option object prototypes and last value wins", async () => {
  const { shell } = fixture((engine, execution) => {
    assert.equal(Object.getPrototypeOf(engine), null);
    assert.equal(Object.getPrototypeOf(execution), null);
    assert.equal(engine.__proto__, "owned"); assert.equal(engine.constructor, false);
    assert.equal(execution.stream_results, false);
  });
  try {
    const result = await shell.exec("sql2csv --db bound://owned --query 'SELECT ordered' --engine-option __proto__ \"'owned'\" --engine-option constructor True --engine-option constructor False --execution-option stream_results False");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("SQL malformed option literal rejects before acquiring an injected database", async () => {
  const { shell, effects } = fixture();
  try {
    const result = await shell.exec("sql2csv --db bound://owned --query 'SELECT ordered' --engine-option broken '['");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "SyntaxError: '[' was never closed (<unknown>, line 1)\n", status: 1
    });
    assert.deepEqual(effects, []);
  } finally { await shell.dispose(); }
});

test("SQL cancellation while result acquisition is pending waits for owned late result and session cleanup", async () => {
  const effects: string[] = [];
  let announce!: () => void;
  const queried = new Promise<void>(resolve => { announce = resolve; });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const caller = new AbortController();
  const reason = new Error("cancel pending driver result");
  const provider: DatabaseProvider = {
    profile: "in-memory-driver-stress", schemes: ["bound"], async connect() {
      effects.push("connect");
      return {
        profile: "in-memory-driver-stress", async begin() {}, async commit() {},
        async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); },
        async query() {
          announce(); await pending;
          return { columns: ["value"], rows: { [Symbol.asyncIterator]() { assert.fail("cancelled late result must not acquire row stream"); } },
            async close() { effects.push("result-close"); } };
        }
      };
    }
  };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  let settled = false;
  try {
    const execution = shell.exec("sql2csv --db bound://owned --query 'SELECT value'", { signal: caller.signal });
    const rejected = assert.rejects(execution, caught => caught === reason).then(() => { settled = true; });
    await queried; caller.abort(reason);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(settled, false);
    release(); await rejected;
    assert.deepEqual(effects, ["connect", "result-close", "rollback", "session-close"]);
    await shell.dispose();
    assert.deepEqual(effects, ["connect", "result-close", "rollback", "session-close"]);
  } finally { release(); await shell.dispose(); }
});

for (const item of urlReference.cli) {
  test(`SQL provider unavailable-driver actual Shell frozen diagnostic ${item.raw}`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(csvkitCommands(bindings));
    const before = await fs.readdir("/");
    try {
      const result = await shell.exec(`sql2csv --db ${quote(item.raw)} --query 'SELECT 1'`);
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      });
      assert.deepEqual(await fs.readdir("/"), before);
    } finally { await shell.dispose(); }
  });
}

test("SQL provider factory refuses a foreign scheme before endpoint authorization or connection", async () => {
  const { createDatabaseProvider } = await import("safe-bash-command-csvkit");
  const effects: string[] = [];
  const provider = createDatabaseProvider({ schemes: ["owned"], profile: "in-memory-driver-stress", transport: "network",
    async authorize() { effects.push("authorize"); return true; },
    async connect() { effects.push("connect"); assert.fail("foreign scheme must not acquire driver"); }
  });
  await assert.rejects(provider.connect("foreign://allowed/db", {}, new AbortController().signal));
  assert.deepEqual(effects, []);
});

test("SQL factory late acquisition cancellation closes session even when rollback fails", async () => {
  const { createDatabaseProvider } = await import("safe-bash-command-csvkit");
  const effects: string[] = [];
  const caller = new AbortController();
  const reason = new Error("cancel late driver session");
  const provider = createDatabaseProvider({ schemes: ["owned"], profile: "in-memory-driver-stress", transport: "network",
    async authorize(request) { assert.deepEqual(request.credentials, { username: null, password: null }); return true; },
    async connect() {
      caller.abort(reason);
      return { profile: "in-memory-driver-stress", async begin() {}, async commit() {},
        async query() { assert.fail("cancelled acquisition cannot execute SQL"); },
        async rollback() { effects.push("rollback"); throw new Error("driver rollback failed"); },
        async close() { effects.push("session-close"); }
      };
    }
  });
  await assert.rejects(provider.connect("owned://allowed/db", {}, caller.signal), caught => caught === reason);
  assert.deepEqual(effects, ["rollback", "session-close"]);
});

test("SQL factory actual Shell rejects unmapped execution options before driver query and cleans its owned session", async () => {
  const { createDatabaseProvider } = await import("safe-bash-command-csvkit");
  const effects: string[] = [];
  const provider = createDatabaseProvider({ schemes: ["owned"], profile: "in-memory-driver-stress", transport: "network",
    executionOptions: { stream_results: { target: "stream", convert: value => { assert.equal(value, true); return value; } } },
    async authorize() { effects.push("authorize"); return true; },
    async connect() {
      effects.push("connect");
      return { profile: "in-memory-driver-stress", async begin() {}, async commit() {},
        async query() { effects.push("query"); assert.fail("unmapped execution option cannot reach driver"); },
        async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); }
      };
    }
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    const result = await shell.exec("sql2csv --db owned://allowed/db --query 'SELECT value' --execution-option arbitrary_constructor True");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: unreviewed database execution option arbitrary_constructor\n", status: 78
    });
    assert.deepEqual(effects, ["authorize", "connect", "rollback", "session-close"]);
  } finally { await shell.dispose(); }
});

test("SQL execution-option SyntaxError occurs after connection acquisition and cleans the owned session", async () => {
  const { shell, effects } = fixture();
  try {
    const result = await shell.exec("sql2csv --db bound://owned --query 'SELECT ordered' --execution-option broken '['");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "SyntaxError: '[' was never closed (<unknown>, line 1)\n", status: 1
    });
    assert.deepEqual(effects, [["connect", "bound://owned", "/"], "rollback", "session-close"]);
  } finally { await shell.dispose(); }
});

test("SQL provider URL credentials form one identity without borrowing another configured identity password", async () => {
  const { createDatabaseProvider } = await import("safe-bash-command-csvkit");
  let authorized = false;
  const provider = createDatabaseProvider({ schemes: ["owned"], profile: "in-memory-driver-stress", transport: "network",
    credentials: { username: "configured", password: "configured-secret" },
    async authorize(request) { assert.deepEqual(request.credentials, { username: "url-user", password: null }); authorized = true; return false; },
    async connect() { assert.fail("denied identity cannot acquire a connection"); }
  });
  await assert.rejects(provider.connect("owned://url-user@allowed/db", {}, new AbortController().signal), /database endpoint authorization/);
  assert.equal(authorized, true);
});
