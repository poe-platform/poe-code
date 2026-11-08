import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { commandRuntimeIdentity, createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createGzipCommand, createGzipCommands, gzipCommands } from "./index.js";

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

test("standalone gzip works with only portable filesystem and command contracts", async () => {
  assert.equal(createGzipCommand().name, "gzip");
  assert.ok(createGzipCommands().some(command => command.name === "gzip"));
  assert.equal(gzipCommands().name, "gzip-commands");
  const result = await run(createGzipCommand(), ["--help"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});

test("gzip aliases declare the canonical command runtime at the package boundary", () => {
  assert.deepEqual(createGzipCommands().map(command => command.name), ["gzip", "gunzip", "zcat"]);
  for (const command of createGzipCommands()) assert.equal(command.runtimeIdentity, commandRuntimeIdentity);
});
