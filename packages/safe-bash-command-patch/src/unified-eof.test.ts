import assert from "node:assert/strict";
import test from "node:test";
import { contents, run } from "./helpers.test.js";

const input = "--- f\n+++ f\n@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n";

test("unified EOF supplies missing trailing context and reports fuzz", async () => {
  const result = await run("patch", ["-p0"], { files: { f: "a\nb\nc\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "patching file f\nHunk #1 succeeded at 1 with fuzz 1.\n");
  assert.equal(result.stderr, "");
  assert.equal(await contents(result.fs, "f"), "a\nB\nc\n");
});

test("missing trailing context still respects the fuzz limit", async () => {
  const result = await run("patch", ["-p0", "-F0"], { files: { f: "a\nb\nc\n" }, input });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(await contents(result.fs, "f"), "a\nb\nc\n");
});

for (const malformed of [input.replace("+1,4", "+1,5"), `${input}invalid\n`, input.slice(0, -1)]) {
  test(`malformed EOF is rejected: ${JSON.stringify(malformed)}`, async () => {
    const result = await run("patch", ["-p0"], { files: { f: "a\nb\nc\n" }, input: malformed });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "f"), "a\nb\nc\n");
  });
}
