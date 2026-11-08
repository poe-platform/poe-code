import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createNprocCommand } from "./index.js";

async function runNproc(args: string[], env: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  const stdoutPipe = createBytePipe();
  const stderrPipe = createBytePipe();
  const cmd = createNprocCommand();
  const result = await cmd.execute({
    command: "nproc",
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

test("nproc default, --all, --ignore, and OMP env vars", async () => {
  assert.equal((await runNproc([])).stdout, "4\n");
  assert.equal((await runNproc(["--ignore=1"])).stdout, "3\n");
  assert.equal((await runNproc(["--ignore=10"])).stdout, "1\n");
  assert.equal((await runNproc([], { OMP_NUM_THREADS: "8" })).stdout, "8\n");
  assert.equal((await runNproc([], { OMP_NUM_THREADS: "8", OMP_THREAD_LIMIT: "6" })).stdout, "6\n");
  assert.equal((await runNproc(["--all"], { OMP_NUM_THREADS: "8" })).stdout, "4\n");
  assert.equal((await runNproc(["--ignore=abc"])).exitCode, 1);
  assert.match((await runNproc(["--version"])).stdout, /Sandbox VFS-ish\/GNU/);
});
