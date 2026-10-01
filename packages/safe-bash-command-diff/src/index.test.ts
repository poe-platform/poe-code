import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createDiffCommand, createDiffCommands, diffCommands } from "./index.js";

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

test("standalone diff works with only portable filesystem and command contracts", async () => {
  assert.equal(createDiffCommand().name, "diff");
  assert.ok(createDiffCommands().some(command => command.name === "diff"));
  assert.equal(diffCommands().name, "diff-commands");
  const result = await run(createDiffCommand(), ["/file", "/file"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
});
