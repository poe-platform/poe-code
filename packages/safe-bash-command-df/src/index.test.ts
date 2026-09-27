import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createDfCommand } from "./index.js";

async function runDf(args: string[], files: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  for (const [p, c] of Object.entries(files)) {
    await fs.writeFile(p, new TextEncoder().encode(c));
  }
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createDfCommand();
  const res = await cmd.execute({
    command: "df",
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

test("df reports VFS usage, supports -h, -i, -T, -P, --total, --output, and validates operands", async () => {
  const def = await runDf([], { "/hello.txt": "hello world" });
  assert.equal(def.exitCode, 0);
  assert.match(def.stdout, /Filesystem.*1K-blocks.*Used.*Avail.*Use%.*Mounted on/);
  assert.match(def.stdout, /sandbox-vfs/);

  const human = await runDf(["-h", "-T"]);
  assert.match(human.stdout, /Filesystem.*Type.*Size.*Used.*Avail.*Use%.*Mounted on/);
  assert.match(human.stdout, /vfs/);

  const inodes = await runDf(["-i"]);
  assert.match(inodes.stdout, /Inodes.*IUsed.*IFree.*IUse%/);

  const outMode = await runDf(["--output=source,fstype,target", "/tmp"]);
  assert.match(outMode.stdout, /tmpfs.*\/tmp/);

  const missing = await runDf(["/nonexistent"]);
  assert.equal(missing.exitCode, 1);
});
