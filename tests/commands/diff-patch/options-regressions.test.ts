import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

const files = { left: "a\nb\nc\nd\ne\nf\ng\n", right: "A\nb\nc\nd\ne\nf\nG\n" };
const labels = ["-L", "BEFORE", "-L", "AFTER"];
const zeroContext = "--- BEFORE\n+++ AFTER\n@@ -1 +1 @@\n-a\n+A\n@@ -7 +7 @@\n-g\n+G\n";
const oneContext = "--- BEFORE\n+++ AFTER\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -6,2 +6,2 @@\n f\n-g\n+G\n";
const defaultContext = "--- BEFORE\n+++ AFTER\n@@ -1,7 +1,7 @@\n-a\n+A\n b\n c\n d\n e\n f\n-g\n+G\n";

const contextCases = [
  { flags: ["-U0", "-u"], expected: zeroContext },
  { flags: ["-U0", "--unified"], expected: zeroContext },
  { flags: ["--unified=1", "-ru"], expected: oneContext },
  { flags: ["-U", "0", "-uru", "--unified"], expected: zeroContext },
  { flags: ["-u", "-U0"], expected: zeroContext },
  { flags: ["--unified", "--unified=1"], expected: oneContext },
  { flags: ["-U0", "-u", "-U1", "--unified"], expected: oneContext },
  { flags: [], expected: defaultContext },
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
