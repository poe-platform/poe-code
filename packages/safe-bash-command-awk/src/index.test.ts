import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createAwkCommand, createAwkCommands, awkCommands } from "./index.js";

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

test("standalone awk works with only portable filesystem and command contracts", async () => {
  assert.equal(createAwkCommand().name, "awk");
  assert.ok(createAwkCommands().some(command => command.name === "awk"));
  assert.equal(awkCommands().name, "awk-commands");
  const result = await run(createAwkCommand(), ["{ print $2 }"], "left right\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "right\n");
});
