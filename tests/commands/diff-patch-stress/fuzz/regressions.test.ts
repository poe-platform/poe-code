import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { contents, memory, native, nativeDirectory, nativePatch, run } from "./helpers.js";

const bsdZeroContext = "--- target\n+++ target\n@@ -1 +1,0 @@\n-a\n";

for (const reverse of [false, true]) test(`GAP-01 shrunk seed 1022091130: native zero-context deletion ${reverse ? "reverses" : "applies"}`, { timeout: 5000 }, async context => {
  await nativeDirectory(async root => {
    await writeFile(join(root, "old"), "a\nb\n");
    await writeFile(join(root, "next"), "b\n");
    const generated = native(root, "diff", ["-U0", "--label", "target", "--label", "target", "old", "next"]);
    assert.equal(generated.exitCode, 1);
    context.diagnostic(`NATIVE_ZERO_CONTEXT ${JSON.stringify(generated.stdout)}`);
    assert.equal(await nativePatch(root, "a\nb\n", bsdZeroContext), "b\n");
    assert.equal(await nativePatch(root, "b\n", bsdZeroContext, true), "a\nb\n");
  });
  const filesystem = await memory({ target: reverse ? "b\n" : "a\nb\n" });
  const result = await run("patch", reverse ? ["-R"] : [], filesystem, bsdZeroContext);
  assert.equal(result.exitCode, 0, `reverse=${reverse}: ${result.stderr}`);
  assert.equal(await contents(filesystem), reverse ? "a\nb\n" : "b\n");
});

test("oracle calibration: asymmetric zero-fuzz context with a displaced exact anchor", { timeout: 5000 }, async () => {
  const before = "prefix\nhead\nold\ntail\n";
  const after = "prefix\nhead\nnew\ntail\n";
  const input = "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n";
  const filesystem = await memory({ target: before });
  const result = await run("patch", ["-F0"], filesystem, input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(filesystem), after);
  await nativeDirectory(async root => assert.equal(await nativePatch(root, before, input), after));
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
