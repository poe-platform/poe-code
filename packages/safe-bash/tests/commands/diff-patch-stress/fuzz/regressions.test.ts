import assert from "node:assert/strict";
import test from "node:test";
import { contents, memory, run } from "./helpers.js";

const bsdZeroContext = "--- target\n+++ target\n@@ -1 +1,0 @@\n-a\n";

for (const reverse of [false, true]) test(`GAP-01 GNU literal-coordinate product contract ${reverse ? "reverse" : "forward"}`, async () => {
  const filesystem = await memory({ target: reverse ? "b\n" : "a\nb\n" });
  const result = await run("patch", reverse ? ["-R"] : [], filesystem, bsdZeroContext);
  assert.equal(result.exitCode, 0, `reverse=${reverse}: ${result.stderr}`);
  assert.equal(await contents(filesystem), reverse ? "b\na\n" : "b\n");
});

test("GAP-01 canonical GNU zero-context deletion applies and reverses", { timeout: 5000 }, async () => {
  const input = "--- target\n+++ target\n@@ -1 +0,0 @@\n-a\n";
for (const reverse of [false, true]) {
      const filesystem = await memory({ target: reverse ? "b\n" : "a\nb\n" });
      const result = await run("patch", reverse ? ["-R"] : [], filesystem, input);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(filesystem), reverse ? "a\nb\n" : "b\n");
    }
});

for (const fixture of [
  { name: "asymmetric non-EOF rejection", before: "prefix\nhead\nold\ntail\n", after: "prefix\nhead\nold\ntail\n", status: 1,
    input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n" },
  { name: "asymmetric EOF positive control", before: "prefix\nhead\nold\n", after: "prefix\nhead\nnew\n", status: 0,
    input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n" },
  { name: "symmetric displaced positive control", before: "prefix\nhead\nold\ntail\n", after: "prefix\nhead\nnew\ntail\n", status: 0,
    input: "--- target\n+++ target\n@@ -1,3 +1,3 @@\n head\n-old\n+new\n tail\n" },
]) test(`GNU boundary anchoring: ${fixture.name}`, { timeout: 5000 }, async () => {
  const filesystem = await memory({ target: fixture.before });
  const result = await run("patch", ["-F0"], filesystem, fixture.input);
  assert.deepEqual({ status: result.exitCode, target: await contents(filesystem) }, { status: fixture.status, target: fixture.after }, result.stderr);
});
