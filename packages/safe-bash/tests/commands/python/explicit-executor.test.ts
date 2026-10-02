import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { Shell } from "../../../src/core.js";
import { createPythonExecutorCommands, pythonExecutorCommands } from "../../../src/commands/python/index.js";

test("explicit Python registration runs both aliases through the supplied executor", async () => {
  const invocations: string[] = [];
  let terminated = 0;
  const options = { createExecutor: () => ({
    async run(start) {
      invocations.push(start.invocation.command ?? "");
      start.onReady();
      return 7;
    },
    terminate() { terminated++; },
  }) } satisfies Parameters<typeof pythonExecutorCommands>[0];
  assert.deepEqual(createPythonExecutorCommands(options).map(command => command.name), ["python", "python3"]);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonExecutorCommands(options));
  try {
    for (const command of ["python", "python3"]) {
      const result = await shell.exec(`${command} -c pass`);
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
    }
    assert.deepEqual(invocations, ["python", "python3"]);
    assert.equal(terminated, 2);
  } finally { await shell.dispose(); }
});
