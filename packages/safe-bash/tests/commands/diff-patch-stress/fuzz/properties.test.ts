import assert from "node:assert/strict";
import test from "node:test";
import { BASE_SEED, CASE_COUNT, contents, editCount, example, golden, memory, run, shortestEditDistance } from "./helpers.js";

test("512 independent seeded diff/patch, reverse, golden, and minimality properties", { timeout: 180_000 }, async context => {
  const failures: { index: number; seed: number; family: string; phase: string; message: string }[] = [];
  const counts: Record<string, { pass: number; fail: number }> = {};
  const families: Record<string, number> = {};
  const selected = process.env.DIFF_PATCH_FUZZ_INDEX;
  const indices = selected === undefined ? Array.from({ length: CASE_COUNT }, (_, index) => index) : [Number(selected)];
  for (const index of indices) {
    assert(Number.isInteger(index) && index >= 0 && index < CASE_COUNT);
    const sample = example(index);
    families[sample.family] = (families[sample.family] ?? 0) + 1;
    const check = async (phase: string, operation: () => Promise<void> | void) => {
      const count = counts[phase] ??= { pass: 0, fail: 0 };
      try { await operation(); count.pass++; }
      catch (error) {
        count.fail++;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ index, seed: sample.seed, family: sample.family, phase, message: message.slice(0, 1600) });
      }
    };
    const filesystem = await memory({ old: sample.before, next: sample.after, target: sample.before });
    const args = ["-U", String(sample.context), "--label", "target", "--label", "target", "old", "next"];
    const generated = await run("diff", args, filesystem);
    await check("diff-status", () => {
      assert.equal(generated.exitCode, sample.before === sample.after ? 0 : 1, generated.stderr);
      assert.equal(generated.stderr, "");
    });
    await check("minimal-edit-count", () => assert.equal(editCount(generated.stdout), shortestEditDistance(sample.before, sample.after)));
    await check("virtual-forward", async () => {
      const result = await run("patch", ["-F0", "-p0"], filesystem, generated.stdout);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(filesystem), sample.after);
    });
    await check("virtual-reverse", async () => {
      const reverseFilesystem = await memory({ target: sample.after });
      const result = await run("patch", ["-R", "-F0", "-p0"], reverseFilesystem, generated.stdout);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(reverseFilesystem), sample.before);
    });
    const handPatch = golden(sample.before, sample.after);
    for (const reverse of [false, true]) await check(`golden-${reverse ? "reverse" : "forward"}`, async () => {
      const goldenFilesystem = await memory({ target: reverse ? sample.after : sample.before });
      const result = await run("patch", reverse ? ["-R"] : [], goldenFilesystem, handPatch);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(goldenFilesystem), reverse ? sample.before : sample.after);
    });
  }
  context.diagnostic(`FUZZ_REPORT ${JSON.stringify({ baseSeed: BASE_SEED, denominator: indices.length, families, counts, skips: 0 })}`);
  context.diagnostic(`FAILURE_INDEX ${JSON.stringify(failures.map(({ index, seed, family, phase }) => ({ index, seed, family, phase })))}`);
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 12), null, 2));
});
