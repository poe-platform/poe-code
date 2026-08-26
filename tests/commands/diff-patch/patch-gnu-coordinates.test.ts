import assert from "node:assert/strict";
import test from "node:test";
import { contents, run } from "./helpers.js";
import { nativeGNU } from "./patch-gnu-native.js";

const headers = "--- target\n+++ target\n";
const cases = [
  ["asymmetric non-EOF", "prefix\nhead\nold\ntail\n", "@@ -1,2 +1,2 @@\n head\n-old\n+new\n"],
  ["asymmetric EOF", "prefix\nhead\nold\n", "@@ -1,2 +1,2 @@\n head\n-old\n+new\n"],
  ["asymmetric non-BOF", "prefix\nold\ntail\n", "@@ -1,2 +1,2 @@\n-old\n+new\n tail\n"],
  ["asymmetric BOF", "old\ntail\nextra\n", "@@ -1,2 +1,2 @@\n-old\n+new\n tail\n"],
  ["unequal fuzz edges", "changed\nhead\nold\nTAIL\nextra\n", "@@ -1,4 +1,4 @@\n expected\n head\n-old\n+new\n tail\n"],
  ["noncanonical destination", "a\nb\nc\n", "@@ -1 +2 @@\n-a\n+A\n"],
  ["noncanonical insertion", "a\nb\nc\n", "@@ -2,0 +2 @@\n+new\n"],
  ["noncanonical deletion", "a\nb\nc\n", "@@ -2 +2,0 @@\n-a\n"],
  ["noncanonical opposite side", "a\nb\nc\n", "@@ -1,0 +3 @@\n+new\n"],
] as const;

for (const [name, before, hunk] of cases) for (const fuzz of [0, 1, 2]) {
  test(`pinned GNU coordinates/fuzz: ${name} -F${fuzz}`, async () => {
    const input = headers + hunk;
    const args = ["--batch", "-p0", `-F${fuzz}`];
    const expected = await nativeGNU(args, { target: before }, input);
    const actual = await run("patch", args, { files: { target: before }, input });
    assert.equal(actual.exitCode, expected.exitCode, actual.stderr);
    assert.equal(await contents(actual.fs, "target"), expected.files.target);
  });
}
