import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createHostnameCommand } from "./index.js";

async function runHostname(args: string[], env: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  const stdoutPipe = createBytePipe();
  const stderrPipe = createBytePipe();
  const cmd = createHostnameCommand();
  const result = await cmd.execute({
    command: "hostname",
    args: createCommandArguments(args).args,
    cwd: "/",
    env,
    fs,
    stdin: createBytePipe().readable,
    stdout: stdoutPipe.writable,
    stderr: stderrPipe.writable,
    signal: new AbortController().signal,
  });
  await stdoutPipe.close();
  await stderrPipe.close();
  const readAll = async (src: typeof stdoutPipe.readable) => {
    const chunks: Uint8Array[] = [];
    for await (const c of src) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  };
  return {
    exitCode: result.exitCode,
    stdout: await readAll(stdoutPipe.readable),
    stderr: await readAll(stderrPipe.readable),
  };
}

test("hostname flags and Sandbox VFS-ish/GNU output", async () => {
  assert.equal((await runHostname([])).stdout, "sandbox\n");
  assert.equal((await runHostname(["-s"])).stdout, "sandbox\n");
  assert.equal((await runHostname(["-f"])).stdout, "sandbox.vfs.local\n");
  assert.equal((await runHostname(["-d"])).stdout, "vfs.local\n");
  assert.equal((await runHostname(["-i"])).stdout, "127.0.0.1\n");
  assert.equal((await runHostname(["new-host"])).exitCode, 1);
  assert.equal((await runHostname(["new-host"], { EUID: "0" })).exitCode, 0);
  assert.match((await runHostname(["--version"])).stdout, /Sandbox VFS-ish\/GNU/);
});
