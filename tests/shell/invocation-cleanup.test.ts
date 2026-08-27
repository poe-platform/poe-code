import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext, CommandResult } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("cleanup is registered before acquisition and delays normal public settlement", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const started = deferred();
  const release = deferred();
  let acquired = false;
  let cleaned = false;
  let settled = false;
  commands.register({ name: "owned", execute(context) {
    assert.equal(typeof context.registerCleanup, "function");
    context.registerCleanup!(async () => { assert.equal(acquired, true); started.resolve(); await release.promise; cleaned = true; });
    acquired = true;
    return { exitCode: 7 };
  } });
  const execution = shell.exec("owned").finally(() => { settled = true; });
  await Promise.race([started.promise, execution]);
  assert.equal(acquired, true);
  await turn();
  assert.equal(settled, false);
  release.resolve();
  assert.equal((await execution).exitCode, 7);
  assert.equal(cleaned, true);
  await shell.dispose();
});

test("caller cancellation drains middleware hooks without waiting opaque next", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const reason = { code: "EPIPE", caller: true };
  let cleaned = false;
  let settled = false;
  shell.use(async (context) => {
    context.registerCleanup?.(async () => { await release.promise; cleaned = true; });
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  });
  const execution = shell.exec("true", { signal: controller.signal }).then(
    () => { settled = true; assert.fail("expected abort"); },
    (error: unknown) => { settled = true; assert.equal(error, reason); },
  );
  await entered.promise;
  controller.abort(reason);
  await turn();
  assert.equal(settled, false);
  release.resolve();
  await execution;
  assert.equal(cleaned, true);
  await shell.dispose();
});

test("normal completion seals saved registration and invoke before input acquisition", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let saved!: CommandContext;
  let acquisitions = 0;
  commands.register({ name: "save", execute(context) { saved = context; return { exitCode: 0 }; } });
  await shell.exec("save");
  assert.equal(saved.signal.aborted, false);
  assert.throws(() => saved.registerCleanup!(() => {}), Error);
  await assert.rejects(saved.invoke!("pass", [], { stdin: { [Symbol.asyncIterator]() {
    acquisitions++;
    return { async next() { return { done: true, value: undefined }; } };
  } } }));
  assert.equal(acquisitions, 0);
  await shell.dispose();
});

test("all cleanup failures survive undefined and null without hiding nonzero results", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const calls: number[] = [];
  commands.register({ name: "fail-cleanup", execute(context) {
    context.registerCleanup?.(() => { calls.push(1); throw undefined; });
    context.registerCleanup?.(async () => { calls.push(2); throw null; });
    context.registerCleanup?.(() => { calls.push(3); });
    return { exitCode: 4 };
  } });
  await assert.rejects(shell.exec("fail-cleanup"), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [undefined, null]);
    return true;
  });
  assert.deepEqual(calls, [1, 2, 3]);
  await shell.dispose();
});

test("dispose closes admissions and shares the active cleanup barrier before plugins", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const entered = deferred();
  const release = deferred();
  let callbacks = 0;
  const events: string[] = [];
  shell.use({ name: "owner", setup() {}, dispose() { events.push("plugin"); } });
  commands.register({ name: "wait", async execute(context) {
    context.registerCleanup?.(async () => { callbacks++; await release.promise; events.push("cleanup"); });
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  const execution = shell.exec("wait").catch(() => { events.push("exec"); });
  await entered.promise;
  let firstDone = false;
  let secondDone = false;
  const first = shell.dispose().then(() => { firstDone = true; });
  const second = shell.dispose().then(() => { secondDone = true; });
  await turn();
  assert.equal(firstDone, false);
  assert.equal(secondDone, false);
  await assert.rejects(shell.exec("true"), /disposed/);
  release.resolve();
  await Promise.all([execution, first, second]);
  assert.equal(callbacks, 1);
  assert.ok(events.indexOf("cleanup") < events.indexOf("plugin"));
});
