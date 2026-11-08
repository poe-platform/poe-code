import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createIdCommand } from "./index.js";

async function runId(args: string[], env: Record<string, string> = {}, files: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  for (const [p, content] of Object.entries(files)) {
    const dir = p.slice(0, p.lastIndexOf("/")) || "/";
    if (dir !== "/") await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(p, Buffer.from(content, "utf8"));
  }
  const stdoutPipe = createBytePipe();
  const stderrPipe = createBytePipe();
  const cmd = createIdCommand();
  const result = await cmd.execute({
    command: "id",
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

test("id default output and flags", async () => {
  const def = await runId([]);
  assert.equal(def.exitCode, 0);
  assert.equal(def.stdout, "uid=1000(sandbox) gid=1000(sandbox) groups=1000(sandbox)\n");

  assert.equal((await runId(["-u"])).stdout, "1000\n");
  assert.equal((await runId(["-un"])).stdout, "sandbox\n");
  assert.equal((await runId(["-g"])).stdout, "1000\n");
  assert.equal((await runId(["-gn"])).stdout, "sandbox\n");
  assert.equal((await runId(["-G"])).stdout, "1000\n");
  assert.equal((await runId(["-Gn"])).stdout, "sandbox\n");
  assert.equal((await runId(["-Gnz"])).stdout, "sandbox\0");
  assert.match((await runId(["-Z"])).stdout, /sandbox_t/);
  assert.equal((await runId(["root"])).stdout, "uid=0(root) gid=0(root) groups=0(root)\n");
  assert.equal((await runId(["nonexistent"])).exitCode, 1);
  assert.equal((await runId(["-u", "-g"])).exitCode, 1);
  assert.equal((await runId(["-n"])).exitCode, 1);
  assert.equal((await runId(["-z"])).exitCode, 1);
  assert.match((await runId(["--version"])).stdout, /Sandbox VFS-ish\/GNU/);
});
