import assert from "node:assert/strict";
import { test } from "node:test";
import { toByteSource, writeText } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import type { ShellCommandContext } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

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
