import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createZipCommand, createZipCommands, zipCommands } from "./index.js";

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

test("standalone zip works with only portable filesystem and command contracts", async () => {
  assert.equal(createZipCommand().name, "zip");
  assert.ok(createZipCommands().some(command => command.name === "zip"));
  assert.equal(zipCommands().name, "zip-commands");
  const result = await run(createZipCommand(), ["--help"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});
