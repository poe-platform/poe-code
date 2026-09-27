import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createWhoamiCommand } from "./index.js";

async function runWhoami(args: string[], env: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  const stdoutPipe = createBytePipe();
  const stderrPipe = createBytePipe();
  const cmd = createWhoamiCommand();
  const result = await cmd.execute({
    command: "whoami",
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

test("whoami default, env overrides, and error handling", async () => {
  assert.equal((await runWhoami([])).stdout, "sandbox\n");
  assert.equal((await runWhoami([], { USER: "alice" })).stdout, "alice\n");
  assert.equal((await runWhoami([], { EUID: "0" })).stdout, "root\n");
  assert.equal((await runWhoami(["extra"])).exitCode, 1);
  assert.match((await runWhoami(["--version"])).stdout, /Sandbox VFS-ish\/GNU/);
});
