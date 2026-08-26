import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { contents, memory, nativeDirectory, nativePatchResult, run } from "./helpers.js";

test("adversarial repeated-line unmatched rectangle rejects before oversized LCS allocation", { timeout: 5000 }, async context => {
  const before = `old-start\n${"same\n".repeat(2100)}old-end\n`;
  const after = `new-start\n${"same\n".repeat(2100)}new-end\n`;
  const started = performance.now();
  const result = await run("diff", ["-u", "old", "next"], await memory({ old: before, next: after }));
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /matrix cell limit/u);
  assert.equal(result.stdout, "");
  context.diagnostic(`MATRIX_REPORT linesPerSide=2102 cells=4422609 limit=4000000 elapsedMs=${(performance.now() - started).toFixed(2)}`);
});

test("repeated-line rectangle within limit computes exact result and reverse", { timeout: 5000 }, async context => {
  const before = `old-start\n${"same\n".repeat(350)}old-end\n`;
  const after = `new-start\n${"same\n".repeat(350)}new-end\n`;
  const filesystem = await memory({ old: before, next: after, target: before });
  const started = performance.now();
  const result = await run("diff", ["-U1", "--label", "target", "--label", "target", "old", "next"], filesystem);
  assert.equal(result.exitCode, 1, result.stderr);
  const forward = await run("patch", [], filesystem, result.stdout);
  assert.equal(forward.exitCode, 0, forward.stderr);
  assert.equal(await contents(filesystem), after);
  const reverse = await run("patch", ["-R"], filesystem, result.stdout);
  assert.equal(reverse.exitCode, 0, reverse.stderr);
  assert.equal(await contents(filesystem), before);
  context.diagnostic(`REPETITION_REPORT linesPerSide=352 cells=124609 elapsedMs=${(performance.now() - started).toFixed(2)}`);
});

test("long compared lines exhaust charged work rather than allocating a large rectangle", { timeout: 5000 }, async () => {
  const before = `${"a".repeat(8192)}\n`.repeat(20);
  const after = `${"b".repeat(8192)}\n`.repeat(20);
  const result = await run("diff", ["-u", "old", "next"], await memory({ old: before, next: after }), "", { maxWork: 25_000 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /work limit/u);
  assert.equal(result.stdout, "");
});

test("adversarial repetitive patch anchors terminate within an explicit work budget", { timeout: 5000 }, async () => {
  const before = "same\n".repeat(1500);
  const input = `--- target\n+++ target\n@@ -100,161 +100,161 @@\n${" same\n".repeat(80)}-absent\n+present\n${" same\n".repeat(80)}`;
  const filesystem = await memory({ target: before });
  const result = await run("patch", ["-F0"], filesystem, input, { maxWork: 10_000 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /work limit/u);
  assert.equal(await contents(filesystem), before);
});

test("legacy asymmetric budget input is a GNU boundary rejection, not an expensive search", { timeout: 5000 }, async () => {
  const before = "same\n".repeat(1500);
  const input = `--- target\n+++ target\n@@ -1,81 +1,81 @@\n${" same\n".repeat(80)}-absent\n+present\n`;
  await nativeDirectory(async root => {
    const reference = await nativePatchResult(root, before, input);
    assert.equal(reference.exitCode, 1);
    assert.equal(reference.target, before);
  });
  const filesystem = await memory({ target: before });
  const result = await run("patch", ["-F0"], filesystem, input, { maxWork: 10_000 });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(await contents(filesystem), before);
});
