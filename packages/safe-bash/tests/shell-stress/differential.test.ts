import assert from "node:assert/strict";
import { test } from "node:test";
import { differentialCases, syntaxCases } from "./cases.js";
import { runVirtualScript, sourceEvidence } from "./helpers.js";
import { primaryObservation as runBash, primaryVersion as bashVersion } from "./canonical-profile-migration/primary-reference.js";

test("shell stress reference identity and source provenance", context => {
  context.diagnostic(bashVersion());
  const { time, revision, aggregate, node, platform } = sourceEvidence();
  context.diagnostic(JSON.stringify({ time, revision, aggregate, node, platform }));
});

for (const fixture of differentialCases) {
  test(`GNU5.3 declared-profile differential: ${fixture.name}`, async () => {
    const expected = await runBash(fixture);
    const actual = await runVirtualScript(fixture);
    assert.deepEqual(actual, expected, `${fixture.name}\nscript: ${fixture.script}\nBash: ${JSON.stringify(expected)}\nvirtual: ${JSON.stringify(actual)}`);
  });
}

for (const fixture of syntaxCases) {
  test(`GNU5.3 declared-profile parse-before-effects: ${fixture.name}`, async context => {
    const expected = await runBash(fixture);
    const actual = await runVirtualScript(fixture);
    context.diagnostic(JSON.stringify({ script: fixture.script, expected, actual }));
    for (const [engine, result] of [["Bash", expected], ["virtual", actual]] as const) {
      assert.equal(result.exitCode, 2, `${engine}: ${fixture.script}`);
      assert.equal(result.stdout, "", `${engine}: output before syntax error`);
      assert.deepEqual(result.files, {}, `${engine}: filesystem effect before syntax error`);
      assert.notEqual(result.stderr, "", `${engine}: missing syntax diagnostic`);
    }
  });
}
