import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, Shell, createAgentCommands, createMemoryFileSystem, type CommandContext, type CommandInvokeOptions, type PluginHost } from "../../../src/index.js";
import {
  createTimeoutCommand,
  createTimeoutCommands,
  timeoutCommands,
  type TimeoutCommandOptions,
  type TimeoutCommandsOptions,
} from "../../../src/commands/timeout/index.js";
import { ManualScheduler, bytes, captureContext, gate, immediateInvoker, turn } from "./fixtures.js";

const help = "Usage: timeout [OPTION] DURATION COMMAND [ARG]...\nRun a virtual-bash command with a cooperative time limit.\n";

test("factory surface validates containers and exact property order", () => {
  for (const value of [null, true, 1, 1n, "x", Symbol("x"), () => {}, []]) {
    assert.throws(() => createTimeoutCommand(value as never), TypeError);
  }
  const reads: string[] = [];
  const scheduler = new Proxy({}, {
    get(_target, key) {
      reads.push(`scheduler.${String(key)}`);
      return () => 0;
    },
  });
  const options = new Proxy({}, {
    get(_target, key) {
      reads.push(`options.${String(key)}`);
      if (key === "invoke") return undefined;
      if (key === "scheduler") return scheduler;
      if (key === "maxTimerMilliseconds") return 9;
      if (key === "replace") return false;
      return undefined;
    },
  });
  createTimeoutCommands(options);
  assert.deepEqual(reads, [
    "options.invoke",
    "options.scheduler",
    "scheduler.now",
    "scheduler.setTimeout",
    "scheduler.clearTimeout",
    "options.maxTimerMilliseconds",
    "options.replace",
  ]);
  assert.throws(() => createTimeoutCommand({ invoke: 1 } as never), TypeError);
  assert.throws(() => createTimeoutCommand({ scheduler: {} } as never), TypeError);
  assert.throws(() => createTimeoutCommand({ maxTimerMilliseconds: "1" } as never), TypeError);
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648]) {
    assert.throws(() => createTimeoutCommand({ maxTimerMilliseconds: value }), RangeError);
  }
  assert.throws(() => createTimeoutCommands({ replace: 1 } as never), TypeError);
});

test("factories accept explicit undefined, snapshot providers, and return fresh frozen values", async () => {
  const firstScheduler = new ManualScheduler();
  const secondScheduler = new ManualScheduler();
  const options: TimeoutCommandsOptions = {
    invoke: undefined,
    scheduler: firstScheduler,
    maxTimerMilliseconds: undefined,
    replace: undefined,
  };
  const first = createTimeoutCommands(options);
  const second = createTimeoutCommands(options);
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first[0]));
  const mutable = options as { scheduler?: ManualScheduler };
  mutable.scheduler = secondScheduler;
  const capture = captureContext(["1", "child"], { invoke: immediateInvoker() });
  await first[0]!.execute(capture.context);
  assert.equal(firstScheduler.setCalls.length, 1);
  assert.equal(secondScheduler.setCalls.length, 0);
  assert.ok(firstScheduler.receivers.every(value => value === firstScheduler));
  const commandOptions: TimeoutCommandOptions = { invoke: undefined, scheduler: undefined, maxTimerMilliseconds: undefined };
  assert.equal(createTimeoutCommand(commandOptions).name, "timeout");
});

test("plugin captures singleton and preflights collision without mutation", () => {
  const registry = new CommandRegistry([{ name: "timeout", execute: async () => ({ exitCode: 7 }) }]);
  const host: PluginHost = {
    commands: registry,
    use() {},
    registerFileSystem() {},
  };
  assert.throws(() => timeoutCommands().setup(host), /Command already registered: timeout/u);
  assert.equal(registry.get("timeout")!.execute !== undefined, true);
  timeoutCommands({ replace: true }).setup(host);
  assert.equal(registry.list().length, 1);
});

