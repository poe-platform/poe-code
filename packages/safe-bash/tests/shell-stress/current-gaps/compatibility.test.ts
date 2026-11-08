import assert from "node:assert/strict";
import { test } from "node:test";
import { additionalCases } from "./cases.js";
import { primaryObservation as independentBash } from "../canonical-profile-migration/primary-reference.js";
import { runVirtualBatch } from "../helpers.js";
import { maxBatchCases } from "../model.js";

for (let offset = 0; offset < additionalCases.length; offset += maxBatchCases) {
  const batch = additionalCases.slice(offset, offset + maxBatchCases);
  test(`remaining-gap GNU5.3 declared profile batch ${offset / maxBatchCases + 1}`, { timeout: 8000 }, async context => {
    const execution = await runVirtualBatch(batch).then(result => ({ result }), (error: unknown) => ({ error }));
    for (const [index, fixture] of batch.entries()) {
      await context.test(`remaining-gap GNU5.3 declared profile: ${fixture.name}`, { timeout: 8000 }, async () => {
        if ("error" in execution) throw execution.error;
        const expected = await independentBash(fixture);
        const outcome = execution.result.outcomes[index]!;
        assert.ok(outcome.status === "fulfilled", JSON.stringify(outcome));
        const actual = outcome.observation;
        assert.deepEqual(actual, expected, `${fixture.name}\nscript: ${fixture.script}\nBash: ${JSON.stringify(expected)}\nvirtual: ${JSON.stringify(actual)}`);
      });
    }
  });
}
