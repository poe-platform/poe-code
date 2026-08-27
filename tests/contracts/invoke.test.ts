import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, toByteSource, type CommandInvoker, type CommandInvokeOptions } from "../../src/contracts/index.js";
import { Shell, type ShellCommandContext, type ShellInvokeOptions } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

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
