import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { root, sourceEvidence } from "../helpers.js";
import { isolatedSpawn } from "../process.js";
import { probeNames } from "./probes.js";

for (const probe of probeNames) {
  test(`targeted lifecycle: ${probe}`, { timeout: 5000 }, async context => {
    const before = sourceEvidence();
    const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./probe-child.ts", import.meta.url))], {
      cwd: root, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, input: JSON.stringify({ probe }), timeout: 3000, maxBuffer: 65536,
    });
    const after = sourceEvidence();
    context.diagnostic(JSON.stringify({ sourceBefore: before.aggregate, sourceAfter: after.aggregate, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout.toString(), stderr: result.stderr.toString() }));
    assert.equal(after.aggregate, before.aggregate, "Source changed during probe; retain invalidation and rerun only affected case");
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stderr.toString(), "");
    assert.deepEqual(JSON.parse(result.stdout.toString()), { passed: probe });
  });
}
