import assert from "node:assert/strict";
import test from "node:test";
import type { ShellExtensionContext, ShellInputBorrow } from "../../../../src/shell/extensions.js";
import type { ReadLine } from "../../../../src/shell/input.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { shellValueBytes, shellValueFromBytes, shellValueText, type ShellValue } from "../../../../src/contracts/value.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(input: Pick<ShellInputBorrow, "read" | "release">, args: readonly ShellValue[] = []) {
  const controller = new AbortController();
  const cleanups: (() => void | Promise<void>)[] = [];
  const assignments: string[] = [];
  const diagnostics: ShellValue[] = [];
  const context: ShellExtensionContext = {
    command: "read", args: args.map(shellValueText), argumentValues: args, status: 0, functionDepth: 0, sourceDepth: 0,
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
    stdout: { write: async () => undefined }, stderr: { write: async () => undefined },
    scope: {}, signal: controller.signal,
    bindings: {
      describe: () => ({ kind: "unset", readonly: false, exported: false }),
      get: () => undefined,
      assign: async name => { assignments.push(name); },
      prepareReference: async () => { throw new Error("Unexpected reference binding"); },
      prepare: async () => { throw new Error("Unexpected array preparation"); },
      openIndexed: async () => { throw new Error("Unexpected incremental indexed admission"); },
    },
    input: { observe() { throw new Error("Unexpected descriptor observation"); }, validateOpen() { throw new Error("Unexpected descriptor validation"); }, borrow() {
      assert.equal(cleanups.length, 1);
      return { ...input, record: async () => { throw new Error("Unexpected raw record read"); }, readiness: () => { throw new Error("Unexpected readiness query"); } };
    } },
    evaluate: async () => { throw new Error("Unexpected evaluate"); },
    variable: () => undefined,
    accountSource: () => undefined,
    diagnostic: async message => { diagnostics.push(message); },
    registerCleanup: cleanup => { cleanups.push(cleanup); },
  };
  const execute = () => Promise.resolve(readExtension().create().builtins[0]!.execute(context));
  return { context, controller, cleanups, assignments, diagnostics, execute };
}

function record(release: () => Promise<void>): ReadLine {
  return { value: "one", shellValue: "one", escaped: new Set(), escapedByteOffsets: [], terminated: true, reason: "delimiter", fields: async () => [{ start: 0, end: 3, value: "one" }], release };
}

for (const reason of [undefined, false, 0, "", { readStatus: 1 }]) {
  test(`primary read failure preserves ${String(reason)} through rejecting release`, async () => {
    let releases = 0;
    const testCase = harness({ read: async () => { throw reason; }, release: async () => { releases++; throw new Error("secondary close"); } });
    let observed: { reason: unknown } | undefined;
    try { await testCase.execute(); } catch (error) { observed = { reason: error }; }
    assert.ok(observed);
    assert.equal(observed.reason, reason);
    assert.equal(releases, 1);
    await assert.rejects(Promise.resolve(testCase.cleanups[0]!()), /secondary close/u);
    assert.equal(releases, 1);
    assert.deepEqual(testCase.assignments, []);
  });
}

test("close blocks assignment, drains late read acquisition, and releases record once", async () => {
  const pending = deferred<ReadLine>();
  const admitted = deferred<void>();
  let recordsReleased = 0;
  let inputsReleased = 0;
  const testCase = harness({
    read() { admitted.resolve(); return pending.promise; },
    release: async () => { inputsReleased++; },
  });
  const execution = testCase.execute();
  const rejection = assert.rejects(execution, /Read invocation is closed/u);
  await admitted.promise;
  let closed = false;
  const cleanup = Promise.resolve(testCase.cleanups[0]!()).then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(inputsReleased, 0);
  pending.resolve(record(async () => { recordsReleased++; }));
  await rejection;
  await cleanup;
  await testCase.cleanups[0]!();
  assert.equal(recordsReleased, 1);
  assert.equal(inputsReleased, 1);
  assert.deepEqual(testCase.assignments, []);
});

test("root falsey cancellation wins while cooperative resource release drains", async () => {
  const closing = deferred<void>();
  const pending = deferred<void>();
  const testCase = harness({
    read: async () => record(async () => undefined),
    release() { closing.resolve(); return pending.promise; },
  });
  const execution = testCase.execute();
  let settled = false;
  const observed = execution.then(() => ({ success: true }), reason => ({ reason })).finally(() => { settled = true; });
  await closing.promise;
  testCase.controller.abort(false);
  await Promise.resolve();
  assert.equal(settled, false);
  pending.reject(new Error("secondary close"));
  const outcome = await observed;
  assert.ok("reason" in outcome);
  assert.equal(outcome.reason, false);
});

