import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createGetconfCommand } from "./index.js";

async function runGetconf(args: string[]) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createGetconfCommand();
  const res = await cmd.execute({
    command: "getconf",
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const c of stdout.readable) chunks.push(c);
  return { exitCode: res.exitCode, stdout: Buffer.concat(chunks).toString("utf8") };
}

test("getconf queries system and path variables and supports -a", async () => {
  assert.equal((await runGetconf(["PAGE_SIZE"])).stdout, "4096\n");
  assert.equal((await runGetconf(["_NPROCESSORS_ONLN"])).stdout, "4\n");
  assert.equal((await runGetconf(["NAME_MAX", "/tmp"])).stdout, "255\n");
  assert.equal((await runGetconf(["NAME_MAX", "/missing"])).exitCode, 1);
  assert.equal((await runGetconf(["UNKNOWN_VAR"])).exitCode, 1);
  assert.match((await runGetconf(["-a"])).stdout, /PAGE_SIZE/);
});
