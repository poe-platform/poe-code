import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/index.js";
import { runMetadata } from "./helpers.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(0, 255, 13, 10), { mode: 0o751 });
  await fs.utimes("/work/file", -1, 946684800123);
  return fs;
}

test("stat prints common mode, type, size, name and UTC millisecond timestamps", async () => {
  const fs = await fixture();
  const result = await runMetadata("stat", ["-c", "%n:%s:%a:%A:%F:%x:%y:%Y:%.3Y:%.3X:%%", "file"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "file:4:751:-rwxr-x--x:regular file:1969-12-31 23:59:59.999000000 +0000:2000-01-01 00:00:00.123000000 +0000:946684800:946684800.123:-0.001:%\n");
});

test("stat lstat/default and -L distinguish links, including dangling links", async () => {
  const fs = await fixture();
  await fs.symlink("file", "/work/link");
  await fs.symlink("missing", "/work/dangling");
  assert.equal((await runMetadata("stat", ["-c", "%N:%F", "link"], fs)).stdout, "'link' -> 'file':symbolic link\n");
  assert.equal((await runMetadata("stat", ["-Lc", "%N:%s", "link"], fs)).stdout, "'link':4\n");
  assert.equal((await runMetadata("stat", ["-c%F", "dangling"], fs)).stdout, "symbolic link\n");
  assert.equal((await runMetadata("stat", ["-Lc%F", "dangling"], fs)).exitCode, 1);
});

test("stat printf escapes, padding, option precedence and literal paths", async () => {
  const fs = await fixture();
  await fs.rename("/work/file", "/work/-x a\n");
  const result = await runMetadata("stat", ["--printf=[%#05a]\\t[%-5s]\\n", "--", "-x a\n"], fs);
  assert.equal(result.stdout, "[00751]\t[4    ]\n");
  assert.equal((await runMetadata("stat", ["--printf=%s", "-c%n", "--", "-x a\n"], fs)).stdout, "-x a\n\n");
  assert.equal((await runMetadata("stat", ["-c%N", "--", "-x a\n"], fs)).stdout, "$'-x a\\n'\n");
  const binary = await runMetadata("stat", ["--printf=\\377\\x80\\0%s", "--", "-x a\n"], fs);
  assert.deepEqual([...binary.stdoutBytes], [255, 128, 0, 52]);
});

test("stat missing fields fail rather than becoming zero; mutation capability does not erase provided modes", async () => {
  const backing = await fixture();
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "capabilities") return { ...target.capabilities, permissions: false };
    if (property === "lstat") return async (path: string) => {
      const { ino: ignoredIno, uid: ignoredUid, birthtimeMs: ignoredBirthtimeMs, ...stat } = await target.lstat(path);
      return stat satisfies FileStat;
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  for (const format of ["%i", "%u", "%W", "%U", "%b", "%.9Y"]) {
    const result = await runMetadata("stat", ["-c", format, "file"], fs);
    assert.equal(result.exitCode, 1, format);
    assert.match(result.stderr, /ENOTSUP/u);
    assert.equal(result.stdout, "");
  }
  const fallback = await runMetadata("stat", ["file"], fs);
  assert.equal(fallback.exitCode, 0, fallback.stderr);
  assert.match(fallback.stdout, /Mode: 751/u);
  assert.equal((await runMetadata("stat", ["-c%a", "file"], fs)).stdout, "751\n");
  assert.match(fallback.stdout, /Birth: -/u);
});

test("stat limits, invalid options and cancellation have nonzero/abort outcomes", async () => {
  const fs = await fixture();
  for (const args of [["-f", "file"], ["-c"], ["-c", "%", "file"], ["-c", "%10000000n", "file"]]) {
    const result = await runMetadata("stat", args, fs);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  }
  assert.equal((await runMetadata("stat", ["-c%s", "file"], fs, { limits: { maxOutputBytes: 1 } })).exitCode, 1);
  const controller = new AbortController();
  const reason = new Error("stop stat");
  controller.abort(reason);
  await assert.rejects(runMetadata("stat", ["file"], fs, {}, controller.signal), error => error === reason);
});

test("stat formats supplied numeric metadata on memory VFS", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(0, 1, 255));
  assert.equal((await runMetadata("stat", ["-c", "%s:%n", "file"], fs)).stdout, "3:file\n");
  const stat = await fs.stat("/work/file");
  const result = await runMetadata("stat", ["-c", "%i:%h:%u:%g:%d", "file"], fs);
  assert.equal(result.stdout, `${stat.ino}:${stat.nlink}:${stat.uid}:${stat.gid}:${stat.dev}\n`);
});
