import assert from "node:assert/strict";
import test from "node:test";
import { contents, native, replacement, run } from "./helpers.js";

const normal = "1c1\n< old\n---\n> new\n";
const contextHunk = "***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n";
const unifiedHunk = replacement.slice(replacement.indexOf("@@"));

for (const [format, header, hunk] of [
  ["normal", "", normal], ["context", "*** target\n--- target\n", contextHunk],
  ["unified", "--- target\n+++ target\n", unifiedHunk],
] as const) {
  for (const repeated of [true, false]) {
    test(`followup GNU ${format} ${repeated ? "overlap" : "unmatched"} diagnostics`, async () => {
      const input = header + hunk + (repeated ? hunk : hunk.replace("old", "absent"));
      const args = ["--batch", "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=reject", "target"];
      const files = { target: "old\nkeep\nend\n" };
      const expected = await native("patch", args, files, input);
      const actual = await run("patch", args, { files, input });
      assert.equal(expected.exitCode, 1, expected.stderr);
      assert.equal(actual.exitCode, expected.exitCode, actual.stderr);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.equal(await contents(actual.fs, "target"), expected.files.target);
      assert.equal(await contents(actual.fs, "reject"), expected.files.reject);
    });
  }
}
