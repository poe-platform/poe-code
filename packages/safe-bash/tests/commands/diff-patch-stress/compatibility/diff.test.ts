import assert from "node:assert/strict";
import test from "node:test";
import { availability, expectedFiles, native, snapshot, virtual } from "./helpers.js";

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
  test(`native diff flags: ${fixture.name}`, async context => {
    const version = await availability("diff");
    const oracle = await native("diff", args, files);
    assert.deepEqual({ status: oracle.exitCode, output: oracle.stdout.toString() }, { status: 1, output: fixture.output }, `${version}\n${oracle.stderr}`);
    const actual = await virtual("diff", args, files);
    assert.deepEqual({ status: actual.exitCode, output: actual.stdout }, { status: oracle.exitCode, output: oracle.stdout }, actual.stderr.toString());
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
  test(`native cross-application: ${fixture.name}, U${width}`, async context => {
    const diffVersion = await availability("diff");
    const patchVersion = await availability("patch");
    context.diagnostic(`${diffVersion}\n${patchVersion}`);
    const args = [`-U${width}`, ...labels, "left", "right"];
    const inputs = { left: fixture.old, right: fixture.next };
    const oracleDiff = await native("diff", args, inputs);
    const productDiff = await virtual("diff", args, inputs);
    assert.equal(oracleDiff.exitCode, 1, oracleDiff.stderr.toString());
    assert.equal(productDiff.exitCode, 1, productDiff.stderr.toString());
    const productForward = await virtual("patch", ["-F0"], { target: fixture.old }, oracleDiff.stdout.toString());
    assert.deepEqual({ status: productForward.exitCode, files: await snapshot(productForward.fs, ["target"]) }, { status: 0, files: expectedFiles({ target: fixture.next }) }, productForward.stderr.toString());
    const productReverse = await virtual("patch", ["-R", "-F0"], { target: fixture.next }, oracleDiff.stdout.toString());
    assert.deepEqual({ status: productReverse.exitCode, files: await snapshot(productReverse.fs, ["target"]) }, { status: 0, files: expectedFiles({ target: fixture.old }) }, productReverse.stderr.toString());
    const nativeForward = await native("patch", ["-f", "-p0", "-F0"], { target: fixture.old }, productDiff.stdout.toString());
    const selfForward = await native("patch", ["-f", "-p0", "-F0"], { target: fixture.old }, oracleDiff.stdout.toString());
    const nativeReverse = await native("patch", ["-f", "-p0", "-F0", "-R"], { target: fixture.next }, productDiff.stdout.toString());
    const selfReverse = await native("patch", ["-f", "-p0", "-F0", "-R"], { target: fixture.next }, oracleDiff.stdout.toString());
    context.diagnostic(`RAW_NATIVE_CONTROLS ${JSON.stringify({ nativeForward, selfForward, nativeReverse, selfReverse })}`);
    assert.deepEqual({ status: nativeForward.exitCode, files: nativeForward.files }, { status: 0, files: expectedFiles({ target: fixture.next }) }, nativeForward.stderr.toString());
    assert.deepEqual({ status: nativeReverse.exitCode, files: nativeReverse.files }, { status: 0, files: expectedFiles({ target: fixture.old }) },
      `Native reverse cross-application; native self-reverse status=${selfReverse.exitCode}. If both fail, this is an oracle limitation, not evidence of a product bug.\n${nativeReverse.stdout}\n${nativeReverse.stderr}`);
  });
}
