import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tableCases } from "../../table-text/cases.js";
import { caseHash, type Observation } from "../../table-text/oracle.js";
import { direct } from "./support.js";

const evidence: { observations: Observation[] } = JSON.parse(await readFile(new URL("../../table-text/gnu-evidence.json", import.meta.url), "utf8"));
assert.equal(tableCases.length, 216);
assert.equal(evidence.observations.length, 216);
for (const [index, fixture] of tableCases.entries()) {
  test(`unchanged GNU9.7 input and expectation: ${fixture.name}`, async () => {
    const expected = evidence.observations[index]!;
    assert.equal(expected.name, fixture.name);
    assert.equal(expected.caseSha256, caseHash(fixture));
    const actual = await direct(fixture);
    assert.equal(actual.stdoutHex, expected.stdoutHex);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.equal(Boolean(actual.stderrHex), Boolean(expected.stderrHex));
    assert.deepEqual(actual.files, fixture.files);
  });
}
