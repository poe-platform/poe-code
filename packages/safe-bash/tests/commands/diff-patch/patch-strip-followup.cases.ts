import assert from "node:assert/strict";
import test from "node:test";
import { contents, replacement, run } from "./helpers.js";

for (const [header, strip] of [["./leaf", 1], ["a/./leaf", 2], ["a///./leaf", 2]] as const) {
  test(`followup GNU counts dot components before stripping ${header}`, async () => {
    const input = replacement.replaceAll("target", header);
    const args = [`-p${strip}`];
    const actual = await run("patch", args, { files: { leaf: "old\n" }, input });
    assert.equal(await contents(actual.fs, "leaf"), "new\n");
  });
}
