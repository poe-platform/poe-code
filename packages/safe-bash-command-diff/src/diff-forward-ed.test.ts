import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.test-support.js";

for (const buffered of [false, true]) for (const flag of ["-f", "--forward-ed"]) {
  for (const [name, old, next, expected] of [
    ["replace and append", "a\nb\nc\n", "a\nX\nc\nd\n", "c2\nX\n.\na3\nd\n.\n"],
    ["ranges and literal dot", "a\nb\nc\nd\n", "x\ny\nc\n.\n", "c1 2\nx\ny\n.\nc4\n.\n.\n"],
    ["delete range", "a\nb\nc\n", "c\n", "d1 2\n"],
    ["prepend", "tail\n", "first\ntail\n", "a0\nfirst\n.\n"],
    ["equal", "a\n", "a\n", ""],
  ] as const) {
    test(`forward ed ${flag}, buffered=${buffered}: ${name}`, async () => {
      const result = await run("diff", [flag, "-I", "NEVER_MATCH", "old", "new"], {
        buffered, files: { old: old, new: next },
      });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, {
        stdout: expected, stderr: "", exitCode: old === next ? 0 : 1,
      });
    });
  }
  test(`forward ed ${flag}, buffered=${buffered}: output budget`, async () => {
    const result = await run("diff", [flag, "-I", "NEVER_MATCH", "old", "new"], {
      buffered, files: { old: "a\n", new: "b\n" }, options: { maxOutputBytes: 1 },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /limit/u);
  });
  test(`forward ed ${flag}: conflicts with ed`, async () => {
    const result = await run("diff", [flag, "-e", "old", "new"]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /conflicting output format/u);
  });
}
