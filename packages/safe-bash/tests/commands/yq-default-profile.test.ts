import assert from "node:assert/strict";
import test from "node:test";
import { Shell, CommandRegistry, MemoryFileSystem, yqCommands, createStandardCommands } from "../../src/index.js";

test("default yq shell plugin supports native flags in commands, pipelines, and substitutions", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.yaml", new TextEncoder().encode("a: 1\n"));
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) }).use(yqCommands());
  try {
    for (const [command, stdout, exitCode] of [
      ["yq -i '.a = 2' /data.yaml", "", 0],
      ["yq '.a' /data.yaml", "2\n", 0],
      ["yq -n '.a = 1'", "a: 1\n", 0],
      ["yq -e '.missing' /data.yaml", "null\n", 1],
      ["yq ea '.a' /data.yaml /data.yaml", "2\n---\n2\n", 0],
      ["printf '%s' '{\"a\":{\"b\":1}}' | yq -P -I 4 '.'", "a:\n    b: 1\n", 0],
      ["value=$(yq -n '.a = 1'); printf '%s' \"$value\"", "a: 1", 0],
    ] as const) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, exitCode, result.stderr);
      assert.equal(result.stdout, stdout, command);
    }
  } finally { await shell.dispose(); }
});
