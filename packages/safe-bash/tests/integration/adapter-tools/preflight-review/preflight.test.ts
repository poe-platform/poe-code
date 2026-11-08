import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, type VirtualShellPlugin } from "../../../../src/index.js";
import { families, success, withFixture } from "../fixtures.js";
import { requiredWorkflowCommands } from "./preflight.js";

function withoutCommands(names: readonly string[]): VirtualShellPlugin {
  return {
    name: "adapter-tools-missing-commands-control",
    async setup(host) {
      await agentCommands().setup(host);
      for (const name of names) assert.equal(host.commands.unregister(name), true);
    },
  };
}

async function rejectsSetup(plugin: VirtualShellPlugin, missing: string): Promise<void> {
  let entered = false;
  await assert.rejects(withFixture("memory", async () => { entered = true; }, plugin), error => {
    assert.ok(error instanceof assert.AssertionError);
    assert.equal(error.message, missing);
    return true;
  });
  assert.equal(entered, false, "missing commands must fail setup before the workflow callback");
}

for (const [family, names] of Object.entries(requiredWorkflowCommands)) {
  for (const name of names) {
    test(`preflight rejects missing required ${family} command: ${name}`, async () => {
      await rejectsSetup(withoutCommands([name]), `adapter-tools preflight: missing required ${family} command: ${name}`);
    });
  }
  test(`preflight rejects missing ${family} plugin commands`, async () => {
    const factory = families[family as keyof typeof families];
    await rejectsSetup(
      withoutCommands(factory().map(command => command.name)),
      `adapter-tools preflight: missing required ${family} command: ${names[0]}`,
    );
  });
}

test("preflight rejects an absent aggregate plugin", async () => {
  await rejectsSetup(
    { name: "adapter-tools-no-commands-control", setup() {} },
    "adapter-tools preflight: missing required standard command: cat",
  );
});

test("preflight permits an unrelated executable command alongside all workflow commands", async () => {
  await withFixture("memory", async ({ exec, shell, dispatched }) => {
    assert.equal(shell.commands.has("adapter_tools_unrelated"), true);
    success(await exec("adapter_tools_unrelated"), "");
    success(await exec("cat old.txt"), "alpha\nbeta\n");
    assert.ok(dispatched.includes("adapter_tools_unrelated"));
    assert.ok(dispatched.includes("cat"));
  }, {
    name: "adapter-tools-extra-command-control",
    async setup(host) {
      await agentCommands().setup(host);
      host.commands.register({ name: "adapter_tools_unrelated", execute: () => ({ exitCode: 0 }) });
    },
  });
});