test("failed diagnostic retains exact failure rather than returning a diagnosed status", async () => {
  const testCase = harness({ read: async () => { throw new Error("Must not read"); }, release: async () => undefined }, ["-Q"]);
  const context: ShellExtensionContext = { ...testCase.context, diagnostic: async () => { throw false; } };
  let observed: { reason: unknown } | undefined;
  try { await readExtension().create().builtins[0]!.execute(context); } catch (reason) { observed = { reason }; }
  assert.ok(observed);
  assert.equal(observed.reason, false);
});

test("synchronous cleanup registration closes admission without a TDZ or input acquisition", async () => {
  const testCase = harness({ read: async () => { throw new Error("Must not read"); }, release: async () => undefined });
  let completion: void | Promise<void> = undefined;
  let acquisitions = 0;
  const context: ShellExtensionContext = {
    ...testCase.context,
    registerCleanup(cleanup) { completion = cleanup(); },
    input: { observe() { throw new Error("Must not observe"); }, validateOpen() { throw new Error("Must not validate"); }, borrow() { acquisitions++; throw new Error("Must not acquire"); } },
  };
  await assert.rejects(Promise.resolve(readExtension().create().builtins[0]!.execute(context)), /Read invocation is closed/u);
  await completion;
  assert.equal(acquisitions, 0);
});

test("raw diagnostic failure retains bytes and primary falsey reason without premature input acquisition", async () => {
  const events: string[] = [];
  let releases = 0;
  let diagnostic: ShellValue | undefined;
  const subject = harness({
    read: async () => { throw new Error("Must not consume invalid option input"); },
    release: async () => { releases++; },
  }, ["-u0", "-t", shellValueFromBytes(Uint8Array.of(255))]);
  const context: ShellExtensionContext = { ...subject.context,
    input: {
      observe() { throw new Error("Must not observe invalid option input"); },
      validateOpen(descriptor) { assert.equal(descriptor, 0); assert.equal(subject.cleanups.length, 1); events.push("validate:0"); },
      borrow() { events.push("borrow"); throw new Error("Must not acquire invalid option input"); },
    },
    diagnostic: async value => { events.push("diagnostic"); diagnostic = value; throw false; },
  };
  const execution = Promise.resolve(readExtension().create().builtins[0]!.execute(context));
  await assert.rejects(execution, reason => reason === false);
  await subject.cleanups[0]!();
  assert.ok(diagnostic !== undefined);
  assert.deepEqual(shellValueBytes(diagnostic), new Uint8Array([...Buffer.from("read: "), 255, ...Buffer.from(": invalid timeout specification")]));
  assert.deepEqual(subject.assignments, []);
  assert.deepEqual(events, ["validate:0", "diagnostic"]);
  assert.equal(releases, 0);
});

test("post-acquisition raw diagnostic failure drains admitted record and input before rejecting", async () => {
  const closing = deferred<void>();
  const release = deferred<void>();
  const secondary = new Error("secondary input release");
  let releases = 0;
  let recordsReleased = 0;
  let diagnostic: ShellValue | undefined;
  const subject = harness({
    read: async () => record(async () => { recordsReleased++; }),
    release() { releases++; closing.resolve(); return release.promise; },
  }, ["-a", shellValueFromBytes(Uint8Array.of(255))]);
  const context: ShellExtensionContext = { ...subject.context, diagnostic: async value => { diagnostic = value; throw false; } };
  let settled = false;
  const execution = Promise.resolve(readExtension().create().builtins[0]!.execute(context));
  const rejection = assert.rejects(execution, reason => reason === false).finally(() => { settled = true; });
  try {
    await closing.promise;
    assert.equal(settled, false);
    assert.ok(diagnostic !== undefined);
    assert.deepEqual(shellValueBytes(diagnostic), new Uint8Array([...Buffer.from("read: `"), 255, ...Buffer.from("': not a valid identifier")]));
    assert.deepEqual(subject.assignments, []);
    assert.equal(recordsReleased, 1);
  } finally {
    release.reject(secondary);
    await rejection;
    await assert.rejects(Promise.resolve(subject.cleanups[0]!()), reason => reason === secondary);
  }
  assert.equal(releases, 1);
  assert.equal(recordsReleased, 1);
});
