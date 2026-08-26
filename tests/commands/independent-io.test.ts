import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { createStandardCommands } from "../../src/commands/index.js";
import { toByteSource, type ByteSink, type ByteSource, type CommandContext } from "../../src/contracts/index.js";
import { fixture } from "./helpers.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function context(command: string, args: readonly string[] = []): Promise<CommandContext> {
  return { command, args, fs: await fixture(), cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
}

const commands = createStandardCommands();
const execute = (context: CommandContext) => Promise.resolve(commands.find(command => command.name === context.command)!.execute(context));

test("every first-family command rejects pre-aborted work before side effects", async () => {
  const reason = new Error("pre-aborted command");
  for (const command of commands) {
    const base = await context(command.name);
    let effects = 0;
    const sink: ByteSink = { async write() { effects++; } };
    await assert.rejects(execute({ ...base, signal: AbortSignal.abort(reason), stdout: sink, stderr: sink }), error => error === reason);
    assert.equal(effects, 0, command.name);
    assert.deepEqual(await base.fs.readdir("/work"), [], command.name);
  }
});

for (const [command, args] of [
  ["cat", []], ["head", []], ["tail", []], ["wc", []], ["sort", []],
  ["uniq", []], ["cut", ["-b", "1"]], ["grep", ["hit"]], ["tee", []],
  ["tr", ["a", "b"]], ["xargs", []],
] as const) {
  test(`${command} cancels blocked stdin and observes a late producer rejection`, async () => {
    const controller = new AbortController();
    const ready = deferred<void>();
    const next = deferred<IteratorResult<Uint8Array>>();
    let returned = 0;
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      next() { ready.resolve(); return next.promise; },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
    const reason = new Error("cancel blocked producer");
    const running = execute({ ...await context(command, args), stdin: source, signal: controller.signal });
    const observed = running.then(() => "resolved", error => error === reason ? "cancelled" : String(error));
    await ready.promise;
    controller.abort(reason);
    const outcome = await Promise.race([observed, delay(100).then(() => "timeout")]);
    next.reject(new Error("late producer rejection"));
    await running.catch(() => {});
    await setImmediate();
    assert.equal(outcome, "cancelled");
    assert.equal(returned, 1);
  });
}

for (const [command, args, stdin, stream] of [
  ["echo", ["hello"], "", "stdout"], ["cat", [], "hello", "stdout"],
  ["grep", ["hit"], "hit\n", "stdout"], ["printf", ["%d", "invalid"], "", "stderr"],
  ["xargs", ["-t", "echo"], "hello", "stderr"],
] as const) {
  test(`${command} cancels blocked ${stream} and observes a late sink rejection`, async () => {
    const controller = new AbortController();
    const ready = deferred<void>();
    const write = deferred<void>();
    const sink: ByteSink = { write() { ready.resolve(); return write.promise; } };
    const reason = new Error("cancel blocked sink");
    const running = execute({ ...await context(command, args), stdin: toByteSource(stdin), signal: controller.signal, [stream]: sink });
    const observed = running.then(() => "resolved", error => error === reason ? "cancelled" : String(error));
    await ready.promise;
    controller.abort(reason);
    const outcome = await Promise.race([observed, delay(100).then(() => "timeout")]);
    write.reject(new Error("late sink rejection"));
    await running.catch(() => {});
    await setImmediate();
    assert.equal(outcome, "cancelled");
  });
}

test("cat awaits each sink write before pulling a mutable producer again", async () => {
  const gate = deferred<void>();
  const ready = deferred<void>();
  let pulled = 0;
  const actual: Uint8Array[] = [];
  const source = (async function* () {
    const scratch = new Uint8Array(256);
    for (let value = 0; value < 32; value++) { scratch.fill(value); pulled++; yield scratch; }
  })();
  const running = execute({ ...await context("cat"), stdin: source, stdout: { async write(bytes) {
    if (actual.length === 0) { ready.resolve(); await gate.promise; }
    actual.push(bytes.slice());
  } } });
  await ready.promise;
  await setImmediate();
  assert.equal(pulled, 1);
  gate.resolve();
  assert.equal((await running).exitCode, 0);
  assert.equal(actual.length, 32);
  actual.forEach((bytes, value) => assert(bytes.every(byte => byte === value)));
});

test("head closes an early producer without pulling an extra chunk", async () => {
  let pulled = 0;
  let returned = false;
  const source = (async function* () {
    try { for (let count = 0; count < 10; count++) { pulled++; yield Uint8Array.of(65, 10); } }
    finally { returned = true; }
  })();
  const result = await execute({ ...await context("head", ["-n", "1"]), stdin: source });
  assert.equal(result.exitCode, 0);
  assert.equal(pulled, 1);
  assert.equal(returned, true);
});

test("producer and sink failures return failure statuses without dangling rejections", async () => {
  const base = await context("cat");
  const source = (async function* () { yield Uint8Array.of(1); throw new Error("broken producer"); })();
  assert.equal((await execute({ ...base, stdin: source })).exitCode, 1);
  assert.equal((await execute({ ...base, stdin: toByteSource("hello"), stdout: { async write() { throw new Error("broken sink"); } } })).exitCode, 1);
  await setImmediate();
});
