import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { native, run } from "./helpers.js";

describe("GNU 3.12 cmp oracle", { skip: process.env.CMP_ORACLE ? false : "GNU prerequisite unavailable: set CMP_ORACLE explicitly" }, () => {

test("GNU 3.12 oracle prerequisite", async () => {
  const result = await native(["--version"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^cmp \(GNU diffutils\) 3\.12\n/);
});

const invalid = [[], ["-s"], ["--"], ["-z"], ["-n"], ["--bytes"], ["--bad"], ["--ver"], ["--print"],
  ["--quiet=1"], ["-ls"], ["-sl"], ["-n", "-1"], ["-i", "1:"], ["-i", "1:2:3"],
  ["left", "right", "0", "0", "extra"], ["left", "right", "bad"],
  ["--qui=x"], ["--he=x"], ["--print=1"], ["--=x"],
  ["", "-"], ["~safe-bash-cmp-missing", "-"],
  ...["", "08", "0b10", "1b", "1 ", "-1", "1Ki", ":1", "0x", "0xK"].map(value => ["-i", value, "-", "-"]),
];
for (const args of invalid) test(`native diagnostics ${JSON.stringify(args)}`, async () => {
  assert.deepEqual(await run(args), await native(args));
});

const flags = [[], ["-b"], ["-c"], ["-l"], ["-bl"], ["-s"], ["--print-bytes"], ["--print-chars"],
  ["--verbose"], ["--quiet"], ["--silent"], ["--by=3"], ["-n0"], ["-n2", "-n8"],
  ["-i1:2"], ["-i2:1", "-i0:0"], ["--ignore-initial=1"], ["-ln3"], ["-bln3"],
];
const pairs = [
  [Buffer.from(""), Buffer.from("x")], [Buffer.from("abc\n"), Buffer.from("abc\n")],
  [Buffer.from("a\nb"), Buffer.from("a\nc")], [Buffer.from([0, 127, 128, 255]), Buffer.from([1, 128, 127, 254])],
  [Buffer.from("a\n"), Buffer.from("a\nb")], [Buffer.from("abcd"), Buffer.from("ab")],
];
test("native pipe differential: all modes, binary, EOF, skip and count", async () => {
  for (const options of flags) for (const [left, right] of pairs) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dev/fd", { recursive: true });
    await fs.writeFile("/dev/fd/3", left!);
    const stat = fs.stat.bind(fs);
    fs.stat = async (path, options) => ({ ...await stat(path, options), size: -1 });
    const args = [...options, "/dev/fd/3", "-"];
    assert.deepEqual(await run(args, left, right, { fs }), await native(args, left, right), JSON.stringify(args));
  }
});

test("native stdin twice, abbreviated options, and numeric grammar", async () => {
  for (const options of [[], ["-i1:2"], ["-i1Y:0"], ["--qui"], ["--si"],
    ...["+1", " 1", "-0", "010", "0x10", "K", "kB", "1KiB", "1KB", "1kD", "1Y", "99999999999999999999999999999999"].map(value => ["-i", value])]) {
    const args = [...options, "-", "-"];
    assert.deepEqual(await run(args), await native(args, undefined, Buffer.from("abcdef")), JSON.stringify(args));
  }
});

test("native path and value quoting in C locale", async () => {
  for (const value of ["a+b", "a:b", "a,b", "a=b", "a@b", "a%b", "a~b", "a]b", "a b", "a'b", "a\\b", "a\nb", "a\tb", "é", "a'b$c"]) {
    for (const args of [[`/safe-bash-cmp-nonexistent/${value}`, "-"], ["-i", value, "-", "-"]]) {
      assert.deepEqual(await run(args), await native(args), JSON.stringify(args));
    }
  }
});

test("native positional shell-special pathname quoting", async () => {
  for (const value of ["a#b", "a{b", "a}b", "#ab", "~ab", "{", "}", "{ab", "ab}"]) {
    for (const path of [value, `/safe-bash-cmp-nonexistent/${value}`]) {
      const args = [path, "-"];
      assert.deepEqual(await run(args), await native(args), JSON.stringify(args));
    }
  }
});

test("native overflow diagnostics and an already-saturated initial skip", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  await fs.writeFile("/dev/fd/3", Buffer.from("abc"));
  for (const options of [["-i1Y"], ["-si1Y"], ["-i9223372036854775807", "-i1Y"]]) {
    const args = [...options, "-", "/dev/fd/3"];
    assert.deepEqual(await run(args, undefined, Buffer.from("abc"), { fs }), await native(args, Buffer.from("abc")), JSON.stringify(args));
  }
});

test("native all 256 byte displays", async () => {
  const left = Uint8Array.from({ length: 256 }, (_, index) => index);
  const right = Uint8Array.from(left, byte => 255 - byte);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  await fs.writeFile("/dev/fd/3", left);
  for (const flag of ["-l", "-bl", "--print-chars"]) {
    const args = [flag, "-n256", "/dev/fd/3", "-"];
    assert.deepEqual(await run(args, left, right, { fs }), await native(args, left, right));
  }
});

test("native GNU option permutation and POSIXLY_CORRECT", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  await fs.writeFile("/dev/fd/3", Buffer.from("a"));
  for (const env of [{ LC_ALL: "C" }, { LC_ALL: "C", POSIXLY_CORRECT: "" }]) {
    for (const args of [["/dev/fd/3", "-", "-n0"], ["-n0", "/dev/fd/3", "-"], ["--", "/dev/fd/3", "-", "0", "0"]]) {
      assert.deepEqual(await run(args, Buffer.from("a"), Buffer.from("b"), { fs, env }), await native(args, Buffer.from("a"), Buffer.from("b"), env));
    }
  }
});

test("native first-difference chunk boundaries and skipped newlines", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  for (const position of [16383, 16384, 65535, 65536]) {
    const left = Buffer.alloc(65538, 97), right = Buffer.from(left);
    left[0] = right[0] = 10;
    left[65534] = right[65534] = 10;
    right[position] = 98;
    await fs.writeFile("/dev/fd/3", left);
    const args = ["-bi1", "/dev/fd/3", "-"];
    assert.deepEqual(await run(args, left, right, { fs }), await native(args, left, right), String(position));
  }
});
});
