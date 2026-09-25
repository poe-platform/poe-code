import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/index.js";
import { runMetadata } from "./helpers.js";
import { Shell } from "../../../src/shell/shell.js";
import { createStatCommand } from "../../../src/commands/metadata/stat.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(0, 255, 13, 10), { mode: 0o751 });
  await fs.utimes("/work/file", -1, 946684800123);
  return fs;
}

test("stat terse options print GNU field order and truthfully mark unavailable metadata", async () => {
  const backing = await fixture();
  const metadata: FileStat = { type: "file", size: 3, allocatedBytes: 4096, mode: 0o100644,
    uid: 12, gid: 34, dev: 0x10301, ino: 567, nlink: 1, rdevMajor: 0, rdevMinor: 0,
    atimeMs: 1000, mtimeMs: 2000, ctimeMs: 3000, birthtimeMs: 4000, ioBlockSize: 4096 };
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "lstat") return async () => metadata;
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  for (const option of ["--terse", "-t"]) {
    const result = await runMetadata("stat", [option, "file", "second file"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "file 3 8 81a4 12 34 10301 567 1 0 0 1 2 3 4 4096\nsecond file 3 8 81a4 12 34 10301 567 1 0 0 1 2 3 4 4096\n");
    const memory = await runMetadata("stat", [option, "file"], backing);
    assert.equal(memory.exitCode, 0, memory.stderr);
    const fields = memory.stdout.trimEnd().split(" ");
    assert.equal(fields.length, 16);
    assert.equal(fields[2], "?");
    assert.equal(fields[9], "?");
    assert.equal(fields[10], "?");
  }
});

test("stat custom formats override terse regardless of option order", async () => {
  const fs = await fixture();
  for (const args of [["-t", "-c%s"], ["-c%s", "--terse"], ["--terse", "--printf=%s\\n"], ["--printf=%s\\n", "-t"]]) {
    const result = await runMetadata("stat", [...args, "file"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "4\n");
  }
  assert.equal((await runMetadata("stat", ["-Ltc%s", "file"], fs)).stdout, "4\n");
});

test("stat terse through Shell preserves link following, later operands, limits and missing fields", async context => {
  const fs = await fixture();
  await fs.symlink("file", "/work/link");
  const shell = new Shell({ fs, cwd: "/work" });
  context.after(() => shell.dispose());
  shell.register(createStatCommand());
  for (const [options, size] of [["-t", 4], ["-Lt", 4]] as const) {
    const result = await shell.exec(`stat ${options} missing link file`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /missing/u);
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0]!.split(" ")[1], String(size));
    assert.equal(lines[1]!.split(" ")[0], "file");
    assert.equal(lines[0]!.split(" ")[3], options === "-t" ? "a1ff" : "81e9");
  }
  assert.equal((await runMetadata("stat", ["-t", "file"], fs, { limits: { maxOutputBytes: 1 } })).exitCode, 1);
  const unknown: FileSystem = new Proxy(fs, { get(target, property) {
    if (property === "lstat") return async () => ({ type: "file", size: 4, mode: 0o100644,
      atimeMs: 0, mtimeMs: 0, ctimeMs: 0 } satisfies FileStat);
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await runMetadata("stat", ["-t", "file"], unknown);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "file 4 ? 81a4 ? ? ? ? ? ? ? 0 0 0 ? ?\n");
  const unsupported = await runMetadata("stat", ["-ft", "file"], fs);
  assert.equal(unsupported.exitCode, 1);
  assert.match(unsupported.stderr, /ENOTSUP/u);
});

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
  for (const args of [["-q", "file"], ["-c"], ["-c", "%", "file"], ["-c", "%10000000n", "file"]]) {
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

test("stat filesystem mode reports the backend type with format and printf semantics", async () => {
  const fs = await fixture();
  for (const option of ["--file-system", "-f"]) {
    const result = await runMetadata("stat", [option, "--format=%T", "."], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "memory\n");
  }
  assert.equal((await runMetadata("stat", ["-fc", "%n:%10T:%%", "file"], fs)).stdout, "file:    memory:%\n");
  assert.equal((await runMetadata("stat", ["-f", "--printf=%T\\n", "."], fs)).stdout, "memory\n");
  assert.equal((await runMetadata("stat", ["-f", "."], fs)).stdout, "  File: .\n  Type: memory\n");
});

test("stat filesystem mode follows links, validates operands and refuses unavailable fields", async () => {
  const fs = await fixture();
  await fs.symlink("file", "/work/link");
  await fs.symlink("missing", "/work/dangling");
  const result = await runMetadata("stat", ["-f", "-c%T", "missing", "link", "dangling"], fs);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "memory\n");
  for (const code of ["s", "b", "a", "f", "i", "t", "S", "c", "d", "l"]) {
    const unsupported = await runMetadata("stat", ["-f", `-c%T:%${code}`, "."], fs);
    assert.equal(unsupported.exitCode, 1, code);
    assert.equal(unsupported.stdout, "", code);
    assert.match(unsupported.stderr, /ENOTSUP/u);
  }
  const unknown: FileSystem = new Proxy(fs, { get(target, property) {
    if (property === "stat") return async (path: string) => {
      const { filesystemType: ignoredType, ...stat } = await target.stat(path);
      return stat;
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const unavailable = await runMetadata("stat", ["-f", "-c%T", "."], unknown);
  assert.equal(unavailable.exitCode, 1);
  assert.equal(unavailable.stdout, "");
  assert.match(unavailable.stderr, /ENOTSUP/u);
});

test("stat supports %B block size and escaped double quotes in --printf", async () => {
  const fs = await fixture();
  assert.equal((await runMetadata("stat", ["-c", "%B", "file"], fs)).stdout, "512\n");
  assert.equal((await runMetadata("stat", ["--printf", "\"%s\"", "file"], fs)).stdout, "\"4\"");
});
