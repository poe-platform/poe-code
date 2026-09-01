import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { runVirtualScript, sourceEvidence } from "../helpers.js";
import { fixtures, frozen, profileName, validateFrozenProfile } from "./profile.js";

const beforeSources = sourceEvidence();
before(validateFrozenProfile);
after(() => assert.equal(sourceEvidence().aggregate, beforeSources.aggregate, "Source changed during complete profile; rerun without attribution"));

for (const [index, { cohort, fixture }] of fixtures.entries()) {
  test(`${profileName}: ${cohort}: ${fixture.name}`, { timeout: 10000 }, async () => {
    const expected = frozen.rows[index]!.observation;
    const actual = await runVirtualScript(fixture);
    assert.deepEqual(actual, expected, `${profileName}, uniform argv0=shell, no normalization: ${fixture.name}`);
  });
}
