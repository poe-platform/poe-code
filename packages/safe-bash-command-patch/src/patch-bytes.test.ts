import assert from "node:assert/strict";
import test from "node:test";
import { run, replacement } from "./helpers.test.js";

// latin1 here constructs exact fixture bytes, including invalid UTF-8.
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));

test("ASCII hunk preserves untouched non-UTF-8 target bytes", async () => {
  const result = await run("patch", ["-f", "target"], {
    files: { target: bytes("old\n\xff\n") }, input: replacement,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await result.fs.readFile("/work/target"), bytes("new\n\xff\n"));
});

const patches = {
  unified: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+\xff\x80\xc0\n",
  normal: "1c1\n< old\n---\n> \xff\x80\xc0\n",
  context: "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! \xff\x80\xc0\n",
};

for (const [format, patch] of Object.entries(patches)) {
  for (const reverse of [false, true]) test(`${format} preserves non-UTF-8 hunk bytes${reverse ? " in reverse" : ""}`, async () => {
    const result = await run("patch", ["-f", ...(reverse ? ["-R"] : []), "target"], {
      files: { target: bytes(reverse ? "\xff\x80\xc0\n" : "old\n") },
      input: { async *[Symbol.asyncIterator]() { for (const byte of bytes(patch)) yield Uint8Array.of(byte); } },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await result.fs.readFile("/work/target"), bytes(reverse ? "old\n" : "\xff\x80\xc0\n"));
  });
  test(`${format} preserves non-UTF-8 bytes in rejects`, async () => {
    const result = await run("patch", ["-f", "target"], { files: { target: "other\n" }, input: bytes(patch) });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(Buffer.from(await result.fs.readFile("/work/target.rej")).includes(Buffer.from([255, 128, 192, 10])));
    assert.deepEqual(await result.fs.readFile("/work/target"), bytes("other\n"));
  });
}
