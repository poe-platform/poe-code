import assert from "node:assert/strict";
import { test } from "node:test";
import { differentialCases, syntaxCases } from "./cases.js";
import { runVirtualBatch, sourceEvidence } from "./helpers.js";
import { maxBatchCases } from "./model.js";
import { primaryObservation as runBash, primaryVersion as bashVersion } from "./canonical-profile-migration/primary-reference.js";

test("shell stress reference identity and source provenance", context => {
  context.diagnostic(bashVersion());
  const { time, revision, aggregate, node, platform } = sourceEvidence();
  context.diagnostic(JSON.stringify({ time, revision, aggregate, node, platform }));
});

for (const [cohort, fixtures] of [["differential", differentialCases], ["parse-before-effects", syntaxCases]] as const) {
  for (let offset = 0; offset < fixtures.length; offset += maxBatchCases) {
    const batch = fixtures.slice(offset, offset + maxBatchCases);
    test(`GNU5.3 declared-profile ${cohort} batch ${offset / maxBatchCases + 1}`, async context => {
      const execution = await runVirtualBatch(batch).then(result => ({ result }), (error: unknown) => ({ error }));
      if ("result" in execution) {
        const { before, after } = execution.result;
        context.diagnostic(JSON.stringify({ sourceScope: "batch", sourceBefore: before.aggregate, sourceAfter: after.aggregate, timeBefore: before.time, timeAfter: after.time, revision: before.revision, sourceAdmission: before.sourceAdmission }));
      }
      for (const [index, fixture] of batch.entries()) {
        await context.test(`GNU5.3 declared-profile ${cohort}: ${fixture.name}`, async child => {
          if ("error" in execution) throw execution.error;
          const outcome = execution.result.outcomes[index]!;
          assert.ok(outcome.status === "fulfilled", JSON.stringify(outcome));
          const actual = outcome.observation;
          const expected = await runBash(fixture);
          if (cohort === "differential") {
            assert.deepEqual(actual, expected, `${fixture.name}\nscript: ${fixture.script}\nBash: ${JSON.stringify(expected)}\nvirtual: ${JSON.stringify(actual)}`);
          } else {
            child.diagnostic(JSON.stringify({ script: fixture.script, expected, actual }));
            for (const [engine, result] of [["Bash", expected], ["virtual", actual]] as const) {
              assert.equal(result.exitCode, 2, `${engine}: ${fixture.script}`);
              assert.equal(result.stdout, "", `${engine}: output before syntax error`);
              assert.deepEqual(result.files, {}, `${engine}: filesystem effect before syntax error`);
              assert.notEqual(result.stderr, "", `${engine}: missing syntax diagnostic`);
            }
          }
        });
      }
    });
  }
}
