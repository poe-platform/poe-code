import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createShufCommand, createShufCommands, shufCommands } from "./index.js";

test("shuf permutes -e and -i ranges", async () => {
  assert.equal(createShufCommands().length, 1);
  assert.equal(shufCommands().name, "shuf-commands");
  const cmd = createShufCommand();
  const out = createBytePipe();
  const res = await cmd.execute({
    command: "shuf",
    args: createCommandArguments(["-i", "1-5", "-n", "3"]).args,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    stdin: createBytePipe().readable,
    stdout: out.writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  await out.close();
  assert.equal(res.exitCode, 0);
  const chunks: Uint8Array[] = [];
  for await (const c of out.readable) chunks.push(c);
  const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n");
  assert.equal(lines.length, 3);
});
