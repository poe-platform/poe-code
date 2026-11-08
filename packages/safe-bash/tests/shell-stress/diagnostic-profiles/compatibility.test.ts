import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { runVirtualBatch, sourceEvidence } from "../helpers.js";
import { maxBatchCases } from "../model.js";
import { fixtures, frozen, profileName, validateFrozenProfile } from "./profile.js";

const beforeSources = sourceEvidence();
before(validateFrozenProfile);
after(() => assert.equal(sourceEvidence().aggregate, beforeSources.aggregate, "Source changed during complete profile; rerun without attribution"));

for (let offset = 0; offset < fixtures.length; offset += maxBatchCases) {
  const batch = fixtures.slice(offset, offset + maxBatchCases);
  test(`${profileName}: batch ${offset / maxBatchCases + 1}`, { timeout: 10000 }, async context => {
    const execution = await runVirtualBatch(batch.map(({ fixture }) => fixture)).then(result => ({ result }), (error: unknown) => ({ error }));
    for (const [index, { cohort, fixture }] of batch.entries()) {
      await context.test(`${profileName}: ${cohort}: ${fixture.name}`, { timeout: 10000 }, () => {
        if ("error" in execution) throw execution.error;
        const expected = frozen.rows[offset + index]!.observation;
        const outcome = execution.result.outcomes[index]!;
        assert.ok(outcome.status === "fulfilled", JSON.stringify(outcome));
        const actual = outcome.observation;
        assert.deepEqual(actual, expected, `${profileName}, uniform argv0=shell, no normalization: ${fixture.name}`);
      });
    }
  });
}
