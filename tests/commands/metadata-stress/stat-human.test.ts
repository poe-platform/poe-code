import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/index.js";
import { run } from "./helpers.js";

async function fixture(milliseconds: number, missing?: keyof FileStat): Promise<FileSystem> {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work");
  await backing.writeFile("/work/file", Uint8Array.of(0, 255, 10));
  return new Proxy(backing, { get(target, property) {
    if (property === "lstat") return async (path: string): Promise<FileStat> => {
      const stat = { ...await target.lstat(path), atimeMs: milliseconds, mtimeMs: milliseconds, ctimeMs: milliseconds, birthtimeMs: milliseconds };
      return new Proxy(stat, { get(value, field) { return field === missing ? undefined : Reflect.get(value, field); } });
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

const cases: readonly (readonly [number, string])[] = [
  [0, "1970-01-01 00:00:00.000000000"],
  [-0, "1970-01-01 00:00:00.000000000"],
  [1000, "1970-01-01 00:00:01.000000000"],
  [-1000, "1969-12-31 23:59:59.000000000"],
  [1, "1970-01-01 00:00:00.001000000"],
  [-1, "1969-12-31 23:59:59.999000000"],
  [1001, "1970-01-01 00:00:01.001000000"],
  [-1001, "1969-12-31 23:59:58.999000000"],
  [0.125, "1970-01-01 00:00:00.000125000"],
  [-0.125, "1969-12-31 23:59:59.999875000"],
  [123.456789, "1970-01-01 00:00:00.123456789"],
  [-123.456789, "1969-12-31 23:59:59.876543211"],
  [0.000001, "1970-01-01 00:00:00.000000001"],
  [-0.000001, "1969-12-31 23:59:59.999999999"],
  [0.00000049, "1970-01-01 00:00:00.000000000"],
  [-0.00000049, "1970-01-01 00:00:00.000000000"],
  [0.0000005, "1970-01-01 00:00:00.000000001"],
  [-0.0000005, "1969-12-31 23:59:59.999999999"],
  [Number.MIN_VALUE, "1970-01-01 00:00:00.000000000"],
  [-Number.MIN_VALUE, "1970-01-01 00:00:00.000000000"],
  [999.99999949, "1970-01-01 00:00:00.999999999"],
  [999.9999995, "1970-01-01 00:00:01.000000000"],
  [-999.99999949, "1969-12-31 23:59:59.000000001"],
  [-999.9999995, "1969-12-31 23:59:59.000000000"],
  [86399999.9999995, "1970-01-02 00:00:00.000000000"],
  [-86399999.9999995, "1969-12-31 00:00:00.000000000"],
  [0.1 + 0.2, "1970-01-01 00:00:00.000300000"],
  [946684800123, "2000-01-01 00:00:00.123000000"],
  [1700000000000, "2023-11-14 22:13:20.000000000"],
  [1700000000123, "2023-11-14 22:13:20.123000000"],
  [1700000000123.456, "2023-11-14 22:13:20.123456000"],
  [1700000000123.4568, "2023-11-14 22:13:20.123456800"],
  [-1700000000123.456, "1916-02-18 01:46:39.876544000"],
  [8640000000000000, "+275760-09-13 00:00:00.000000000"],
  [-8640000000000000, "-271821-04-20 00:00:00.000000000"],
];

for (const [milliseconds, expected] of cases) test(`stat human numeric timestamp ${Object.is(milliseconds, -0) ? "-0" : milliseconds}`, async () => {
  const fs = await fixture(milliseconds);
  const result = await run("stat", ["--printf=%x|%y|%z|%w", "file"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), Array(4).fill(`${expected} +0000`).join("|"));
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(0, 255, 10));
});

test("stat routed whole-second %Y:%y and historical author timestamps use GNU nine columns", async () => {
  const result = await run("stat", ["-c", "%Y:%y", "file"], await fixture(1700000000000));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "1700000000:2023-11-14 22:13:20.000000000 +0000\n");
  const report = await run("stat", ["file"], await fixture(946684800123));
  assert.equal(report.exitCode, 0, report.stderr);
  for (const label of ["Access", "Modify", "Change", " Birth"]) assert.ok(report.stdout.toString().includes(`${label}: 2000-01-01 00:00:00.123000000 +0000`));
});

test("stat human missing birth remains a dash; missing required time is unsupported", async () => {
  const birth = await run("stat", ["-c%w", "file"], await fixture(0, "birthtimeMs"));
  assert.equal(birth.exitCode, 0, birth.stderr);
  assert.equal(birth.stdout.toString(), "-\n");
  for (const [format, field] of [["%x", "atimeMs"], ["%y", "mtimeMs"], ["%z", "ctimeMs"], ["%W", "birthtimeMs"]] satisfies [string, keyof FileStat][]) {
    const result = await run("stat", [`--printf=prefix${format}`, "file"], await fixture(0, field));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /ENOTSUP/u);
  }
});

test("stat human invalid and out-of-Date-range timestamps fail before operand output", async () => {
  for (const milliseconds of [NaN, Infinity, -Infinity, 8640000000000001, -8640000000000001, Number.MAX_VALUE]) for (const format of ["%x", "%y", "%z", "%w"]) {
    const result = await run("stat", [`--printf=prefix${format}`, "file"], await fixture(milliseconds));
    assert.equal(result.exitCode, 1, `${milliseconds} ${format}`);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /EIO/u);
  }
});

test("stat human width, string precision, and exact output byte limits remain bounded", async () => {
  const fs = await fixture(0.125);
  const expected = "1970-01-01 00:00:00.000125000 +0000";
  assert.equal(expected.length, 35);
  const exact = await run("stat", ["--printf=%y", "file"], fs, { limits: { maxOutputBytes: 35 } });
  assert.equal(exact.exitCode, 0, exact.stderr);
  assert.equal(exact.stdout.toString(), expected);
  const aligned = await run("stat", ["--printf=[%38y][%-38y][%.23y]", "file"], fs);
  assert.equal(aligned.exitCode, 0, aligned.stderr);
  assert.equal(aligned.stdout.toString(), `[   ${expected}][${expected}   ][${expected.slice(0, 23)}]`);
  for (const [argument, limit] of [["--printf=%y", 34], ["-c%y", 35], ["--printf=%36y", 35], ["--printf=%.100000y", 35]] satisfies [string, number][]) {
    const result = await run("stat", [argument, "file"], fs, { limits: { maxOutputBytes: limit } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /limit/u);
  }
  const newline = await run("stat", ["-c%y", "file"], fs, { limits: { maxOutputBytes: 36 } });
  assert.equal(newline.exitCode, 0, newline.stderr);
  assert.equal(newline.stdout.toString(), `${expected}\n`);
});
