import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import * as mdqApi from "./index.js";

test("the plural mdq factory returns one executable definition with the configured limits", async () => {
  assert.equal(typeof mdqApi.createMdqCommands, "function");
  const input = new TextEncoder().encode("# Title\n\nBody.\n");
  for (const inputBytes of [0, 1024]) {
    const commands = mdqApi.createMdqCommands({ limits: { inputBytes } });
    assert.deepEqual(commands.map(command => command.name), ["mdq"]);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await commands[0]!.execute({
      command: "mdq", args: ["# Title"], cwd: "/", env: {}, fs: createMemoryFileSystem(),
      signal: new AbortController().signal, stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
      stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
    });
    assert.equal(result.exitCode, inputBytes ? 0 : 1);
    assert.equal(Buffer.concat(stdout).toString(), inputBytes ? "# Title\n\nBody.\n" : "");
    assert.equal(Buffer.concat(stderr).toString(), inputBytes ? "" : "mdq: inputBytes limit exceeded\n");
  }
});
