import assert from "node:assert/strict";
import { test } from "node:test";
import { writeText } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";
import { Budget, Runtime } from "../../src/shell/runtime.js";

test("pipeline stage admission rejects before any stage starts", async context => {
  const { shell, commands } = setup();
  let effects = 0;
  let stages = 0;
  const original = Runtime.prototype.runCommandIsolated;
  context.mock.method(Runtime.prototype, "runCommandIsolated", function (this: Runtime, ...args: Parameters<Runtime["runCommandIsolated"]>) {
    stages++;
    return original.apply(this, args);
  });
  commands.register({ name: "effect", execute() { effects++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec(Array(65).fill("effect").join(" | ")),
      error => error instanceof ShellLimitError && error.limit === "maxPipelineStages");
    assert.equal(stages, 0);
    assert.equal(effects, 0);
  } finally { await shell.dispose(); }
});

test("nested pipelines share admission with still-active outer stages", async () => {
  const { shell, commands } = setup({ limits: { maxPipelineStages: 3 } });
  let effects = 0;
  commands.register({ name: "effect", execute() { effects++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("{ effect | effect; } | true"),
      error => error instanceof ShellLimitError && error.limit === "maxPipelineStages");
    assert.equal(effects, 0);
  } finally { await shell.dispose(); }
});

test("pipeline stage capacity admits the exact boundary and is reused sequentially", async () => {
  const { shell } = setup({ limits: { maxPipelineStages: 2, pipeHighWaterMark: 1 } });
  try {
    const sequential = await shell.exec("say x | pass; ".repeat(10));
    assert.equal(sequential.stdout, "x\n".repeat(10));
    const nested = await shell.exec("{ say nested | pass; } | pass", { limits: { maxPipelineStages: 4 } });
    assert.equal(nested.stdout, "nested\n");
    await assert.rejects(shell.exec("true | true | true"),
      error => error instanceof ShellLimitError && error.limit === "maxPipelineStages");
  } finally { await shell.dispose(); }
});

test("the default pipeline capacity admits all 64 stages concurrently", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  commands.register({ name: "together", async execute() {
    if (++started === 64) release();
    await gate;
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec(Array(64).fill("together").join(" | "))).exitCode, 0);
    assert.equal(started, 64);
  } finally { release(); await shell.dispose(); }
});

for (const maxPipelineStages of [5, 6]) test(`parallel nested pipelines require six aggregate stage slots: ${maxPipelineStages}`, { timeout: 2000 }, async () => {
  const { shell, commands } = setup({ limits: { maxPipelineStages } });
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  commands.register({ name: "together", async execute({ signal }) {
    if (++started === 4) release();
    await Promise.race([gate, new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }))]);
    signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  try {
    const execution = shell.exec("{ together | together; } | { together | together; }");
    if (maxPipelineStages === 6) {
      assert.equal((await execution).exitCode, 0);
      assert.equal(started, 4);
    } else {
      await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxPipelineStages");
      assert.ok(started < 4);
    }
  } finally { release(); await shell.dispose(); }
});

for (const maxPipelineStages of [0, 1]) test(`pipeline capacity ${maxPipelineStages} permits commands without pipeline setup`, async () => {
  const { shell } = setup({ limits: { maxPipelineStages } });
  try {
    assert.equal((await shell.exec("true; ! false; eval 'true'; (true)")).exitCode, 0);
    await assert.rejects(shell.exec("true | true"),
      error => error instanceof ShellLimitError && error.limit === "maxPipelineStages");
    assert.equal((await shell.exec("true | true", { limits: { maxPipelineStages: 2 } })).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("pipeline limits use constructor and per-execution integer validation", async () => {
  for (const maxPipelineStages of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => setup({ limits: { maxPipelineStages } }), RangeError);
    const { shell } = setup();
    try { await assert.rejects(shell.exec("true", { limits: { maxPipelineStages } }), RangeError); }
    finally { await shell.dispose(); }
  }
});

test("pipeline reservation survives cancellation until underlying stage work settles", { timeout: 2000 }, async context => {
  const { shell } = setup({ limits: { maxPipelineStages: 2 } });
  let released = 0;
  const reserve = Budget.prototype.reservePipelineStages;
  context.mock.method(Budget.prototype, "reservePipelineStages", function (this: Budget, count: number) {
    const release = reserve.call(this, count);
    return () => { released++; release(); };
  });
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const underlying: Promise<number>[] = [];
  let completed = 0;
  const original = Runtime.prototype.runCommandIsolated;
  context.mock.method(Runtime.prototype, "runCommandIsolated", function (this: Runtime, ...args: Parameters<Runtime["runCommandIsolated"]>) {
    const work = original.apply(this, args).finally(async () => {
      if (++completed === 2) ready();
      await gate;
    });
    underlying.push(work);
    return work;
  });
  const controller = new AbortController();
  const execution = shell.exec("true | true", { signal: controller.signal });
  try {
    await started;
    controller.abort(0);
    await assert.rejects(execution, error => Object.is(error, 0));
    assert.equal(released, 0);
    finish();
    await Promise.all(underlying);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(released, 1);
  } finally { finish(); await shell.dispose(); }
});

test("pipeline setup failure preserves a falsey reason and releases admission", async context => {
  const { shell } = setup({ limits: { maxPipelineStages: 2 } });
  let released = 0;
  const reserve = Budget.prototype.reservePipelineStages;
  context.mock.method(Budget.prototype, "reservePipelineStages", function (this: Budget, count: number) {
    const release = reserve.call(this, count);
    return () => { released++; release(); };
  });
  const original = Runtime.prototype.runCommandIsolated;
  let failed = false;
  context.mock.method(Runtime.prototype, "runCommandIsolated", function (this: Runtime, ...args: Parameters<Runtime["runCommandIsolated"]>) {
    if (!failed) { failed = true; throw false; }
    return original.apply(this, args);
  });
  try {
    await assert.rejects(shell.exec("true | true"), error => Object.is(error, false));
    assert.equal(released, 1);
    assert.equal((await shell.exec("true | true")).exitCode, 0);
    assert.equal(released, 2);
  } finally { await shell.dispose(); }
});

test("partial pipe creation releases admission and closes already-created pipes", async context => {
  const { shell } = setup({ limits: { maxPipelineStages: 3 } });
  let released = 0;
  let aborts = 0;
  let building = false;
  const abort = WritableStreamDefaultWriter.prototype.abort;
  context.mock.method(WritableStreamDefaultWriter.prototype, "abort", function (this: WritableStreamDefaultWriter<Uint8Array>, reason: unknown) {
    if (building) aborts++;
    return abort.call(this, reason);
  });
  const reserve = Budget.prototype.reservePipelineStages;
  context.mock.method(Budget.prototype, "reservePipelineStages", function (this: Budget, count: number) {
    const release = reserve.call(this, count);
    let reads = 0;
    Object.defineProperty(this.limits, "pipeHighWaterMark", { configurable: true, get() {
      if (++reads === 2) throw null;
      return 1;
    } });
    building = true;
    return () => { released++; building = false; release(); };
  });
  try {
    await assert.rejects(shell.exec("true | true | true"), error => Object.is(error, null));
    assert.equal(released, 1);
    assert.equal(aborts, 1);
  } finally { await shell.dispose(); }
});

test("pipes preserve bytes and launch downstream before upstream completes", { timeout: 3000 }, async () => {
  const { shell, commands } = setup({ limits: { pipeHighWaterMark: 1 } });
  let release!: () => void;
  const consumed = new Promise<void>((resolve) => { release = resolve; });
  commands.register({ name: "producer", async execute({ stdout }) {
    await stdout.write(Uint8Array.from([0, 255, 195]));
    await consumed;
    await stdout.write(Uint8Array.from([169, 128]));
    return { exitCode: 0 };
  } });
  commands.register({ name: "consumer", async execute({ stdin, stdout }) {
    for await (const chunk of stdin) { release(); await stdout.write(chunk); }
    return { exitCode: 0 };
  } });
  const result = await shell.exec("producer | consumer | pass");
  assert.equal(result.exitCode, 0);
  assert.deepEqual([...result.stdoutBytes], [0, 255, 195, 169, 128]);
});

test("early downstream exit and unused pipeline input do not deadlock", { timeout: 3000 }, async () => {
  const { shell, commands } = setup({ limits: { pipeHighWaterMark: 1 } });
  let writes = 0;
  commands.register({ name: "forever", async execute({ stdout }) {
    while (true) { await writeText(stdout, "chunk"); writes++; }
  } });
  commands.register({ name: "first", async execute({ stdin, stdout }) {
    for await (const chunk of stdin) { await stdout.write(chunk); break; }
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("forever | first")).stdout, "chunk");
  assert.equal((await shell.exec("forever | true")).exitCode, 0);
  assert.equal((await shell.exec("forever | missing-command")).exitCode, 127);
  assert.ok(writes < 10);
});

test("pipeline redirects replace endpoints without leaving blocked writers", { timeout: 3000 }, async () => {
  const { shell } = setup({ limits: { pipeHighWaterMark: 1 } });
  assert.equal((await shell.exec("say file > input; bytes | pass < input")).stdout, "file\n");
  assert.equal((await shell.exec("bytes > output | pass")).stdout, "");
});

test("streaming external sinks receive exact bytes and results retain captures", async () => {
  const { shell } = setup();
  const chunks: number[] = [];
  const result = await shell.exec("bytes | pass", { stdout: { async write(chunk) { chunks.push(...chunk); } } });
  assert.deepEqual(chunks, [0, 255, 195, 169, 128, 10]);
  assert.deepEqual([...result.stdoutBytes], chunks);
  assert.deepEqual([...(await shell.exec("pass", { stdin: Uint8Array.from([255, 0]) })).stdoutBytes], [255, 0]);
});

test("AbortSignal reaches commands and releases blocked pipelines", { timeout: 3000 }, async () => {
  const { shell, commands } = setup();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let observed: AbortSignal | undefined;
  commands.register({ name: "wait", async execute({ signal }) {
    observed = signal;
    ready();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  const controller = new AbortController();
  const task = shell.exec("bytes | wait", { signal: controller.signal });
  await started;
  const reason = new Error("cancelled by test");
  controller.abort(reason);
  await assert.rejects(task, (error) => error === reason);
  assert.equal(observed?.aborted, true);
  await assert.rejects(shell.exec("say never", { signal: controller.signal }), (error) => error === reason);
});

test("output, command, loop, source and expansion budgets reject deterministically", { timeout: 3000 }, async () => {
  const { shell } = setup();
  for (const [script, limits, expected] of [
    ["bytes | pass", { maxOutputBytes: 3 }, "maxOutputBytes"],
    ["true; true", { maxCommands: 1 }, "maxCommands"],
    ["while true; do true; done", { maxLoopIterations: 2 }, "maxLoopIterations"],
    ["say too long", { maxSourceBytes: 2 }, "maxSourceBytes"],
    ["args a b c", { maxExpansionFields: 2 }, "maxExpansionFields"],
    ['VALUE=abc; VALUE=$VALUE$VALUE$VALUE; args "$VALUE"', { maxExpansionBytes: 8 }, "maxExpansionBytes"],
    ['say "$(say "$(say nested)")"', { maxSubstitutionDepth: 1 }, "maxSubstitutionDepth"],
    ["recur() { recur; }; recur", { maxSubstitutionDepth: 2 }, "maxSubstitutionDepth"],
  ] as const) {
    await assert.rejects(shell.exec(script, { limits }), (error) => error instanceof ShellLimitError && error.limit === expected, script);
  }
});

test("middleware, asynchronous plugins and filesystem factories compose", async () => {
  const { shell, fs } = setup();
  const events: string[] = [];
  shell.use(async (context, next) => { events.push(`before:${context.command}`); const result = await next(); events.push(`after:${result.exitCode}`); return result; });
  shell.use({ name: "test", async setup(host) {
    await Promise.resolve();
    host.commands.register({ name: "plugin-command", async execute({ stdout }) { await writeText(stdout, "plugin"); return { exitCode: 4 }; } });
    host.registerFileSystem("test", () => fs);
  }, dispose() { events.push("dispose"); } });
  assert.equal((await shell.exec("plugin-command")).stdout, "plugin");
  assert.deepEqual(events, ["before:plugin-command", "after:4"]);
  assert.equal(await shell.createFileSystem("test"), fs);
  await shell.dispose();
  assert.equal(events.at(-1), "dispose");
  await assert.rejects(shell.exec("true"), /disposed/u);
});

test("parallel exec calls cannot leak environment, cwd or status", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => shell.exec('cd /other; VALUE=local; say "$VALUE"; pwd; status 7', { env: { VALUE: String(index) } })));
  assert.ok(results.every((result) => result.stdout === "local\n/other\n" && result.exitCode === 7));
  assert.equal((await shell.exec('args "$VALUE" "$?"; pwd')).stdout, '["","0"]/\n');
});
