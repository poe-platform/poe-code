import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createSedCommand, createSedCommands, sedCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "") {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone sed works with only portable filesystem and command contracts", async () => {
  assert.equal(createSedCommand().name, "sed");
  assert.ok(createSedCommands().some(command => command.name === "sed"));
  assert.equal(sedCommands().name, "sed-commands");
  const result = await run(createSedCommand(), ["s/old/new/g"], "old old\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "new new\n");
});
