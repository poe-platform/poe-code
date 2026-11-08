import assert from "node:assert/strict";
import test from "node:test";
import { expectedFiles, snapshot, virtual } from "./helpers.js";

const contextPatch = "*** target\n--- target\n***************\n*** 1,3 ****\n  head\n! old\n  tail\n--- 1,3 ----\n  head\n! new\n  tail\n";
const gapCases = [
  { name: "GAP context-format patch autodetection", tool: "patch", args: [], files: { target: "head\nold\ntail\n" }, input: contextPatch,
    status: 0, output: undefined, expected: { target: "head\nnew\ntail\n" } },
  { name: "GAP explicit context-format patch", tool: "patch", args: ["-c"], files: { target: "head\nold\ntail\n" }, input: contextPatch,
    status: 0, output: undefined, expected: { target: "head\nnew\ntail\n" } },
  { name: "GAP patch loose whitespace", tool: "patch", args: ["-l"], files: { target: "head\tvalue\nold\ntail\n" },
    input: "--- target\n+++ target\n@@ -1,3 +1,3 @@\n head value\n-old\n+new\n tail\n", status: 0, output: undefined, expected: { target: "head\tvalue\nnew\ntail\n" } },
  { name: "GAP epoch-header creation without dev-null", tool: "patch", args: [], files: {},
    input: "--- target\t1970-01-01 00:00:00 +0000\n+++ target\t2026-08-26 00:00:00 +0000\n@@ -0,0 +1 @@\n+created\n", status: 0, output: undefined, expected: { target: "created\n" } },
  { name: "GAP diff context format", tool: "diff", args: ["-C1", "-L", "target", "-L", "target", "left", "right"],
    files: { left: "head\nold\ntail\n", right: "head\nnew\ntail\n" }, input: "", status: 1, output: contextPatch, expected: {} },
  { name: "GAP diff whitespace-ignore", tool: "diff", args: ["-b", "left", "right"],
    files: { left: "same\tword \n", right: "same word\n" }, input: "", status: 0, output: "", expected: {} },
] as const;

for (const fixture of gapCases) {
  test(`golden ${fixture.name}`, async () => {
    const actual = await virtual(fixture.tool, fixture.args, fixture.files, fixture.input);
    assert.deepEqual({ status: actual.exitCode, files: await snapshot(actual.fs, Object.keys(fixture.expected)), output: fixture.output === undefined ? undefined : actual.stdout.toString() },
      { status: fixture.status, files: expectedFiles(fixture.expected), output: fixture.output }, actual.stderr.toString());
  });
}
