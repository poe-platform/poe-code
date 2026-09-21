import assert from "node:assert/strict";
import { createProcessSignalChannel } from "safe-bash-contracts/process";
import { test } from "node:test";
import { toByteSource, writeText } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import type { ShellCommandContext } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

test("descriptor leases return an available fragment without filling the request", async () => {
  const { shell, commands } = setup();
  let pulls = 0;
  commands.register({ name: "available-fd", async execute(context) {
    const lease = await context.admittedHandles!.acquire(0, ["read"], context.signal);
    try {
      assert.deepEqual(await lease.read!(0, context.signal), { done: false, value: new Uint8Array() });
      assert.equal(pulls, 0);
      assert.deepEqual(await lease.read!(1024, context.signal), { done: false, value: new Uint8Array([0, 255, 7]) });
      assert.equal(pulls, 1);
    } finally { await lease.close(); }
    return { exitCode: 0 };
  } });
  const stdin = { [Symbol.asyncIterator]() { return {
    async next() {
      if (++pulls > 1) throw new Error("Native reads must return available bytes");
      return { done: false as const, value: new Uint8Array([0, 255, 7]) };
    },
    async return() { return { done: true as const, value: undefined }; },
  }; } };
  try { const result = await shell.exec("available-fd", { stdin }); assert.equal(result.exitCode, 0, result.stderr); }
  finally { await shell.dispose(); }
});

test("duplicate descriptor leases share the retained cursor and close independently", async () => {
  const { shell, commands, fs } = setup();
  await fs.writeFile("/lease-input", new Uint8Array([1, 2, 3]));
  commands.register({ name: "aliased-fd", async execute(context) {
    const first = await context.admittedHandles!.acquire(4, ["read"], context.signal);
    const second = await context.admittedHandles!.acquire(5, ["read"], context.signal);
    try {
      assert.equal(first.identity, second.identity);
      assert.deepEqual((await first.read!(1, context.signal)).value, new Uint8Array([1]));
      await first.close();
      assert.deepEqual((await second.read!(2, context.signal)).value, new Uint8Array([2, 3]));
      await assert.rejects(context.admittedHandles!.acquire(5, ["write"], context.signal), { code: "EBADF" });
    } finally { await first.close(); await second.close(); }
    return { exitCode: 0 };
  } });
  try { const result = await shell.exec("aliased-fd 4</lease-input 5<&4"); assert.equal(result.exitCode, 0, result.stderr); }
  finally { await shell.dispose(); }
});

test("descriptor writes retain successful receipts while cancellation drains", async () => {
  for (const redirected of [false, true]) {
    const { shell, commands } = setup();
    const controller = new AbortController();
    const reason = new Error("cancel admitted write");
    const events: string[] = [];
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let release!: () => void;
    const draining = new Promise<void>(resolve => { release = resolve; });
    commands.register({ name: "receipt-fd", async execute(context) {
      const lease = await context.admittedHandles!.acquire(redirected ? 3 : 1, ["write"], context.signal);
      try {
        assert.equal(await lease.write!(new Uint8Array([1]), context.signal), 1);
        events.push("receipt");
        await assert.rejects(lease.write!(new Uint8Array([2]), context.signal), error => error === reason);
      } finally { await lease.close(); }
      return { exitCode: 0 };
    } });
    const execution = shell.exec(redirected ? "receipt-fd 3>&1" : "receipt-fd", {
      signal: controller.signal,
      stdout: { async write() { throw new Error("Use enrolled output"); }, ownedOutput: {
        consumerClosed: new AbortController().signal,
        async write() { enter(); await draining; events.push("accepted"); },
      } },
    });
    const outcome = execution.then(() => { throw new Error("Cancellation must reject"); }, error => { assert.equal(error, reason); });
    try {
      await entered; controller.abort(reason); release(); await outcome;
      assert.deepEqual(events, ["accepted", "receipt"]);
    } finally { release(); await shell.dispose(); }
  }
});

test("exec lends process signals to nested invoke and accepts explicit overrides", async () => {
  const { shell, commands } = setup();
  const parent = createProcessSignalChannel();
  const child = createProcessSignalChannel();
  commands.register({ name: "child-signals", async execute(context) {
    assert.equal(context.processSignals, child);
    return { exitCode: 42 };
  } });
  commands.register({ name: "inherited-signals", async execute(context) {
    assert.equal(context.processSignals, parent);
    return { exitCode: 43 };
  } });
  commands.register({ name: "parent-signals", async execute(context) {
    assert.equal(context.processSignals, parent);
    assert.equal((await context.invoke!("child-signals", [], { processSignals: child })).exitCode, 42);
    assert.equal(context.processSignals, parent);
    return context.invoke!("inherited-signals", []);
  } });
  try { assert.equal((await shell.exec("parent-signals", { processSignals: parent })).exitCode, 43); }
  finally { await shell.dispose(); }
});

