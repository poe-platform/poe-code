import assert from "node:assert/strict";
import { test } from "node:test";
import { additionalCases } from "./cases.js";
import { primaryObservation as independentBash } from "../canonical-profile-migration/primary-reference.js";
import { runVirtualScript } from "../helpers.js";

for (const fixture of additionalCases) {
  test(`remaining-gap GNU5.3 declared profile: ${fixture.name}`, { timeout: 8000 }, async () => {
    const expected = await independentBash(fixture);
    const actual = await runVirtualScript(fixture);
    assert.deepEqual(actual, expected, `${fixture.name}\nscript: ${fixture.script}\nBash: ${JSON.stringify(expected)}\nvirtual: ${JSON.stringify(actual)}`);
  });
}
