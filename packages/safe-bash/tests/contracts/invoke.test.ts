import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, createCommandArguments, getCommandArguments, toByteSource, type CommandContext, type CommandInvoker, type CommandInvokeOptions } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { directExecutor } from "../../src/commands/execution.js";
import { Shell, type ShellCommandContext, type ShellInvokeOptions } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

test("shared invocation options carry exact owned arguments without changing legacy calls", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  const observed: number[][] = [];
  const invoke: CommandInvoker = async (_command, args, options = {}) => {
    const selected = getCommandArguments({ args, ...(options.argumentValues ? { argumentValues: options.argumentValues } : {}) });
    observed.push(Array.from(selected.bytes(0)!));
    return { exitCode: 0 };
  };
  await invoke("capture", argumentValues.args, { argumentValues });
  await invoke("capture", ["plain"]);
  assert.deepEqual(observed, [[255], [112, 108, 97, 105, 110]]);
  await assert.rejects(invoke("capture", [...argumentValues.args], { argumentValues }), /argument.*identity/i);
});

test("direct invocation snapshots legacy argv before asynchronous dispatch", async () => {
  const args = ["before"];
  const context: CommandContext = {
    command: "capture", args, cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    async invoke(_command, selectedArgs, options = {}) {
      await Promise.resolve();
      assert.deepEqual(selectedArgs, ["before"]);
      assert.ok(Object.isFrozen(selectedArgs));
      assert.equal(getCommandArguments({ args: selectedArgs, argumentValues: options.argumentValues! }).args, selectedArgs);
      return { exitCode: 0 };
    },
  };
  const pending = directExecutor(() => { throw new Error("fallback must not execute"); })(context);
  args[0] = "after";
  assert.deepEqual(await pending, { exitCode: 0 });
});

test("shared invocation types structurally match the existing shell hook", () => {
  const shared: CommandInvokeOptions = { cwd: "/", env: { KEY: "value" }, stdin: toByteSource(""), stdinIsDefault: false };
  const shell: ShellInvokeOptions = shared;
  const roundtrip: CommandInvokeOptions = shell;
  const invoke: ShellCommandContext["invoke"] = async () => ({ exitCode: 0 });
  const contract: CommandInvoker = invoke;
  assert.equal(roundtrip, shared);
  assert.equal(roundtrip.stdinIsDefault, false);
  assert.equal(contract, invoke);
});

test("replacement options are additive and preserve omitted, false and empty forms", async () => {
  const received: CommandInvokeOptions[] = [];
  const invoke: CommandInvoker = async (_name, _args, options = {}) => { received.push(options); return { exitCode: 0 }; };
  await invoke("child", []);
  await invoke("child", [], { replaceEnv: false, env: { KEY: "value" } });
  await invoke("child", [], { replaceEnv: true });
  await invoke("child", [], { replaceEnv: true, env: {} });
  assert.deepEqual(received, [{}, { replaceEnv: false, env: { KEY: "value" } }, { replaceEnv: true }, { replaceEnv: true, env: {} }]);
});

for (const replacement of [false, undefined]) test(`legacy actual-shell invoke merge remains compatible: ${replacement}`, async () => {
  const observations: Record<string, string>[] = [];
  const commands = new CommandRegistry([
    { name: "parent", execute(context) { return context.invoke!("child", [], { env: { CHILD: "yes" }, ...(replacement === undefined ? {} : { replaceEnv: replacement }) }); } },
    { name: "child", execute(context) { observations.push({ ...context.env }); return { exitCode: 0 }; } },
  ]);
  const shell = new Shell({ fs: createMemoryFileSystem(), commands, env: { PARENT: "kept" } });
  try {
    assert.equal((await shell.exec("parent")).exitCode, 0);
    assert.deepEqual(observations, [{ PARENT: "kept", PWD: "/", CHILD: "yes" }]);
  } finally { await shell.dispose(); }
});

test("registered commands use optional invoke directly without shell-specific casts", async () => {
  const received: readonly string[][] = [];
  const mutable = received as string[][];
  const commands = new CommandRegistry([
    { name: "parent", async execute(context) {
      assert.ok(context.invoke);
      return context.invoke("child", ["", ";", "$(not-evaluated)", "a b"], { env: { CHILD: "yes" } });
    } },
    { name: "child", execute(context) { mutable.push([...context.args, context.env.CHILD!]); return { exitCode: 7 }; } },
  ]);
  const shell = new Shell({ fs: createMemoryFileSystem(), commands });
  try {
    assert.equal((await shell.exec("parent")).exitCode, 7);
    assert.deepEqual(received, [["", ";", "$(not-evaluated)", "a b", "yes"]]);
  } finally { await shell.dispose(); }
});
