import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

test("empty filename reports ENOENT rather than resolving to cwd", async () => {
  const result = await run(["-C", ""]);
  assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: Buffer.from("hexdump: : No such file or directory\n").toString("hex") });
});

test("trailing slash on a regular file reports ENOTDIR", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", Buffer.from("A"));
  const result = await run(["-C", "a/"], undefined, {}, { fs });
  assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: Buffer.from("hexdump: a/: Not a directory\n").toString("hex") });
});

for (const [flag, fields] of [["b", "101 102"], ["c", "  A   B"], ["d", "  16961"], ["x", "   4241"]]) {
  test(`-${flag} renders the reported VFS bytes exactly`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Uint8Array.of(65, 66));
    assert.deepEqual(await run([`-${flag}`, "input"], undefined, {}, { fs }), {
      exitCode: 0, stdout: Buffer.from(`0000000 ${fields}${" ".repeat(56)}\n0000002\n`).toString("hex"), stderr: "",
    });
  });
}

test("character format escapes controls and preserves non-ASCII byte values", async () => {
  const input = Uint8Array.of(0, 7, 8, 9, 10, 11, 12, 13, 31, 32, 126, 127, 128, 255);
  const expected = "0000000  \\0  \\a  \\b  \\t  \\n  \\v  \\f  \\r 037       ~ 177 200 377        \n000000e\n";
  assert.deepEqual(await run(["-c"], input), { exitCode: 0, stdout: Buffer.from(expected).toString("hex"), stderr: "" });
});

test("mixed and repeated presets preserve option order and pad odd words", async () => {
  const row = "0000000    0041" + " ".repeat(56) + "\n";
  assert.deepEqual(await run(["-xxd"], Uint8Array.of(65)), {
    exitCode: 0, stdout: Buffer.from(row + row + "0000000   00065" + " ".repeat(56) + "\n0000001\n").toString("hex"), stderr: "",
  });
  assert.equal((await run(["-bc"], Uint8Array.of(65), { limits: { maxFormats: 1 } })).exitCode, 1);
});
