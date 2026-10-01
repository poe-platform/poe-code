import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createWgetCommand, createWgetCommands, wgetCommands } from "./index.js";

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

test("standalone wget works with only portable filesystem and command contracts", async () => {
  assert.equal(createWgetCommand().name, "wget");
  assert.ok(createWgetCommands().some(command => command.name === "wget"));
  assert.equal(wgetCommands().name, "wget-commands");
  const result = await run(createWgetCommand(), ["--help"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});

test("wget requires authorization before invoking an injected transport", async () => {
  let calls = 0;
  const command = createWgetCommand({ transport: async () => { calls++; throw new Error("unexpected transport"); } });
  const denied = await run(command, ["https://example.test/data"]);
  assert.notEqual(denied.exitCode, 0);
  assert.equal(calls, 0);
});

test("wget input accepts more than 4096 blank lines with default limits", async () => {
  let calls = 0;
  const command = createWgetCommand({ authorize: () => true, transport: async () => {
    calls++;
    return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), dispose: async () => {} };
  } });
  const result = await run(command, ["-i", "-", "-O", "-"], "\n".repeat(4097) + "https://example.test/data\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(calls, 1);
});
