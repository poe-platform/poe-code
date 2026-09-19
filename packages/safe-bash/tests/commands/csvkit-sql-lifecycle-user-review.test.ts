import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec, type DatabaseProvider } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("SQL caller cancellation waits for cooperative pending row return before releasing result and session", async () => {
  const effects: string[] = [];
  let announce!: () => void;
  const admitted = new Promise<void>(resolve => { announce = resolve; });
  let releaseRead!: () => void;
  const reading = new Promise<IteratorResult<readonly string[]>>(resolve => { releaseRead = () => resolve({ done: true, value: undefined }); });
  let releaseReturn!: () => void;
  const returning = new Promise<void>(resolve => { releaseReturn = resolve; });
  let announceReturn!: () => void;
  const returnAdmitted = new Promise<void>(resolve => { announceReturn = resolve; });
  const controller = new AbortController();
  const reason = new Error("user cancelled pending SQL row");
  const provider: DatabaseProvider = {
    profile: "in-memory-lifecycle-review", schemes: ["review"], async connect() {
      return {
        profile: "in-memory-lifecycle-review", async begin() {}, async commit() {},
        async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); },
        async query() {
          return { columns: ["value"], rows: { [Symbol.asyncIterator]() {
            return {
              next() { effects.push("next"); announce(); return reading; },
              async return() {
                effects.push("return-start"); announceReturn(); releaseRead();
                await returning; effects.push("return-end");
                return { done: true as const, value: undefined };
              }
            };
          } }, async close() { effects.push("result-close"); } };
        }
      };
    }
  };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  let settled = false;
  const execution = shell.exec("sql2csv --db review://owned --query 'SELECT value'", { signal: controller.signal });
  const rejected = assert.rejects(execution, caught => caught === reason).then(() => { settled = true; });
  try {
    await admitted; controller.abort(reason); await returnAdmitted;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false, "public cancellation must await owned row cleanup");
    assert.deepEqual(effects, ["next", "return-start"]);
    releaseReturn(); await rejected;
    assert.deepEqual(effects, ["next", "return-start", "return-end", "result-close", "rollback", "session-close"]);
    await shell.dispose();
    assert.equal(effects.length, 6, "dispose must not return or close already released resources twice");
  } finally { releaseRead(); releaseReturn(); await rejected; await shell.dispose(); }
});

test("SQL successful output followed by result cleanup failure still rolls back and closes its session", async () => {
  const effects: string[] = [];
  const provider: DatabaseProvider = {
    profile: "in-memory-lifecycle-review", schemes: ["review"], async connect() {
      return {
        profile: "in-memory-lifecycle-review", async begin() {}, async commit() {},
        async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); },
        async query() { return {
          columns: ["value"], rows: (async function* () { yield ["owned"]; })(),
          async close() { effects.push("result-close"); throw new Error("result close failed"); }
        }; }
      };
    }
  };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...bindings, databases: [provider] }));
  try {
    // A trusted host cleanup failure escapes Shell.exec; it must never become
    // a successful command status just because all rows were already written.
    await assert.rejects(shell.exec("sql2csv --db review://owned --query 'SELECT value'"), caught => {
      assert.ok(caught instanceof AggregateError);
      const messages = (error: unknown): string[] => error instanceof AggregateError
        ? [error.message, ...error.errors.flatMap(messages)]
        : error instanceof Error ? [error.message] : [];
      assert.ok(messages(caught).includes("result close failed"));
      return true;
    });
    assert.deepEqual(effects, ["result-close", "rollback", "session-close"]);
  } finally { await shell.dispose(); }
});
