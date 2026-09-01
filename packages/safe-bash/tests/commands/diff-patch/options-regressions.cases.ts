import assert from "node:assert/strict";
import test from "node:test";
import { run, type Files } from "./helpers.js";

const files = { left: "a\nb\nc\nd\ne\nf\ng\n", right: "A\nb\nc\nd\ne\nf\nG\n" };
const labels = ["-L", "BEFORE", "-L", "AFTER"];
const zeroContext = "--- BEFORE\n+++ AFTER\n@@ -1 +1 @@\n-a\n+A\n@@ -7 +7 @@\n-g\n+G\n";
const oneContext = "--- BEFORE\n+++ AFTER\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -6,2 +6,2 @@\n f\n-g\n+G\n";
const defaultContext = "--- BEFORE\n+++ AFTER\n@@ -1,7 +1,7 @@\n-a\n+A\n b\n c\n d\n e\n f\n-g\n+G\n";

const contextCases = [
  { flags: ["-U0", "-u"], expected: defaultContext },
  { flags: ["-U0", "--unified"], expected: defaultContext },
  { flags: ["--unified=1", "-ru"], expected: defaultContext },
  { flags: ["-U", "0", "-uru", "--unified"], expected: defaultContext },
  { flags: ["-u", "-U0"], expected: defaultContext },
  { flags: ["--unified", "--unified=1"], expected: defaultContext },
  { flags: ["-U0", "-u", "-U1", "--unified"], expected: defaultContext },
  { flags: ["-U0"], expected: zeroContext },
  { flags: ["--unified=1"], expected: oneContext },
  { flags: [], expected: "1c1\n< a\n---\n> A\n7c7\n< g\n---\n> G\n" },
  { flags: ["-u"], expected: defaultContext },
  { flags: ["--unified"], expected: defaultContext },
  { flags: ["-ru"], expected: defaultContext },
];

for (const fixture of contextCases) {
  test(`diff context regression: ${JSON.stringify(fixture.flags)}`, async () => {
    const result = await run("diff", [...fixture.flags, ...labels, "left", "right"], { files });
    assert.deepEqual(
      { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: 1, stdout: fixture.expected, stderr: "" },
    );
  });
}

const briefInputs: { name: string; flags: string[]; files: Files }[] = [
  { name: "both files", flags: ["-q"], files: { left: "old\n", right: "new\n" } },
  { name: "missing left", flags: ["-qN"], files: { right: "new\n" } },
  { name: "missing right", flags: ["--brief", "--new-file"], files: { left: "old\n" } },
];
const briefLabels = [
  { flags: [], expected: "Files left and right differ\n" },
  { flags: ["-L", "BEFORE"], expected: "Files BEFORE and right differ\n" },
  { flags: labels, expected: "Files BEFORE and AFTER differ\n" },
  { flags: ["--label=before name", "--label", "after name"], expected: "Files before name and after name differ\n" },
];

for (const fixture of briefInputs) for (const label of briefLabels) {
  test(`diff brief label regression: ${fixture.name}, ${JSON.stringify(label.flags)}`, async () => {
    const result = await run("diff", [...fixture.flags, ...label.flags, "left", "right"], { files: fixture.files });
    assert.deepEqual(
      { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: 1, stdout: label.expected, stderr: "" },
    );
  });
}

const identicalInputs: { name: string; files: Files }[] = [
  { name: "identical files", files: { left: "same\n", right: "same\n" } },
  { name: "missing left and empty right", files: { right: "" } },
  { name: "empty left and missing right", files: { left: "" } },
];

for (const fixture of [
  { flags: ["-wC0", "-c"], expected: "*** OLD\n--- NEW\n***************\n*** 1,2 ****\n  a b\n! old\n--- 1,2 ----\n  ab\n! new\n" },
  { flags: ["-bU0", "-uw"], expected: "--- OLD\n+++ NEW\n@@ -1,2 +1,2 @@\n a b\n-old\n+new\n" },
]) {
  test(`explicit-count regression with whitespace: ${JSON.stringify(fixture.flags)}`, async () => {
    const args = [...fixture.flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const inputs = { old: "a b\nold\n", new: "ab\nnew\n" };
    const actual = await run("diff", args, { files: inputs });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { exitCode: 1, stdout: fixture.expected, stderr: "" });
  });
}

for (const fixture of identicalInputs) {
  test(`diff brief labels remain silent: ${fixture.name}`, async () => {
    const result = await run("diff", ["-qN", ...labels, "left", "right"], { files: fixture.files });
    assert.deepEqual(
      { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: 0, stdout: "", stderr: "" },
    );
  });
}
