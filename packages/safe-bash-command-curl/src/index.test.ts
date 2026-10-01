import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createCurlCommand, createCurlCommands, curlCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", fs = createMemoryFileSystem()) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
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

test("curl config nesting is unlimited by default and honors an explicit depth", async () => {
  const fs = createMemoryFileSystem();
  for (let depth = 0; depth < 20; depth++) {
    await fs.writeFile(`/config${depth}`, new TextEncoder().encode(depth === 19 ? "url https://example.test/data" : `config /config${depth + 1}`));
  }
  for (const maxConfigDepth of [Infinity, 16]) {
    let calls = 0;
    const command = createCurlCommand({ authorize: () => true, limits: { maxConfigDepth }, transport: async () => {
      calls++;
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), dispose: async () => {} };
    } });
    const result = await run(command, ["-K", "/config0"], "", fs);
    assert.equal(result.exitCode, maxConfigDepth === Infinity ? 0 : 2, result.stderr);
    assert.equal(calls, maxConfigDepth === Infinity ? 1 : 0);
  }
});

test("curl requires authorization before invoking an injected transport", async () => {
  let calls = 0;
  const command = createCurlCommand({ transport: async () => { calls++; throw new Error("unexpected transport"); } });
  const denied = await run(command, ["https://example.test/data"]);
  assert.notEqual(denied.exitCode, 0);
  assert.equal(calls, 0);
});

test("curl sends only the final user-agent and omits an explicitly empty agent", async () => {
  for (const agent of ["Agent2", ""]) {
    const headers: string[] = [];
    const command = createCurlCommand({ authorize: () => true, transport: async request => {
      headers.push(...request.headers.filter(([name]) => name.toLowerCase() === "user-agent").map(([, value]) => value));
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), dispose: async () => {} };
    } });
    const result = await run(command, ["-A", "Agent1", "-A", agent, "https://example.test/data"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(headers, agent ? [agent] : []);
  }
});
