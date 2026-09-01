import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { root, sourceEvidence } from "../helpers.js";
import { isolatedSpawn } from "../process.js";

for (const mode of ["matcher", "shell"] as const) {
  test(`unmatched bracket ${mode} completes or cancels within external deadline`, { timeout: 4000 }, async () => {
    const before = sourceEvidence();
    const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./pattern-child.ts", import.meta.url))], {
      cwd: root, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      input: JSON.stringify({ length: 65536, mode }), timeout: 1500, maxBuffer: 65536,
    });
    const after = sourceEvidence();
    console.log(JSON.stringify({ before: before.aggregate, after: after.aggregate, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout.toString(), stderr: result.stderr.toString() }));
    assert.equal(after.aggregate, before.aggregate, "source changed during execution; rerun rather than attribute");
    assert.equal(result.error, undefined, "unmatched-bracket tokenization must not defeat the external cancellation deadline");
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
    assert.equal(result.stderr.toString(), "");
    const observation = JSON.parse(result.stdout.toString()) as { outcome: unknown };
    if (mode === "matcher") assert.ok(observation.outcome === false || observation.outcome === "cancelled");
    else if (observation.outcome !== "cancelled") {
      const outcome = observation.outcome as { files: unknown[]; result: { exitCode: number; stdout: string; stderr: string } };
      assert.deepEqual(outcome.files, []);
      assert.equal(outcome.result.exitCode, 0);
      assert.equal(outcome.result.stdout, "");
      assert.equal(outcome.result.stderr, "");
    }
  });
}
