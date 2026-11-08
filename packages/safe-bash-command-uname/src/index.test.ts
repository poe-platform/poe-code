import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createUnameCommand } from "./index.js";

async function runUname(args: string[], env: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  const stdoutPipe = createBytePipe();
  const stderrPipe = createBytePipe();
  const cmd = createUnameCommand();
  const result = await cmd.execute({
    command: "uname",
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

test("uname flags and Sandbox VFS-ish/GNU output", async () => {
  assert.equal((await runUname([])).stdout, "Linux\n");
  assert.equal((await runUname(["-s"])).stdout, "Linux\n");
  assert.equal((await runUname(["-n"])).stdout, "sandbox\n");
  assert.equal((await runUname(["-r"])).stdout, "6.6.0-sandbox-vfs\n");
  assert.equal((await runUname(["-v"])).stdout, "#1 SMP Sandbox VFS-ish/GNU\n");
  assert.equal((await runUname(["-m"])).stdout, "x86_64\n");
  assert.equal((await runUname(["-o"])).stdout, "GNU/Linux\n");
  assert.equal(
    (await runUname(["-a"])).stdout,
    "Linux sandbox 6.6.0-sandbox-vfs #1 SMP Sandbox VFS-ish/GNU x86_64 GNU/Linux\n"
  );
  assert.equal((await runUname(["extra"])).exitCode, 1);
});
