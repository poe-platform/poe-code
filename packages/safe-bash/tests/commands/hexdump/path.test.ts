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
