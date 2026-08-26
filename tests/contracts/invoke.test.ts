import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, toByteSource, type CommandInvoker, type CommandInvokeOptions } from "../../src/contracts/index.js";
import { Shell, type ShellCommandContext, type ShellInvokeOptions } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

test("shared invocation types structurally match the existing shell hook", () => {
  const shared: CommandInvokeOptions = { cwd: "/", env: { KEY: "value" }, stdin: toByteSource("") };
  const shell: ShellInvokeOptions = shared;
  const roundtrip: CommandInvokeOptions = shell;
  const invoke: ShellCommandContext["invoke"] = async () => ({ exitCode: 0 });
  const contract: CommandInvoker = invoke;
  assert.equal(roundtrip, shared);
  assert.equal(contract, invoke);
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
