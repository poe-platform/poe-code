import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createDdCommand, createDdCommands, ddCommands } from "./index.js";

test("dd copies and converts uppercase", async () => {
  assert.equal(createDdCommands().length, 1);
  assert.equal(ddCommands().name, "dd-commands");
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.txt", new TextEncoder().encode("hello world"));
  const cmd = createDdCommand();
  const res = await cmd.execute({
    command: "dd",
    args: createCommandArguments(["if=/in.txt", "of=/out.txt", "conv=ucase", "status=none"]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: createBytePipe().writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  assert.equal(res.exitCode, 0);
  const out = new TextDecoder().decode(await fs.readFile("/out.txt"));
  assert.equal(out, "HELLO WORLD");
});
