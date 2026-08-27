import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOutputOperation, FsError, readBytes, type CommandResult, type ByteSink,
} from "../../../../src/contracts/index.js";
import { ShellLimitError } from "../../../../src/shell/index.js";
import { bytes, deferred, discard, fixture, remainsPending, turn } from "./helpers.js";

for (const mode of ["caller", "rejection", "nonzero", "ordinary-throw"] as const) {
  test(`public precedence uses actual execution outcomes: ${mode}`, { timeout: 2000 }, async () => {
    const { shell, commands } = fixture();
    const caller = new AbortController();
    const reason = { code: "EPIPE", caller: true };
    const primary = new ShellLimitError("maxOutputBytes");
    const cleanup = new Error("cleanup failure");
    const draining = deferred();
    const gate = deferred();
    let cleaned = 0;
    commands.register({ name: "owned", execute(context) {
      const operation = createOutputOperation(context, context.stdout);
      operation.registerCleanup(async () => { draining.resolve(); await gate.promise; cleaned++; throw cleanup; });
      operation.registerCleanup(() => { cleaned++; });
      if (mode === "caller" || mode === "rejection") throw primary;
      if (mode === "ordinary-throw") throw new Error("ordinary failure");
      return { exitCode: 7 };
    } });
    const outcome = assert.rejects(shell.exec("owned", { signal: caller.signal }), error => error === (mode === "caller" ? reason : mode === "rejection" ? primary : cleanup));
    await draining.promise;
    if (mode === "caller") caller.abort(reason);
    await remainsPending(outcome);
    gate.resolve();
    await outcome;
    assert.equal(cleaned, 2);
    await shell.dispose();
  });
}

test("public result waits for a pending admitted acquisition after command return", { timeout: 2000 }, async () => {
  const { shell, commands } = fixture();
  const started = deferred();
  const resource = deferred<object>();
  const release = deferred();
  const releasing = deferred();
  let released = false;
  let acquisition!: Promise<void>;
  commands.register({ name: "owned", execute(context) {
    const operation = createOutputOperation(context, context.stdout);
    acquisition = assert.rejects(operation.acquire(() => { started.resolve(); return resource.promise; }, async () => {
      releasing.resolve(); await release.promise; released = true;
    }), /closed/);
    return { exitCode: 7 };
  } });
  const execution = shell.exec("owned");
  await started.promise;
  await remainsPending(execution);
  resource.resolve({});
  await releasing.promise;
  await remainsPending(execution);
  release.resolve();
  assert.equal((await execution).exitCode, 7);
  await acquisition;
  assert.equal(released, true);
  await shell.dispose();
});

test("opaque legacy command is not awaited, but registered cooperative output cleanup is", { timeout: 2000 }, async () => {
  const { shell, commands } = fixture();
  const caller = new AbortController();
  const entered = deferred();
  const gate = deferred();
  const reason = { cancellation: "exact" };
  let cleaned = false;
  commands.register({ name: "opaque", execute(context) {
    const operation = createOutputOperation(context, context.stdout);
    operation.registerCleanup(async () => { await gate.promise; cleaned = true; });
    entered.resolve();
    return new Promise<CommandResult>(() => {});
  } });
  const execution = assert.rejects(shell.exec("opaque", { signal: caller.signal }), error => error === reason);
  await entered.promise;
  caller.abort(reason);
  await remainsPending(execution);
  gate.resolve();
  await execution;
  assert.equal(cleaned, true);
  await shell.dispose();
});

test("external stdout closes only its child, preserving parent file and stderr effects", async () => {
  const { shell, commands, fs } = fixture();
  const consumer = new AbortController();
  const closed = new FsError("EPIPE");
  const output: number[] = [];
  let parentAborted = true;
  commands.register({ name: "mixed", async execute(context) {
    const parent = createOutputOperation(context, discard);
    const child = parent.child(context.stdout);
    await assert.rejects(child.output.write(bytes("x")), error => error === closed);
    parentAborted = parent.signal.aborted;
    await context.fs.writeFile("/required", bytes("file"), { signal: parent.signal });
    await context.stderr.write(bytes("stderr"));
    await parent.close();
    return { exitCode: 0 };
  } });
  const result = await shell.exec("mixed", { stdout: { async write() { assert.fail("must use accounted capability"); }, ownedOutput: {
    consumerClosed: consumer.signal,
    async write(chunk) { output.push(...chunk); consumer.abort(closed); throw closed; },
  } } });
  assert.equal(result.stdout, "x");
  assert.equal(result.stderr, "stderr");
  assert.deepEqual(output, [120]);
  assert.equal(parentAborted, false);
  assert.equal(new TextDecoder().decode(await fs.readFile("/required")), "file");
  await shell.dispose();
});

