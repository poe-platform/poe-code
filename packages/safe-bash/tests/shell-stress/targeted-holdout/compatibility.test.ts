import assert from "node:assert/strict";
import { test } from "node:test";
import { runVirtualBatch } from "../helpers.js";
import { maxBatchCases } from "../model.js";
import { comparable, references, validateReferences, virtualFixture } from "./frozen.js";

validateReferences();

for (let offset = 0; offset < references.cases.length; offset += maxBatchCases) {
  const batch = references.cases.slice(offset, offset + maxBatchCases);
  test(`frozen GNU5.3 holdout batch ${offset / maxBatchCases + 1}`, { timeout: 8000 }, async context => {
    const execution = await runVirtualBatch(batch.map(row => virtualFixture(row.fixture))).then(result => ({ result }), (error: unknown) => ({ error }));
    if ("result" in execution) {
      const { before, after } = execution.result;
      context.diagnostic(JSON.stringify({ sourceScope: "batch", sourceBefore: before.aggregate, sourceAfter: after.aggregate, timeBefore: before.time, timeAfter: after.time, revision: before.revision, sourceAdmission: before.sourceAdmission }));
    }
    for (const [index, row] of batch.entries()) {
      await context.test(`frozen GNU5.3 holdout ${row.fixture.group}: ${row.fixture.name}`, { timeout: 8000 }, child => {
        if ("error" in execution) throw execution.error;
        const { before, after } = execution.result;
        const outcome = execution.result.outcomes[index]!;
        assert.ok(outcome.status === "fulfilled", JSON.stringify(outcome));
        const actual = outcome.observation;
        child.diagnostic(JSON.stringify({ sourceScope: "batch", sourceBefore: before.aggregate, sourceAfter: after.aggregate, primaryVersion: references.primary.stdout.split("\n")[0], primaryBinarySha256: references.primary.sha256, legacyDiffers: row.differs }));
        assert.equal(after.aggregate, before.aggregate, "Source snapshot invalidated; rerun this focused case rather than attribute a regression");
        assert.deepEqual(comparable(actual), comparable(row.primary), JSON.stringify({ script: row.fixture.script, stdin: row.fixture.stdin, files: row.fixture.initialFiles, locale: row.fixture.locale ?? "C", rawExpected: row.primary, rawActual: actual, rawLegacy: row.legacy, source: before.aggregate }, null, 2));
      });
    }
  });
}
