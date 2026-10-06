import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { CommandRegistry, createAgentCommands, Shell } from "../../src/core.js";

for (const [script, stdout] of [
  ["touch /file && ls /file", "/file\n"],
  ["touch /file && ls /file | cat", "/file\n"],
  ["printf '%s\\n' alpha beta | cat", "alpha\nbeta\n"],
] as const) {
  test(`managed object waiters support shell execution: ${script}`, async context => {
    const shell = new Shell({
      fs: createMemoryFileSystem(),
      commands: new CommandRegistry(createAgentCommands()),
    });
    context.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
  });
}

for (const frozen of [false, true]) {
  test(`completed executions release caller signal listeners, frozen=${frozen}`, async context => {
    const signal = new AbortController().signal;
    if (frozen) {
      // Initialize Node's lazy EventTarget storage before freezing. The adapter
      // must still attach and release listeners without adding signal properties.
      const initialize = () => {};
      signal.addEventListener('abort', initialize);
      signal.removeEventListener('abort', initialize);
      Object.freeze(signal);
    }
    const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(createAgentCommands()) });
    context.after(() => shell.dispose());
    for (const script of ["echo hi", "echo hi | cat", "false", "echo hi"]) {
      const result = await shell.exec(script, { signal });
      assert.equal(result.exitCode, script === "false" ? 1 : 0, result.stderr);
      assert.equal(result.stdout, script === "false" ? "" : "hi\n");
      assert.equal(getEventListeners(signal, "abort").length, 0);
    }
  });
}
