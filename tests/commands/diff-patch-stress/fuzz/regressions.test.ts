import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { oracleIdentity } from "../compatibility/oracle.js";
import { contents, memory, native, nativeDirectory, nativePatch, nativePatchResult, run } from "./helpers.js";

const bsdZeroContext = "--- target\n+++ target\n@@ -1 +1,0 @@\n-a\n";

for (const reverse of [false, true]) test(`GAP-01 GNU literal-coordinate product contract ${reverse ? "reverse" : "forward"}`, async () => {
  const filesystem = await memory({ target: reverse ? "b\n" : "a\nb\n" });
  const result = await run("patch", reverse ? ["-R"] : [], filesystem, bsdZeroContext);
  assert.equal(result.exitCode, 0, `reverse=${reverse}: ${result.stderr}`);
  assert.equal(await contents(filesystem), reverse ? "b\na\n" : "b\n");
});

for (const reverse of [false, true]) test(`GAP-01 raw selected-oracle Apple-range compatibility ${reverse ? "reverse" : "forward"}`, { timeout: 5000 }, async context => {
  const identity = oracleIdentity("patch");
  const expected = reverse ? "b\na\n" : "b\n";
  await nativeDirectory(async root => {
    const reference = await nativePatchResult(root, reverse ? "b\n" : "a\nb\n", bsdZeroContext, reverse);
    context.diagnostic(`LEGACY_RANGE_NATIVE ${JSON.stringify({ identity, reverse, reference })}`);
    assert.equal(reference.exitCode, 0);
    assert.equal(reference.target, expected);
  });
  const filesystem = await memory({ target: reverse ? "b\n" : "a\nb\n" });
  const result = await run("patch", reverse ? ["-R"] : [], filesystem, bsdZeroContext);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(filesystem), expected, "Raw dialect comparison remains failing when legacy Apple interpretation differs from GNU; no exception is granted");
});

test("GAP-01 canonical GNU zero-context deletion applies and reverses", { timeout: 5000 }, async context => {
  const input = "--- target\n+++ target\n@@ -1 +0,0 @@\n-a\n";
  await nativeDirectory(async root => {
    await writeFile(join(root, "old"), "a\nb\n");
    await writeFile(join(root, "next"), "b\n");
    const generated = native(root, "diff", ["-U0", "--label", "target", "--label", "target", "old", "next"]);
    assert.equal(generated.exitCode, 1);
    context.diagnostic(`NATIVE_ZERO_CONTEXT ${JSON.stringify(generated.stdout)}`);
    for (const reverse of [false, true]) {
      const filesystem = await memory({ target: reverse ? "b\n" : "a\nb\n" });
      const result = await run("patch", reverse ? ["-R"] : [], filesystem, input);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(filesystem), reverse ? "a\nb\n" : "b\n");
    }
    assert.equal(await nativePatch(root, "a\nb\n", input), "b\n");
    assert.equal(await nativePatch(root, "b\n", input, true), "a\nb\n");
  });
});

for (const fixture of [
  { name: "asymmetric non-EOF rejection", before: "prefix\nhead\nold\ntail\n", after: "prefix\nhead\nold\ntail\n", status: 1,
    input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n" },
  { name: "asymmetric EOF positive control", before: "prefix\nhead\nold\n", after: "prefix\nhead\nnew\n", status: 0,
    input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n" },
  { name: "symmetric displaced positive control", before: "prefix\nhead\nold\ntail\n", after: "prefix\nhead\nnew\ntail\n", status: 0,
    input: "--- target\n+++ target\n@@ -1,3 +1,3 @@\n head\n-old\n+new\n tail\n" },
]) test(`GNU boundary anchoring: ${fixture.name}`, { timeout: 5000 }, async () => {
  await nativeDirectory(async root => {
    const reference = await nativePatchResult(root, fixture.before, fixture.input);
    assert.deepEqual({ status: reference.exitCode, target: reference.target }, { status: fixture.status, target: fixture.after });
  });
  const filesystem = await memory({ target: fixture.before });
  const result = await run("patch", ["-F0"], filesystem, fixture.input);
  assert.deepEqual({ status: result.exitCode, target: await contents(filesystem) }, { status: fixture.status, target: fixture.after }, result.stderr);
});

test("oracle calibration: native-generated unterminated context survives native reverse", { timeout: 5000 }, async () => {
  await nativeDirectory(async root => {
    await writeFile(join(root, "old"), "a\nz");
    await writeFile(join(root, "next"), "b\nz");
    const generated = native(root, "diff", ["-U1", "--label", "target", "--label", "target", "old", "next"]);
    assert.equal(generated.exitCode, 1);
    assert.equal(await nativePatch(root, "a\nz", generated.stdout), "b\nz");
    assert.equal(await nativePatch(root, "b\nz", generated.stdout, true), "a\nz");
  });
});
