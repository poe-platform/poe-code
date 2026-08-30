import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem, type FsOptions, type WriteFileOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, snapshot } from "./helpers.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/sub", { recursive: true, mode: 0o755 });
  await fs.writeFile("/work/file", Uint8Array.of(0, 128, 255), { mode: 0o640 });
  await fs.link("/work/file", "/work/alias");
  await fs.symlink("file", "/work/link");
  return fs;
}

test("mktemp injected collision preserves every competing byte and bounds retries", async () => {
  const backing = await fixture();
  const attempts: string[] = [];
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "writeFile") return async (path: string, bytes: Uint8Array, options?: WriteFileOptions) => {
      assert.equal(options?.flag, "wx");
      assert.equal(options.mode, 0o600);
      assert.ok(options.signal);
      attempts.push(path);
      await target.writeFile(path, Uint8Array.of(71, attempts.length), { flag: "wx" });
      throw new FsError("EEXIST", { path });
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const before = await snapshot(backing);
  const result = await run("mktemp", ["candidate.XXXXXX"], fs, { limits: { maxAttempts: 4 } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /collision/u);
  assert.equal(result.stdout.length, 0);
  assert.equal(attempts.length, 4);
  for (const [index, path] of attempts.entries()) assert.deepEqual(await backing.readFile(path), Uint8Array.of(71, index + 1));
  for (const path of attempts) await backing.rm(path);
  assert.deepEqual(await snapshot(backing), before);
});

test("mktemp noncollision faults do not retry or create host files", async () => {
  const backing = await fixture();
  const before = await snapshot(backing);
  let calls = 0;
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "writeFile") return async () => { calls++; throw new FsError("EACCES", { path: "/work" }); };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("mktemp", ["-q", "candidate.XXXX"], fs);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "");
  assert.equal(calls, 1);
  assert.deepEqual(await snapshot(backing), before);
});

for (const command of ["chmod", "stat", "mktemp"]) test(`${command} blocked stdout abort preserves bounded effects and late rejection`, async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "caller abort, not a missing operand" });
  let entered!: () => void;
  let rejectWrite!: (error: unknown) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  const args = command === "chmod" ? ["-fv", "600", "file", "sub"] : command === "stat" ? ["-c%s", "file", "alias"] : ["private.XXXX"];
  const operation = run(command, args, fs, {}, { signal: controller.signal, write: async () => { entered(); await pending; } });
  const rejected = assert.rejects(operation, error => error === reason);
  await started;
  controller.abort(reason);
  await rejected;
  rejectWrite(new Error("late sink failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(0, 128, 255));
  assert.equal((await fs.stat("/work/sub")).mode & 0o777, 0o755);
  assert.equal((await fs.readdir("/work")).length, command === "mktemp" ? 5 : 4);
  if (command === "chmod") assert.equal((await fs.stat("/work/alias")).mode & 0o777, 0o600);
});

for (const command of ["chmod", "stat", "mktemp"]) test(`${command} pre-abort performs no effects`, async () => {
  const fs = await fixture();
  const before = await snapshot(fs);
  const controller = new AbortController();
  controller.abort(new FsError("ENOENT"));
  const args = command === "chmod" ? ["-f", "777", "file"] : command === "stat" ? ["file"] : ["new.XXXX"];
  await assert.rejects(run(command, args, fs, {}, { signal: controller.signal }), error => error === controller.signal.reason);
  assert.deepEqual(await snapshot(fs), before);
});

test("chmod recursive budgets stop effects; hardlink aliases retain shared mode and bytes", async () => {
  const fs = await fixture();
  const result = await run("chmod", ["-R", "700", "/work"], fs, { limits: { maxEntries: 2 } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /limit/u);
  assert.deepEqual(await fs.readFile("/work/alias"), Uint8Array.of(0, 128, 255));
  assert.equal((await fs.stat("/work/alias")).mode, (await fs.stat("/work/file")).mode);
  assert.equal(await fs.readlink("/work/link"), "file");
  const depth = await run("chmod", ["-R", "755", "/work"], fs, { limits: { maxDepth: 0 } });
  assert.equal(depth.exitCode, 1);
  assert.match(depth.stderr, /limit/u);
});

test("stat and mktemp output limits fail before output/creation; argument budget has no effects", async () => {
  const fs = await fixture();
  const before = await snapshot(fs);
  for (const [command, args] of [["stat", ["--printf=%1000000s", "file"]], ["mktemp", ["new.XXXX"]]] as const) {
    const result = await run(command, args, fs, { limits: { maxOutputBytes: 4 } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /limit/u);
  }
  assert.equal((await run("chmod", ["777", "file"], fs, { limits: { maxArgumentBytes: 3 } })).exitCode, 1);
  assert.deepEqual(await snapshot(fs), before);
});

test("chmod substitution detection refuses changed entry before mutation", async () => {
  const backing = await fixture();
  let reads = 0;
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "lstat") return async (path: string, options?: FsOptions) => {
      assert.ok(options?.signal);
      const stat = await target.lstat(path, options);
      return { ...stat, ino: ++reads };
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const before = await snapshot(backing);
  const result = await run("chmod", ["777", "file"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /changed/u);
  assert.deepEqual(await snapshot(backing), before);
});
