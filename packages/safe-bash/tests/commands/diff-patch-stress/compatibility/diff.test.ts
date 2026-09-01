import assert from "node:assert/strict";
import test from "node:test";
import { virtual } from "./helpers.js";

const files = { left: "a\nb\nc\nd\ne\nf\ng\n", right: "A\nb\nc\nd\ne\nf\nG\n" };
const labels = ["-L", "target", "-L", "target"];
const zeroContext = "--- target\n+++ target\n@@ -1 +1 @@\n-a\n+A\n@@ -7 +7 @@\n-g\n+G\n";
const oneContext = "--- target\n+++ target\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -6,2 +6,2 @@\n f\n-g\n+G\n";
const threeContext = "--- target\n+++ target\n@@ -1,7 +1,7 @@\n-a\n+A\n b\n c\n d\n e\n f\n-g\n+G\n";
const flagCases = [
  { name: "short explicit context then short format", flags: ["-U0", "-u"], output: threeContext },
  { name: "short explicit context then long format", flags: ["-U0", "--unified"], output: threeContext },
  { name: "long explicit context then grouped format", flags: ["--unified=1", "-ru"], output: threeContext },
  { name: "format then explicit context control", flags: ["-u", "-U", "0"], output: threeContext },
  { name: "zero context without a competing format control", flags: ["-U0"], output: zeroContext },
  { name: "long explicit context control", flags: ["--unified=1"], output: oneContext },
  { name: "brief uses both labels", flags: ["-q"], output: "Files target and target differ\n" },
] as const;

for (const fixture of flagCases) {
  const args = [...fixture.flags, ...labels, "left", "right"];
  test(`golden diff flags: ${fixture.name}`, async () => {
    const actual = await virtual("diff", args, files);
    assert.deepEqual({ status: actual.exitCode, output: actual.stdout.toString() }, { status: 1, output: fixture.output }, actual.stderr.toString());
  });
}


const workflows = [
  { name: "unequal multi-hunk deltas", old: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n", next: "a\ninsert1\ninsert2\nb\nc\nd\ne\nf\ng\nh\nj\nK\n" },
  { name: "blank-line runs and literal patch syntax", old: "\n\n--- header\n@@ marker\n\n\n", next: "\n--- header\n+++ added\n@@ marker\n\n\n\n" },
  { name: "long lines Unicode and trailing blanks", old: `\ufeff${"α".repeat(1024)}\t \nlast`, next: `\ufeff${"α".repeat(1024)} \t\nLAST` },
  { name: "all lines deleted retaining empty target", old: "one\r\ntwo\r\n", next: "" },
  { name: "empty input filled with unterminated UTF-8", old: "", next: "雪\n☃" },
  { name: "repeated source lines alignment not prescribed", old: "a\nb\na\nb\na\nb\na\n", next: "b\na\nb\nNEW\na\nb\na\nb\n" },
] as const;

for (const fixture of workflows) for (const width of [0, 1, 2, 5]) {
  test(`diff reports changed inputs: ${fixture.name}, U${width}`, async () => {
    const args = [`-U${width}`, ...labels, "left", "right"];
    const inputs = { left: fixture.old, right: fixture.next };
    const productDiff = await virtual("diff", args, inputs);
    assert.equal(productDiff.exitCode, 1, productDiff.stderr.toString());
  });
}
