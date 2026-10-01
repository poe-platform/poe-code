import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createPatchCommand, createPatchCommands, patchCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "") {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("old\n"));
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone patch works with only portable filesystem and command contracts", async () => {
  assert.equal(createPatchCommand().name, "patch");
  assert.ok(createPatchCommands().some(command => command.name === "patch"));
  assert.equal(patchCommands().name, "patch-commands");
  const result = await run(createPatchCommand(), ["--dry-run", "/file"], "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});
