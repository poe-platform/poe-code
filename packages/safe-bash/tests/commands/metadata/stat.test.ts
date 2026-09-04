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

test("stat preserves escape bytes, digit limits and literal fallback", async () => {
  const fs = await fixture();
  const cases: [string, number[]][] = [
    [String.raw`\a\b\e\f\n\r\t\v\\`, [7, 8, 27, 12, 10, 13, 9, 11, 92]],
    ["\\", [92]],
    [String.raw`\q\c\8\9\X41`, [...Buffer.from(String.raw`\q\c\8\9\X41`)]],
    [String.raw`\x`, [92, 120]],
    [String.raw`\xG`, [92, 120, 71]],
    [String.raw`\x0\x7\xF\xf`, [0, 7, 15, 15]],
    [String.raw`\x00\x7f\x80\xFF`, [0, 127, 128, 255]],
    [String.raw`\x123\x1G`, [18, 51, 1, 71]],
    [String.raw`\0\7\07\77`, [0, 7, 7, 63]],
    [String.raw`\000\377\400\777`, [0, 255, 0, 255]],
    [String.raw`\1234\08\778`, [83, 52, 0, 56, 63, 56]],
    [String.raw`\%s:%%:\x25n:\045s`, [...Buffer.from("\\4:%:%n:%s")]],
    [String.raw`\😀\n`, [...Buffer.from("\\😀\n")]],
  ];
  for (const [format, expected] of cases) {
    const result = await runMetadata("stat", ["--printf", format, "file"], fs);
    assert.equal(result.exitCode, 0, format);
    assert.deepEqual([...result.stdoutBytes], expected, format);
    const literal = await runMetadata("stat", ["-c", format.replaceAll("%", "%%"), "file"], fs);
    assert.equal(literal.stdout, `${format}\n`, format);
  }
  assert.equal((await runMetadata("stat", ["--printf", "\\%", "file"], fs)).exitCode, 1);
});

test("stat scans repeated escapes without slicing format suffixes", async context => {
  const fs = await fixture();
  const repetitions = 1024;
  const format = String.raw`\n\x41\377\q%%`.repeat(repetitions);
  const originalSlice = String.prototype.slice;
  let suffixSlices = 0;
  const slice = context.mock.method(String.prototype, "slice", function(this: string, start: number, end?: number) {
    if (this === format && end === undefined) suffixSlices++;
    return originalSlice.call(this, start, end);
  });
  try {
    const result = await runMetadata("stat", ["--printf", format, "file"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Buffer.concat(Array.from({ length: repetitions }, () => Buffer.from([10, 65, 255, 92, 113, 37]))));
    assert.equal(suffixSlices, 0);
  } finally {
    slice.mock.restore();
  }
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

test("stat rejects long invalid format directives without regexp backtracking", async context => {
  const fs = await fixture();
  const format = `%${"0".repeat(32_000)}!`;
  const originalExec = RegExp.prototype.exec;
  let directiveRegexCalls = 0;
  const exec = context.mock.method(RegExp.prototype, "exec", function(this: RegExp, input: string) {
    if (input === format) {
      directiveRegexCalls++;
      return null;
    }
    return originalExec.call(this, input);
  });
  try {
    const result = await runMetadata("stat", ["-c", format, "file"], fs);
    assert.equal(result.exitCode, 1);
    assert.equal(directiveRegexCalls, 0);
  } finally {
    exec.mock.restore();
  }
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
