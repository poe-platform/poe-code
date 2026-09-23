import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

for (const digit of "123456789") {
  for (const pattern of ["foo", String.raw`\(foo\)`]) {
    test(`sed treats an escaped backslash before ${digit} literally with ${pattern}`, async () => {
      const result = await runVirtual("sed", { args: [`s/${pattern}/\\\\${digit}/`], stdin: "foo\n" });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.equal(result.stdout.toString(), `\\${digit}\n`);
      assert.equal(result.stderr.length, 0);
    });
  }
}

for (const program of [String.raw`/foo/s//\1/`, String.raw`s/foo/foo/;s//\1/`, String.raw`/foo/s//\\\1/`, String.raw`s/foo/\\\1/`]) {
  test(`sed rejects undefined replacement groups in ${program}`, async () => {
    const result = await runVirtual("sed", { args: [program], stdin: "foo\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.toString(), "sed: replacement references an undefined capture group\n");
  });
}

for (const [program, expected] of [
  [String.raw`/\(foo\)/s//\1/`, "foo\n"],
  [String.raw`/foo/s//\\1/`, "\\1\n"],
  [String.raw`s/\(foo\)/\\\1/`, "\\foo\n"],
  [String.raw`/\(foo\)/s//\\\1/`, "\\foo\n"],
] as const) {
  test(`sed accepts valid replacement escapes in ${program}`, async () => {
    const result = await runVirtual("sed", { args: [program], stdin: "foo\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
    assert.equal(result.stderr.length, 0);
  });
}
