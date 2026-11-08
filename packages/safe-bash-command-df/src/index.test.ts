import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createDfCommand, evalSyncDf, type DfCommandsOptions } from "./index.js";

async function runDf(args: string[], files: Record<string, string> = {}, options: DfCommandsOptions = {}) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  for (const [p, c] of Object.entries(files)) {
    await fs.mkdir(p.slice(0, p.lastIndexOf("/")) || "/", { recursive: true });
    await fs.writeFile(p, new TextEncoder().encode(c));
  }
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createDfCommand(options);
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
  const errors: Uint8Array[] = [];
  for await (const c of stderr.readable) errors.push(c);
  return { exitCode: res.exitCode, stdout: Buffer.concat(chunks).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") };
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

test("df resolves configured mount points (/tmp, /proc, /dev) on a fresh VFS without prior mkdir", async () => {
  const fs = createMemoryFileSystem();
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createDfCommand();
  const res = await cmd.execute({
    command: "df",
    args: createCommandArguments(["--output=file,source,target", "/tmp"]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    signal: new AbortController().signal
  });
  await stdout.close();
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const c of stdout.readable) chunks.push(c);
  const out = Buffer.concat(chunks).toString("utf8");
  assert.equal(res.exitCode, 0);
  assert.match(out, /\/tmp\s+tmpfs\s+\/tmp/);
});


test("df attributes bytes and inodes to their mount without counting nested mounts twice", async () => {
  const result = await runDf(["-k", "--output=source,used,iused", "/", "/tmp", "--total"], {
    "/root.bin": "x".repeat(1024),
    "/tmp/big.bin": "x".repeat(1024 * 1024),
  });
  assert.equal(result.exitCode, 0);
  const rows = result.stdout.trim().split("\n").slice(1).map(line => line.trim().split(/\s+/));
  assert.deepEqual(rows, [
    ["sandbox-vfs", "5", "2"],
    ["tmpfs", "1028", "2"],
    ["total", "1033", "4"],
  ]);
});

test("df fails without partial output when its shared entry budget is exceeded", async () => {
  for (const maxVisitedEntries of [1, 2, 3]) {
    const result = await runDf(["/"], { "/root.bin": "x", "/tmp/file": "y" }, {
      limits: { maxVisitedEntries },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "df: visited entry budget exceeded\n");
  }
});

test("df accepts an exact entry budget and counts directories only once", async () => {
  const result = await runDf(["--output=source,iused"], { "/tmp/file": "x" }, {
    limits: { maxVisitedEntries: 3 },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
});

test("df uses supplied mount accounting without traversing the VFS", async () => {
  const result = await runDf(["--output=source,used,iused"], { "/tmp/file": "x" }, {
    limits: { maxVisitedEntries: 1 },
    mounts: [{ source: "custom", target: "/", fstype: "vfs", totalBytes: 8192,
      usedBytes: 1024, totalInodes: 10, usedInodes: 2 }],
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout.trim().split("\n")[1]!.trim().split(/\s+/), ["custom", "1", "2"]);
});

test("df excludes pseudo mounts and keeps similarly named directories on root", async () => {
  const result = await runDf(["--output=source,used,iused"], {
    "/tmp/nested/file": "x".repeat(1024),
    "/tmp-other/file": "x".repeat(1024),
    "/proc/file": "x".repeat(1024 * 1024),
  }, { limits: { maxVisitedEntries: 6 } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout.trim().split("\n").slice(1).map(line => line.trim().split(/\s+/)), [
    ["sandbox-vfs", "9", "3"],
    ["tmpfs", "9", "3"],
  ]);
});

for (const [operand, bytes] of [["/a", 2], ["/é😀", 7], ["/\ud800", 4], ["/\udc00", 4]] as const) {
  test(`sync df accounts UTF-8 argument bytes without Buffer: ${JSON.stringify(operand)}`, () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
    const inspect = () => ({ type: "directory" as const, size: 0, children: [] });
    const admitted = createDfCommand({ limits: { maxArgumentBytes: bytes } });
    const refused = createDfCommand({ limits: { maxArgumentBytes: bytes - 1 } });
    try {
      Object.defineProperty(globalThis, "Buffer", { configurable: true, writable: true, value: undefined });
      assert.match(evalSyncDf([operand], "/", {}, inspect, admitted.execute)!, /sandbox-vfs/);
      assert.equal(evalSyncDf([operand], "/", {}, inspect, refused.execute), undefined);
    } finally {
      Object.defineProperty(globalThis, "Buffer", descriptor);
    }
  });
}