test("invoke preserves literal argv and uses fresh middleware resolution", async () => {
  const { shell, commands, fs } = setup();
  const order: string[] = [];
  shell.use(async (context, next) => { order.push(context.command); return next(); });
  commands.register({ name: "invoke-test", async execute(context) {
    return (context as ShellCommandContext).invoke("args", ["", "two words", "$(say bad > touched)", ";", "*", "VALUE=literal", "'quotes'"]);
  } });
  assert.deepEqual(JSON.parse((await shell.exec("invoke-test")).stdout), ["", "two words", "$(say bad > touched)", ";", "*", "VALUE=literal", "'quotes'"]);
  assert.deepEqual(order, ["invoke-test", "args"]);
  await assert.rejects(fs.stat("/touched"));
});

test("invoke inherits stdin and supports byte sink overrides", async () => {
  const { shell, commands } = setup();
  const received: number[] = [];
  commands.register({ name: "invoke-test", async execute(context) {
    const host = context as ShellCommandContext;
    await host.invoke("pass", []);
    await host.invoke("pass", [], { stdin: toByteSource(new Uint8Array([255, 0])), stdout: { async write(chunk) { received.push(...chunk); } } });
    return host.invoke("status", ["7"]);
  } });
  const result = await shell.exec("invoke-test", { stdin: "parent" });
  assert.equal(result.stdout, "parent");
  assert.deepEqual(received, [255, 0]);
  assert.equal(result.exitCode, 7);
});

test("invoke isolates child cwd, environment, functions and exit flow", async () => {
  const { shell, fs, commands } = setup({ env: { VALUE: "parent" } });
  await fs.mkdir("/other");
  commands.register({ name: "invoke-test", async execute(context) {
    const host = context as ShellCommandContext;
    await host.invoke("pwd", [], { cwd: "/other" });
    await host.invoke("envget", ["VALUE"], { env: { VALUE: "child" } });
    await host.invoke("cd", ["/other"]);
    await host.invoke("export", ["VALUE=changed"]);
    await host.invoke("work", []);
    const status = await host.invoke("exit", ["9"]);
    assert.equal(status.exitCode, 9);
    await writeText(context.stdout, `${context.cwd}:${context.env.VALUE}`);
    return { exitCode: 0 };
  } });
  const result = await shell.exec('work() { VALUE=function; cd /other; }; invoke-test; pwd; envget VALUE');
  assert.equal(result.stdout, "/other\nchild/:parent/\nparent");
});

test("invoke shares command and output budgets", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "invoke-test", async execute(context) {
    const host = context as ShellCommandContext;
    for (let count = 0; count < 10; count++) await host.invoke("true", []);
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("invoke-test", { limits: { maxCommands: 4 } }), (error) => error instanceof ShellLimitError && error.limit === "maxCommands");
  commands.register({ name: "invoke-bytes", async execute(context) {
    return (context as ShellCommandContext).invoke("bytes", [], { stdout: { async write() {} } });
  } });
  await assert.rejects(shell.exec("invoke-bytes", { limits: { maxOutputBytes: 2 } }), (error) => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

test("invoke propagates cancellation through nested commands", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  commands.register({ name: "invoke-test", async execute(context) {
    return (context as ShellCommandContext).invoke("waiting", []);
  } });
  commands.register({ name: "waiting", async execute(context) {
    signal = context.signal;
    controller.abort(new Error("cancel nested"));
    return new Promise(() => {});
  } });
  await assert.rejects(shell.exec("invoke-test", { signal: controller.signal }), /cancel nested/u);
  assert.equal(signal?.aborted, true);
});

test("invoke unknown commands and recursive hooks use normal statuses and limits", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "missing", async execute(context) { return (context as ShellCommandContext).invoke("does-not-exist", []); } });
  assert.equal((await shell.exec("missing")).exitCode, 127);
  commands.register({ name: "recursive", async execute(context) { return (context as ShellCommandContext).invoke("recursive", []); } });
  await assert.rejects(shell.exec("recursive", { limits: { maxSubstitutionDepth: 4 } }), (error) => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
});
