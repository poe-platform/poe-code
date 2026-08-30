import assert from "node:assert/strict";
import test from "node:test";
import { contents, native, replacement, run } from "./helpers.js";

for (const [header, strip] of [["./leaf", 1], ["a/./leaf", 2], ["a///./leaf", 2]] as const) {
  test(`followup GNU counts dot components before stripping ${header}`, async () => {
    const input = replacement.replaceAll("target", header);
    const args = [`-p${strip}`];
    const expected = await native("patch", ["--batch", ...args], { leaf: "old\n" }, input);
    const actual = await run("patch", args, { files: { leaf: "old\n" }, input });
    assert.equal(expected.exitCode, 0, expected.stderr);
    assert.equal(actual.exitCode, expected.exitCode, actual.stderr);
    assert.equal(actual.stdout, expected.stdout);
    assert.equal(await contents(actual.fs, "leaf"), "new\n");
  });
}
