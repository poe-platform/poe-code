import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createCurlCommand, createCurlCommands, curlCommands } from "./index.js";

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

test("standalone curl works with only portable filesystem and command contracts", async () => {
  assert.equal(createCurlCommand().name, "curl");
  assert.ok(createCurlCommands().some(command => command.name === "curl"));
  assert.equal(curlCommands().name, "curl-commands");
  const result = await run(createCurlCommand(), ["--help"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});

test("curl requires authorization before invoking an injected transport", async () => {
  let calls = 0;
  const command = createCurlCommand({ transport: async () => { calls++; throw new Error("unexpected transport"); } });
  const denied = await run(command, ["https://example.test/data"]);
  assert.notEqual(denied.exitCode, 0);
  assert.equal(calls, 0);
});