test("help performs only its exact stdout write", async () => {
  let writes = 0;
  const target = {
    args: ["--help"],
    signal: new AbortController().signal,
    stdout: { async write(chunk: Uint8Array) { writes++; assert.deepEqual(chunk, bytes(help)); } },
  };
  const context = new Proxy(target, {
    has(_value, key) {
      if (key === "invoke") throw new Error("invoke presence inspected");
      return Reflect.has(target, key);
    },
    get(value, key, receiver) {
      if (!["args", "signal", "stdout"].includes(String(key))) throw new Error(`unexpected context read: ${String(key)}`);
      return Reflect.get(value, key, receiver);
    },
  });
  const definition = createTimeoutCommand({
    invoke() { throw new Error("invoked"); },
    scheduler: {
      now() { throw new Error("clock read"); },
      setTimeout() { throw new Error("timer armed"); },
      clearTimeout() { throw new Error("timer cleared"); },
    },
  });
  assert.deepEqual(await definition.execute(context as unknown as CommandContext), { exitCode: 0 });
  assert.equal(writes, 1);
});

test("zero disables deadline resources and transparently forwards literal invocation", async () => {
  const stdin = { async *[Symbol.asyncIterator]() { yield bytes("input"); } };
  const stdout = { async write() {} };
  const stderr = { async write() {} };
  let receiver: unknown;
  let observed: { command: string; args: readonly string[]; options: CommandInvokeOptions | undefined } | undefined;
  const capture = captureContext(["0.000d", "child", "--signal", "x"], {
    stdin,
    stdinIsDefault: false,
    stdout,
    stderr,
    invoke: async function (command, args, options) {
      receiver = this;
      observed = { command, args, options };
      return { exitCode: 124 };
    },
  });
  Object.defineProperty(capture.context, "registerCleanup", { get() { throw new Error("cleanup read"); } });
  const result = await createTimeoutCommand({
    scheduler: {
      now() { throw new Error("clock read"); },
      setTimeout() { throw new Error("timer armed"); },
      clearTimeout() { throw new Error("timer cleared"); },
    },
  }).execute(capture.context);
  assert.deepEqual(result, { exitCode: 124 });
  assert.equal(receiver, capture.context);
  assert.deepEqual(observed, {
    command: "child",
    args: ["--signal", "x"],
    options: { stdin, stdinIsDefault: false, stdout, stderr },
  });
});

test("present malformed invoke never falls back and absent invoke uses standalone fallback", async () => {
  let fallbackReceiver: unknown = null;
  const fallback = async function (this: unknown) {
    fallbackReceiver = this;
    return { exitCode: 3 };
  };
  const malformed = captureContext(["0", "child"]);
  Object.defineProperty(malformed.context, "invoke", { value: undefined, configurable: true });
  assert.deepEqual(await createTimeoutCommand({ invoke: fallback }).execute(malformed.context), { exitCode: 125 });
  assert.equal(malformed.stderr(), "timeout: command invocation is unavailable\n");
  const absent = captureContext(["0", "child"]);
  delete (absent.context as { invoke?: unknown }).invoke;
  assert.deepEqual(await createTimeoutCommand({ invoke: fallback }).execute(absent.context), { exitCode: 3 });
  assert.equal(fallbackReceiver, undefined);
});

test("duration validation is exact at MAX_SAFE and invalid syntax outranks overflow", async () => {
  const scheduler = new ManualScheduler();
  const valid = captureContext(["9007199254740.991s", "child"], { invoke: immediateInvoker() });
  assert.deepEqual(await createTimeoutCommand({ scheduler }).execute(valid.context), { exitCode: 0 });
  assert.deepEqual(scheduler.setCalls, [2147483647]);
  const overflow = captureContext(["9007199254740.9911s", "child"], { invoke: immediateInvoker() });
  assert.deepEqual(await createTimeoutCommand().execute(overflow.context), { exitCode: 125 });
  assert.equal(overflow.stderr(), "timeout: duration exceeds supported range\n");
  const invalid = captureContext([`${"9".repeat(10000)}x`, "child"], { invoke: immediateInvoker() });
  assert.deepEqual(await createTimeoutCommand().execute(invalid.context), { exitCode: 125 });
  assert.equal(invalid.stderr(), "timeout: invalid duration\n");
});

test("long zero disables resources and arbitrarily late positive fraction ceilings to one", async () => {
  const zeroScheduler = new ManualScheduler();
  const zero = captureContext([`${"0".repeat(100000)}d`, "child"], { invoke: immediateInvoker() });
  assert.deepEqual(await createTimeoutCommand({ scheduler: zeroScheduler }).execute(zero.context), { exitCode: 0 });
  assert.equal(zeroScheduler.nowCalls, 0);
  const fractionScheduler = new ManualScheduler();
  const fraction = captureContext([`.${"0".repeat(100000)}1s`, "child"], { invoke: immediateInvoker() });
  assert.deepEqual(await createTimeoutCommand({ scheduler: fractionScheduler }).execute(fraction.context), { exitCode: 0 });
  assert.deepEqual(fractionScheduler.setCalls, [1]);
});

