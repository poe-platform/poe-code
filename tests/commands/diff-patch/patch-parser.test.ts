import assert from "node:assert/strict";
import test from "node:test";
import { contents, run } from "./helpers.js";

const contextHeader = "*** target\n--- target\n***************\n";
const normal = "1c1\n< old\n---\n> new\n";
const context = `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n! new\n`;
const unified = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";

for (const [name, before, input, after] of [
  ["normal new blank", "old\n", "1c1\n< old\n---\n>\n", "\n"],
  ["normal old blank", "\n", "1c1\n<\n---\n> new\n", "new\n"],
  ["context changed blank", "old\n", `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n!\n`, "\n"],
  ["context bare shared blank", "\nold\n", `${contextHeader}*** 1,2 ****\n\n! old\n--- 1,2 ----\n\n! new\n`, "\nnew\n"],
  ["context inserted blank", "", `${contextHeader}*** 0 ****\n--- 1 ----\n+\n`, "\n"],
  ["context removed blank", "\n", `${contextHeader}*** 1 ****\n-\n--- 0 ----\n`, ""],
] as const) {
  test(`suppressed ${name}: forward and reverse exact bytes`, async () => {
    const result = await run("patch", ["target"], { files: { target: before }, input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), after);
    const reversed = await run("patch", ["-R", "target"], { fs: result.fs, input });
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.equal(await contents(result.fs, "target"), before);
  });
}

for (const input of [
  "1c1\n< old\n---\n>\n\\ No newline at end of file\n",
  `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n!\n\\ No newline at end of file\n`,
  "1c1,2\n< old\n---\n>\n",
  `${contextHeader}*** 1 ****\n! old\n--- 1,2 ----\n!\n`,
]) {
  test(`suppressed blank still rejects incomplete/count error ${JSON.stringify(input)}`, async () => {
    const result = await run("patch", ["target"], { files: { target: "old\n" }, input });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}
