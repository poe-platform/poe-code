import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runVirtualBatch } from "../helpers.js";
import { maxBatchCases } from "../model.js";
import type { Observation, StressCase } from "../model.js";
import { comparable } from "../targeted-holdout/frozen.js";

interface FrozenBoundaryCase {
  fixture: StressCase;
  scriptSha256: string;
  expected: Observation;
}

const referencePath = new URL("../../../benchmarks/shell-stress/input-boundary-holdout/references.json", import.meta.url);
const referenceText = readFileSync(referencePath);
const referenceSha256 = "aaa23f9b8e002ba7d2c0564e056512c813b26fff79d1843a533158a8f7c9e303";
const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
assert.equal(sha256(referenceText), referenceSha256, "Frozen native observations changed; do not bless virtual output");
const references = JSON.parse(referenceText.toString()) as { cases: FrozenBoundaryCase[] };
assert.equal(references.cases.length, 12);
assert.equal(new Set(references.cases.map(row => row.fixture.name)).size, 12);
for (const row of references.cases) {
  assert.equal(sha256(row.fixture.script), row.scriptSha256);
  assert.equal(Buffer.from(row.expected.stdoutBase64, "base64").toString(), row.expected.stdout);
  assert.equal(Buffer.from(row.expected.stderrBase64, "base64").toString(), row.expected.stderr);
  assert.ok(Number.isInteger(row.expected.exitCode));
}

for (let offset = 0; offset < references.cases.length; offset += maxBatchCases) {
  const batch = references.cases.slice(offset, offset + maxBatchCases);
  test(`frozen GNU5.3 input boundary batch ${offset / maxBatchCases + 1}`, { timeout: 8000 }, async context => {
    const testHashBefore = sha256(readFileSync(new URL(import.meta.url)));
    const execution = await runVirtualBatch(batch.map(row => ({ ...row.fixture, env: { LANG: "C", LC_ALL: "C" } }))).then(result => ({ result }), (error: unknown) => ({ error }));
    for (const [index, row] of batch.entries()) {
      await context.test("frozen GNU5.3 input boundary: " + row.fixture.name, { timeout: 8000 }, child => {
        if ("error" in execution) throw execution.error;
        const { before, after } = execution.result;
        const outcome = execution.result.outcomes[index]!;
        assert.ok(outcome.status === "fulfilled", JSON.stringify(outcome));
        const actual = outcome.observation;
        child.diagnostic(JSON.stringify({ sourceScope: "batch", sourceBefore: before.aggregate, sourceAfter: after.aggregate, nativeReferenceSha256: referenceSha256, scriptSha256: row.scriptSha256 }));
        assert.equal(after.aggregate, before.aggregate, "Source snapshot invalidated; rerun rather than attribute this result");
        assert.equal(sha256(readFileSync(new URL(import.meta.url))), testHashBefore, "Test source changed during execution");
        assert.equal(sha256(readFileSync(referencePath)), referenceSha256, "Frozen reference changed during execution");
        assert.deepEqual(comparable(actual), comparable(row.expected), JSON.stringify({ script: row.fixture.script, stdin: row.fixture.stdin ?? "", env: { LANG: "C", LC_ALL: "C" }, rawExpected: row.expected, rawActual: actual, source: before.aggregate }, null, 2));
      });
    }
  });
}