for (const enrolled of [false, true]) {
  test(`invoke/signal/budget/capture forwards accounted capability once: enrolled=${enrolled}`, async () => {
    const { shell, commands } = fixture({ limits: { maxOutputBytes: 2 } });
    let legacyWrites = 0;
    let ownedWrites = 0;
    const sink: ByteSink = { async write() { legacyWrites++; }, ownedOutput: {
      consumerClosed: new AbortController().signal, async write() { ownedWrites++; },
    } };
    commands.register({ name: "emit", async execute(context) {
      if (enrolled) {
        const operation = createOutputOperation(context, context.stdout);
        await operation.output.write(bytes("ab"));
        await operation.close();
      } else await context.stdout.write(bytes("ab"));
      return { exitCode: 0 };
    } });
    commands.register({ name: "forward", execute(context) {
      return context.invoke!("emit", [], { stdout: context.stdout });
    } });
    const result = await shell.exec("forward", { stdout: sink });
    assert.equal(result.stdout, "ab");
    assert.equal(result.exitCode, 0);
    assert.deepEqual([legacyWrites, ownedWrites], enrolled ? [0, 1] : [1, 0]);
    await assert.rejects(shell.exec("forward", { stdout: sink, limits: { maxOutputBytes: 1 } }), ShellLimitError);
    await shell.dispose();
  });
}

test("distinct pipeline stages and repeated writes still count separately", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "emit", async execute(context) {
    const operation = createOutputOperation(context, context.stdout);
    await operation.output.write(bytes("x"));
    await operation.close();
    return { exitCode: 0 };
  } });
  commands.register({ name: "relay", async execute(context) {
    const operation = createOutputOperation(context, context.stdout);
    for await (const chunk of readBytes(context.stdin, context.signal)) await operation.output.write(chunk);
    await operation.close();
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("emit | relay", { limits: { maxOutputBytes: 2 } })).stdout, "x");
  await assert.rejects(shell.exec("emit | relay", { limits: { maxOutputBytes: 1 } }), ShellLimitError);
  await assert.rejects(shell.exec("emit; emit", { limits: { maxOutputBytes: 1 } }), ShellLimitError);
  await shell.dispose();
});

for (const writes of [false, true]) test(`completed pipeline rejection survives finalization: prior owned write=${writes}`, async () => {
  const { shell, commands } = fixture();
  const primary = new ShellLimitError("maxCommands");
  const cleanup = new Error("cleanup");
  let cleaned = false;
  commands.register({ name: "fails", async execute(context) {
    const operation = createOutputOperation(context, context.stdout);
    operation.registerCleanup(() => { cleaned = true; throw cleanup; });
    if (writes) await operation.output.write(bytes("x"));
    throw primary;
  } });
  await assert.rejects(shell.exec("fails | cat"), error => error === primary);
  assert.equal(cleaned, true);
  await shell.dispose();
});

test("cat cancels file first-read and drains explicitly registered provider cleanup without whole-stage abort", { timeout: 2000 }, async () => {
  const { shell, commands, fs } = fixture({ limits: { pipeHighWaterMark: 1 } });
  const entered = deferred();
  const release = deferred();
  const cleaning = deferred();
  const providerClosed = deferred();
  let cleaned = false;
  let commandSignal!: AbortSignal;
  fs.readStream = (_path, options = {}) => (async function* () {
    try {
      entered.resolve();
      await new Promise<void>((_resolve, reject) => {
        options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
      });
      yield bytes("unreachable");
    } finally { cleaning.resolve(); await release.promise; cleaned = true; providerClosed.resolve(); }
  })();
  shell.use(async (context, next) => {
    if (context.command === "cat") {
      commandSignal = context.signal;
      context.registerCleanup!(() => providerClosed.promise);
    }
    return next();
  });
  commands.register({ name: "close-first", async execute() { await entered.promise; return { exitCode: 0 }; } });
  const execution = shell.exec("cat /remote | close-first");
  await cleaning.promise;
  await remainsPending(execution);
  release.resolve();
  assert.equal((await execution).exitCode, 0);
  assert.equal(cleaned, true);
  assert.equal(commandSignal.aborted, false);
  await shell.dispose();
});

test("cat preserves reused producer bytes and borrowed stdin sequential cursors", async () => {
  const { shell, fs } = fixture();
  fs.readStream = () => (async function* () {
    const chunk = Buffer.from("a\n");
    yield chunk; chunk[0] = 98; yield chunk; chunk.fill(0);
  })();
  assert.equal((await shell.exec("cat /reused | cat")).stdout, "a\nb\n");
  const stdin = (async function* () { yield bytes("a"); yield bytes("bc"); })();
  assert.equal((await shell.exec("head -c 1; cat", { stdin })).stdout, "abc");
  await turn();
  await shell.dispose();
});
