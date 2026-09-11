import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { executionCommands } from "../../../src/commands/execution.js";
import { createCommandArguments, getCommandArguments, toByteSource, type ByteSource, type CommandContext, type CommandHandler } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { setup } from "../../shell/helpers.js";
import { ShellLimitError } from "../../../src/shell/types.js";

async function run(args: string[], stdin: ByteSource, execute: CommandHandler) {
  const errors: Uint8Array[] = [];
  const result = await executionCommands(execute).find(command => command.name === "xargs")!.execute({
    command: "xargs", args, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin, stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  });
  return { ...result, stderr: Buffer.concat(errors).toString() };
}

test("producer reuse cannot mutate completed or unfinished byte arguments", async () => {
  const chunk = Uint8Array.of(128, 0);
  const captured: string[][] = [];
  const stdin = (async function* () {
    yield chunk;
    chunk.set([255, 0]);
    yield chunk;
    chunk.set([195, 169]);
    yield chunk;
    chunk.fill(0);
  })();
  const result = await run(["-0", "capture"], stdin, async context => {
    await setImmediate();
    const args = getCommandArguments(context);
    captured.push(args.values.map((_argument, index) => Buffer.from(args.bytes(index)!).toString("hex")));
    return { exitCode: 0 };
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(captured, [["80", "ff", "c3a9"]]);
});

for (const limit of [10, 11]) test(`raw command byte cap includes NUL costs: ${limit}`, async () => {
  const captured: number[][] = [];
  const result = await run(["-0", "-s", String(limit), "capture"], toByteSource(Uint8Array.of(128, 255, 0)), context => {
    captured.push(Array.from(getCommandArguments(context).bytes(0)!));
    return { exitCode: 0 };
  });
  assert.equal(result.exitCode, limit === 10 ? 2 : 0);
  assert.deepEqual(captured, limit === 10 ? [] : [[128, 255]]);
  assert.equal(result.stderr, limit === 10 ? "xargs: single argument exceeds command size limit\n" : "");
});

test("raw replacement amplification is refused before child admission", async () => {
  let calls = 0;
  const result = await run(["-0", "-s", "32", "-I{}", "capture", "{}{}{}{}"], toByteSource(Uint8Array.from([128, 128, 128, 128, 128, 128, 128, 128, 0])), () => {
    calls++;
    return { exitCode: 0 };
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "xargs: expanded arguments exceed command size limit\n");
  assert.equal(calls, 0);
});

test("raw initial operands and replacement input retain distinct invalid bytes", async () => {
  const argumentValues = createCommandArguments(["-0", "-I{}", "capture", shellValueFromBytes(Uint8Array.of(255, 123, 125, 254))]);
  let captured: number[] | undefined;
  const context: CommandContext = {
    command: "xargs", args: argumentValues.args, argumentValues, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(Uint8Array.of(128, 0)), stdout: { async write() {} }, stderr: { async write() {} },
  };
  const result = await executionCommands(incoming => {
    captured = Array.from(getCommandArguments(incoming).bytes(0)!);
    return { exitCode: 0 };
  }).find(command => command.name === "xargs")!.execute(context);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(captured, [255, 128, 254]);
});

for (const reason of [false, 0, "", null]) test(`raw parallel cancellation drains child cleanup: ${String(reason)}`, async () => {
  const { shell, commands } = setup();
  shell.use(agentCommands());
  const controller = new AbortController();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const captured: number[][] = [];
  let cleaned = 0;
  commands.register({ name: "holdraw", async execute(context) {
    captured.push(Array.from(getCommandArguments(context).bytes(0)!));
    context.registerCleanup!(() => { cleaned++; return held; });
    await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), { once: true }));
    context.signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  let settled = false;
  const pending = shell.exec("xargs -0 -P2 -n1 holdraw", { signal: controller.signal, stdin: Uint8Array.of(128, 0, 255, 0, 254, 0) });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    for (let turn = 0; turn < 32 && captured.length !== 2 && !settled; turn++) await setImmediate();
    assert.deepEqual(captured, [[128], [255]]);
    controller.abort(reason);
    for (let turn = 0; turn < 32 && cleaned !== 2 && !settled; turn++) await setImmediate();
    assert.equal(cleaned, 2);
    assert.equal(settled, false);
    release();
    await assert.rejects(pending, error => error === reason);
    assert.deepEqual(captured, [[128], [255]]);
  } finally { controller.abort(reason); release(); await pending.catch(() => {}); await shell.dispose(); }
});

test("raw verbose diagnostics escape invalid bytes without replacement characters", async () => {
  const result = await run(["-0", "-t", "capture"], toByteSource(Uint8Array.of(128, 0, 255, 0)), context => {
    assert.deepEqual(getCommandArguments(context).values.map((_value, index) => Array.from(getCommandArguments(context).bytes(index)!)), [[128], [255]]);
    return { exitCode: 0 };
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "capture $'\\200' $'\\377'\n");
});

test("non-NUL delimiters refuse embedded NUL rather than truncate an argument", async () => {
  let calls = 0;
  const result = await run(["-d", ":", "capture"], toByteSource(Uint8Array.of(128, 0, 255, 58)), () => { calls++; return { exitCode: 0 }; });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "xargs: NUL in non-NUL-delimited input is not supported\n");
  assert.equal(calls, 0);
});

test("byte batching admits exact capacity and honors argument count", async () => {
  for (const options of [["-s", "12"], ["-n", "2"]]) {
    const captured: number[][][] = [];
    const result = await run(["-0", ...options, "capture"], toByteSource(Uint8Array.of(128, 0, 255, 0, 254, 0)), context => {
      const args = getCommandArguments(context);
      captured.push(args.values.map((_argument, index) => Array.from(args.bytes(index)!)));
      return { exitCode: 0 };
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(captured, [[[128], [255]], [[254]]]);
  }
});

test("raw replacement preflights size before allocating amplified buffers", async context => {
  const bytes = new Uint8Array(8193).fill(128);
  bytes[8192] = 0;
  const initial = createCommandArguments(["-0", "-I{}", "capture", "{}".repeat(8192)]);
  const command = executionCommands(() => { assert.fail("over-budget replacement must not invoke"); }).find(definition => definition.name === "xargs")!;
  const errors: Uint8Array[] = [];
  const incoming: CommandContext = { command: "xargs", args: initial.args, argumentValues: initial, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(bytes), stdout: { async write() {} }, stderr: { async write(chunk) { errors.push(chunk.slice()); } } };
  const original = Uint8Array;
  const observed: number[] = [];
  context.mock.method(globalThis, "Uint8Array", new Proxy(original, {
    construct(target, args) {
      if (typeof args[0] === "number") { observed.push(args[0]); assert.ok(args[0] <= 131072, `unadmitted ${args[0]}-byte allocation`); }
      return Reflect.construct(target, args);
    },
  }));
  const result = await command.execute(incoming);
  assert.equal(result.exitCode, 2);
  assert.equal(Buffer.concat(errors).toString(), "xargs: expanded arguments exceed command size limit\n");
  assert.ok(observed.length > 0);
});

for (const reason of [false, 0, "", null]) test(`large token yields to exact caller cancellation: ${String(reason)}`, async () => {
  const { shell, commands } = setup();
  shell.use(agentCommands());
  const controller = new AbortController();
  let calls = 0;
  let closed = false;
  commands.register({ name: "capture", execute() { calls++; return { exitCode: 0 }; } });
  const stdin = (async function* () {
    try {
      void setImmediate().then(() => controller.abort(reason));
      yield new Uint8Array(100000).fill(65);
    } finally { closed = true; }
  })();
  try {
    await assert.rejects(shell.exec("xargs -0 capture", { stdin, signal: controller.signal }), error => error === reason);
    assert.equal(calls, 0);
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});

test("large byte token uses the shared Shell CPU deadline", async context => {
  const { shell, commands } = setup();
  shell.use(agentCommands());
  let now = 0;
  let calls = 0;
  let closed = false;
  context.mock.method(performance, "now", () => now);
  commands.register({ name: "capture", execute() { calls++; return { exitCode: 0 }; } });
  const stdin = (async function* () {
    try { now = 10; yield new Uint8Array(100000).fill(65); }
    finally { closed = true; }
  })();
  try {
    await assert.rejects(shell.exec("xargs -0 capture", { stdin, limits: { maxCpuMs: 5 } }), error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
    assert.equal(calls, 0);
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});
