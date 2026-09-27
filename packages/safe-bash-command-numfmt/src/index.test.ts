import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createNumfmtCommand, createNumfmtCommands, numfmtCommands } from "./index.js";

test("numfmt formats numbers to iec and si", async () => {
  assert.equal(createNumfmtCommands().length, 1);
  assert.equal(numfmtCommands().name, "numfmt-commands");
  const cmd = createNumfmtCommand();
  const out = createBytePipe();
  const res = await cmd.execute({
    command: "numfmt",
    args: createCommandArguments(["--to=iec", "1048576"]).args,
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
  assert.equal(Buffer.concat(chunks).toString("utf8"), "1.0M\n");
});
