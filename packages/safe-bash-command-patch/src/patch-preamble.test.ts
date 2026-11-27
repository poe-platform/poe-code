import assert from "node:assert/strict";
import test from "node:test";
import { contents, run } from "./helpers.test.js";

for (const atomic of [false, true]) {
  for (const [name, input, strip, before, after] of [
    ["description", "Fix f\n\n--- f\n+++ f\n@@ -1 +1 @@\n-a\n+b\n", "-p0", "a\n", "b\n"],
    ["recursive diff", "Only in x: y\ndiff -ru x/f y/f\n--- x/f\t2020-01-01\n+++ y/f\t2020-01-01\n@@ -1 +1 @@\n-b\n+c\n", "-p1", "b\n", "c\n"],
  ] as const) {
    test(`patch accepts leading ${name}, atomic=${atomic}`, async () => {
      const result = await run("patch", [...(atomic ? ["--atomic"] : []), strip], {
        files: { f: before }, input: input,
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "patching file f\n");
      assert.equal(result.stderr, "");
      assert.equal(await contents(result.fs, "f"), after);
    });
  }
}
