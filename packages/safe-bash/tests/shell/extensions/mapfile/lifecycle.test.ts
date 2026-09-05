import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { shellValueBytes, shellValueFromBytes, type ShellValue } from "../../../../src/contracts/value.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import type { RawRecord } from "../../../../src/shell/input.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function setup(args: readonly ShellValue[] = ["-t"]) {
  const controller = new AbortController();
  const cells = new Map<number, ShellValue>();
  const cleanups: (() => void | Promise<void>)[] = [];
  const records: RawRecord[] = [];
  const diagnostics: ShellValue[] = [];
  const callbacks: ShellValue[] = [];
  let reads = 0;
  let writerClosed = false;
  let inputClosed = false;
  const writer = {
    async set(index: number, value: ShellValue) { assert.equal(writerClosed, false); cells.set(index, value); },
    async close() { writerClosed = true; },
  };
  const input = {
    readiness(): never { throw new Error("mapfile must not use readiness polling"); },
    async read(): Promise<never> { throw new Error("line-reading API must not be used"); },
    async record(): Promise<RawRecord> {
      assert.equal(inputClosed, false);
      reads++;
      return records.shift() ?? { shellValue: "", reason: "eof", async release() {} };
    },
    async release() { inputClosed = true; },
  };
  const context: ShellExtensionContext = {
    command: "mapfile", args: [], argumentValues: args, status: 0, functionDepth: 0, sourceDepth: 0,
    stdin: { async *[Symbol.asyncIterator]() { yield* []; } },
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: controller.signal, scope: {},
    bindings: {
      describe: () => ({ kind: "unset", readonly: false, exported: false }),
      get: (ignoredName, index = 0) => cells.get(index),
      async assign() { throw new Error("scalar assignment must not be used"); },
      async prepare() { throw new Error("one-shot transaction must not be used"); },
      async openIndexed() { assert.equal(cleanups.length, 1); return writer; },
    },
    input: {
      observe() { throw new Error("Mapfile must not acquire a descriptor observer"); },
      validateOpen(descriptor) { assert.equal(cleanups.length, 1); assert.ok(Number.isSafeInteger(descriptor) && descriptor >= 0); },
      borrow() { assert.equal(cleanups.length, 1); return input; },
    },
    async evaluate(source) { callbacks.push(source); return 0; },
    variable: () => undefined,
    accountSource() {},
    async diagnostic(message) { diagnostics.push(message); },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  const execute = () => Promise.resolve(mapfileExtension().create().builtins[0]!.execute(context));
  return { context, controller, cells, cleanups, records, diagnostics, callbacks, writer, input, execute, reads: () => reads, closed: () => ({ writer: writerClosed, input: inputClosed }) };
}

test("descriptor options validate each open descriptor before acquiring only the final readable lease", async () => {
  const fixture = setup(["-u3", "-u0", "-tn1"]);
  const events: string[] = [];
  fixture.records.push({ shellValue: "one\n", reason: "delimiter", async release() {} });
  fixture.context.input.validateOpen = descriptor => { events.push(`validate:${descriptor}`); };
  fixture.context.bindings.openIndexed = async () => { events.push("writer"); return fixture.writer; };
  fixture.context.input.borrow = descriptor => { events.push(`borrow:${descriptor}`); return fixture.input; };
  assert.equal(await fixture.execute(), 0);
  assert.deepEqual(events, ["validate:3", "validate:0", "writer", "borrow:0"]);
  assert.deepEqual(Buffer.from(shellValueBytes(fixture.cells.get(0)!)), Buffer.from("one"));
});

test("later option errors do not acquire input or publish an array", async () => {
  const fixture = setup(["-u3", "-n-1"]);
  const validated: number[] = [];
  fixture.context.input.validateOpen = descriptor => { validated.push(descriptor); };
  fixture.context.input.borrow = () => { throw new Error("invalid options must not borrow input"); };
  fixture.context.bindings.openIndexed = async () => { throw new Error("invalid options must not publish an array"); };
  assert.equal(await fixture.execute(), 1);
  assert.deepEqual(validated, [3]);
  assert.deepEqual(fixture.diagnostics, ["mapfile: -1: invalid line count"]);
});

test("an open unreadable descriptor clears the admitted array and returns read-stage success", async () => {
  const fixture = setup(["-u3"]);
  const events: string[] = [];
  fixture.cells.set(0, "old");
  fixture.context.input.validateOpen = descriptor => { events.push(`validate:${descriptor}`); };
  fixture.context.bindings.openIndexed = async (name, options) => {
    assert.equal(name, "MAPFILE"); assert.equal(options?.clear, true);
    events.push("writer"); fixture.cells.clear(); return fixture.writer;
  };
  fixture.context.input.borrow = descriptor => { events.push(`borrow:${descriptor}`); throw new FsError("EBADF"); };
  assert.equal(await fixture.execute(), 0);
  assert.deepEqual(events, ["validate:3", "writer", "borrow:3"]);
  assert.equal(fixture.cells.size, 0);
  assert.equal(fixture.reads(), 0);
  assert.deepEqual(fixture.diagnostics, []);
  assert.deepEqual(fixture.closed(), { writer: true, input: false });
});

test("a closed intermediate descriptor fails before later options and array admission", async () => {
  const fixture = setup(["-u9", "-u0"]);
  const validated: number[] = [];
  fixture.context.input.validateOpen = descriptor => { validated.push(descriptor); throw new FsError("EBADF"); };
  fixture.context.input.borrow = () => { throw new Error("closed descriptor must fail before borrowing"); };
  fixture.context.bindings.openIndexed = async () => { throw new Error("closed descriptor must fail before publication"); };
  assert.equal(await fixture.execute(), 1);
  assert.deepEqual(validated, [9]);
  assert.deepEqual(fixture.diagnostics, ["mapfile: 9: invalid file descriptor: Bad file descriptor"]);
});

test("direct mapfile owns preparation, binary records and finite consumption", async () => {
  const fixture = setup(["-t", "-n2"]);
  let releases = 0;
  fixture.records.push(
    { shellValue: shellValueFromBytes(Uint8Array.of(255, 10)), reason: "delimiter", async release() { releases++; } },
    { shellValue: "tail\n", reason: "delimiter", async release() { releases++; } },
    { shellValue: "unread\n", reason: "delimiter", async release() { throw new Error("unread record must not be acquired"); } },
  );
  assert.equal(await fixture.execute(), 0);
  assert.equal(fixture.reads(), 2);
  assert.equal(releases, 2);
  assert.deepEqual(Buffer.from(shellValueBytes(fixture.cells.get(0)!)), Buffer.from([255]));
  assert.deepEqual(Buffer.from(shellValueBytes(fixture.cells.get(1)!)), Buffer.from("tail"));
  assert.deepEqual(fixture.closed(), { writer: true, input: true });
  await fixture.cleanups[0]!();
  assert.equal(releases, 2);
});

test("callback quoting preserves raw bytes and runs before assignment", async () => {
  const fixture = setup(["-C", "callback", "-c1", "-t"]);
  fixture.records.push({ shellValue: shellValueFromBytes(Uint8Array.of(255, 39, 36, 40, 41, 10)), reason: "delimiter", async release() {} });
  fixture.context.evaluate = async source => {
    assert.equal(fixture.cells.size, 0);
    assert.deepEqual(Buffer.from(shellValueBytes(source)), Buffer.concat([Buffer.from("callback 0 '"), Buffer.from([255]), Buffer.from("'\\''$()'")]));
    return 127;
  };
  assert.equal(await fixture.execute(), 0);
  assert.deepEqual(Buffer.from(shellValueBytes(fixture.cells.get(0)!)), Buffer.from([255, 39, 36, 40, 41]));
});

for (const reason of [false, 0, "", null]) test(`cancelled late writer admission is drained: ${String(reason)}`, async () => {
  const fixture = setup();
  const entered = deferred<void>();
  const gate = deferred<void>();
  fixture.context.bindings.openIndexed = async () => { entered.resolve(); await gate.promise; return fixture.writer; };
  let settled = false;
  const pending = fixture.execute();
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(pending, error => Object.is(error, reason));
  await entered.promise;
  fixture.controller.abort(reason);
  const closing = fixture.cleanups[0]!();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(fixture.reads(), 0);
  gate.resolve();
  await rejected;
  await closing;
  assert.equal(fixture.closed().writer, true);
});

test("close releases borrowed input before waiting for its pending record", async () => {
  const fixture = setup();
  const entered = deferred<void>();
  const gate = deferred<RawRecord>();
  let released = false;
  fixture.input.record = async () => { entered.resolve(); return gate.promise; };
  fixture.input.release = async () => { gate.resolve({ shellValue: "late", reason: "eof", async release() { released = true; } }); };
  const pending = fixture.execute();
  const rejected = assert.rejects(pending, /Mapfile invocation is closed/u);
  await entered.promise;
  await fixture.cleanups[0]!();
  await rejected;
  assert.equal(released, true);
  assert.equal(fixture.cells.size, 0);
});

for (const reason of [false, 0, "", null]) test(`pending assignment drains before cancellation settles: ${String(reason)}`, async () => {
  const fixture = setup();
  const entered = deferred<void>();
  const gate = deferred<void>();
  let finished = false;
  fixture.records.push({ shellValue: "one\n", reason: "delimiter", async release() {} });
  fixture.writer.set = async (index, value) => { entered.resolve(); await gate.promise; fixture.cells.set(index, value); finished = true; };
  fixture.writer.close = async () => { await gate.promise; };
  let settled = false;
  const pending = fixture.execute();
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(pending, error => Object.is(error, reason));
  await entered.promise;
  fixture.controller.abort(reason);
  const closing = fixture.cleanups[0]!();
  await Promise.resolve();
  assert.equal(settled, false);
  gate.resolve();
  await rejected;
  await closing;
  assert.equal(finished, true);
  assert.equal(fixture.cells.size, 1);
});

for (const reason of [false, 0, "", null]) test(`primary falsey record release failure survives cleanup: ${String(reason)}`, async () => {
  const fixture = setup();
  fixture.records.push({ shellValue: "one\n", reason: "delimiter", async release() { throw reason; } });
  fixture.writer.close = async () => { throw new Error("secondary writer cleanup"); };
  await assert.rejects(fixture.execute(), error => Object.is(error, reason));
  assert.equal(fixture.cells.size, 1);
});

test("default quantum calls back at 5000, not at EOF or skipped records", async () => {
  const fixture = setup(["-C", "callback", "-s2", "-t"]);
  for (let index = 0; index < 5003; index++) fixture.records.push({ shellValue: "x\n", reason: "delimiter", async release() {} });
  assert.equal(await fixture.execute(), 0);
  assert.equal(fixture.cells.size, 5001);
  assert.equal(fixture.callbacks.length, 1);
  assert.deepEqual(Buffer.from(shellValueBytes(fixture.callbacks[0]!)), Buffer.from("callback 4999 'x'"));
});

test("many short skipped records yield across record boundaries", async () => {
  const fixture = setup(["-s512"]);
  for (let index = 0; index < 512; index++) fixture.records.push({ shellValue: "\n", reason: "delimiter", async release() {} });
  const handle = setImmediate(() => fixture.controller.abort(false));
  try { await assert.rejects(fixture.execute(), error => error === false); }
  finally { clearImmediate(handle); }
  assert.ok(fixture.reads() < 512);
});
