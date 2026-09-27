import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createPathchkCommand } from "./index.js";

async function runPathchk(args: string[], files: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  for (const [p, c] of Object.entries(files)) {
    await fs.writeFile(p, new TextEncoder().encode(c));
  }
  const cmd = createPathchkCommand();
  const stderr = createBytePipe();
  const res = await cmd.execute({
    command: "pathchk",
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: createBytePipe().writable,
    stderr: stderr.writable,
    signal: new AbortController().signal,
  });
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const c of stderr.readable) chunks.push(c);
  return { exitCode: res.exitCode, stderr: Buffer.concat(chunks).toString("utf8") };
}

test("pathchk validates POSIX portability, leading dashes, component lengths, and non-directory ancestors", async () => {
  assert.equal((await runPathchk(["valid/path_name.txt"])).exitCode, 0);
  assert.equal((await runPathchk(["-p", "valid/short.txt"])).exitCode, 0);
  assert.equal((await runPathchk(["-p", "dir/component_longer_than_14_chars"])).exitCode, 1);
  assert.equal((await runPathchk(["-p", "dir/bad$char"])).exitCode, 1);
  assert.equal((await runPathchk(["-P", "dir/-leadingdash"])).exitCode, 1);
  assert.equal((await runPathchk(["-P", ""])).exitCode, 1);
  assert.equal((await runPathchk(["/file/child"], { "/file": "data" })).exitCode, 1);
});
