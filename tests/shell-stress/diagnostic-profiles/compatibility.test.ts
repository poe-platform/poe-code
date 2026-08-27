import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { runVirtualScript, sourceEvidence } from "../helpers.js";
import { fixtures, frozen, profileName, runNative, validateCurrentProfile, validateNativeIdentityAndLifecycle } from "./profile.js";

const beforeSources = sourceEvidence();
before(validateCurrentProfile);
after(() => assert.equal(sourceEvidence().aggregate, beforeSources.aggregate, "Source changed during complete profile; rerun without attribution"));

test(`${profileName}: pinned identity and original native lifecycle control`, validateNativeIdentityAndLifecycle);

for (const [index, { cohort, fixture }] of fixtures.entries()) {
  test(`${profileName}: ${cohort}: ${fixture.name}`, { timeout: 10000 }, async () => {
    const expected = frozen.rows[index]!.observation;
    const native = await runNative(fixture);
    assert.deepEqual(native, expected, `Frozen native profile drift: ${fixture.name}`);
    const actual = await runVirtualScript(fixture);
    assert.deepEqual(actual, expected, `${profileName}, uniform argv0=shell, no normalization: ${fixture.name}`);
  });
}