test("chunking owns one opaque handle and clears before rearm", async () => {
  const scheduler = new ManualScheduler();
  scheduler.handle = false;
  const child = gate();
  const capture = captureContext(["3s", "child"], {
    invoke: async () => { await child.promise; return { exitCode: 6 }; },
  });
  const pending = createTimeoutCommand({ scheduler, maxTimerMilliseconds: 1000 }).execute(capture.context);
  await turn();
  assert.deepEqual(scheduler.setCalls, [1000]);
  scheduler.fire(400);
  assert.deepEqual(scheduler.clearCalls, [false]);
  assert.deepEqual(scheduler.setCalls, [1000, 1000]);
  child.release();
  assert.deepEqual(await pending, { exitCode: 6 });
  assert.deepEqual(scheduler.clearCalls, [false, false]);
});

test("timer remains owned through cooperative child closure and maps own deadline afterward", async () => {
  const scheduler = new ManualScheduler();
  const cleanup = gate();
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const capture = captureContext(["1s", "child"], {
    invoke: async (_command, _args, options) => {
      entered();
      const signal = options!.signal!;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      await cleanup.promise;
      throw signal.reason;
    },
  });
  const pending = Promise.resolve(createTimeoutCommand({ scheduler }).execute(capture.context));
  await admitted;
  scheduler.fire(1000);
  await turn();
  assert.equal(scheduler.clearCalls.length, 0);
  cleanup.release();
  assert.deepEqual(await pending, { exitCode: 124 });
  assert.deepEqual(scheduler.clearCalls, [0]);
  assert.equal(capture.cleanups.length, 1);
});

test("outer cancellation wins when its reason is the observed own deadline sentinel", async () => {
  const scheduler = new ManualScheduler();
  const outer = new AbortController();
  const cleanup = gate();
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let observed: unknown;
  const capture = captureContext(["1s", "child"], {
    signal: outer.signal,
    invoke: async (_command, _args, options) => {
      entered();
      const signal = options!.signal!;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => {
        observed = signal.reason;
        outer.abort(observed);
        resolve();
      }, { once: true }));
      await cleanup.promise;
      throw signal.reason;
    },
  });
  const pending = Promise.resolve(createTimeoutCommand({ scheduler }).execute(capture.context));
  await admitted;
  scheduler.fire(1000);
  cleanup.release();
  await assert.rejects(pending, (error: unknown) => error === observed && error === outer.signal.reason);
});

test("clear failure equal to own deadline sentinel remains cleanup failure", async () => {
  const scheduler = new ManualScheduler();
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let observed: unknown;
  const capture = captureContext(["1s", "child"], {
    invoke: async (_command, _args, options) => {
      entered();
      const signal = options!.signal!;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => {
        observed = signal.reason;
        scheduler.clearFailure = observed;
        resolve();
      }, { once: true }));
      throw signal.reason;
    },
  });
  const pending = Promise.resolve(createTimeoutCommand({ scheduler }).execute(capture.context));
  await admitted;
  scheduler.fire(1000);
  await assert.rejects(pending, (error: unknown) => error === observed);
  assert.deepEqual(scheduler.clearCalls, [0]);
});

test("actual Shell registry invocation preserves literal argv and child status", async () => {
  const commands = new CommandRegistry([createTimeoutCommand()]);
  let observed: readonly string[] | undefined;
  commands.register({
    name: "child",
    execute(context) {
      observed = context.args;
      return { exitCode: 126 };
    },
  });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands });
  try {
    const result = await shell.exec("timeout 0 child --signal '$literal'");
    assert.equal(result.exitCode, 126);
    assert.deepEqual(observed, ["--signal", "$literal"]);
  } finally {
    await shell.dispose();
  }
});

test("public aggregate includes timeout and the other approved public79 additions", () => {
  const names = createAgentCommands().map(command => command.name);
  assert.equal(names.length, 79);
  assert.equal(new Set(names).size, 79);
  for (const name of ["which", "timeout", "apply_patch"]) assert.ok(names.includes(name));
  for (const name of ["curl", "safejs", "node", "npm", "npx"]) assert.equal(names.includes(name), false);
});
