import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tableCases } from "../../table-text/cases.js";
import { caseHash, type Observation } from "../../table-text/oracle.js";
import { currentPasteStdout } from "../../table-text/helpers.js";
import { direct } from "./support.js";

const evidence: { observations: Observation[] } = JSON.parse(await readFile(new URL("../../table-text/gnu-evidence.json", import.meta.url), "utf8"));
assert.equal(tableCases.length, 216);
assert.equal(evidence.observations.length, 216);
for (const [index, fixture] of tableCases.entries()) {
  const currentStdoutHex = currentPasteStdout(fixture, evidence.observations[index]!.stdoutHex);
  const mixedJoinFormat = ["join: auto then output list", "join: output list then auto"].includes(fixture.name);
  test(`${mixedJoinFormat ? "current join profile with unchanged GNU9.7 input" : currentStdoutHex !== undefined ? "current paste profile with unchanged GNU9.7 input" : "unchanged GNU9.7 input and expectation"}: ${fixture.name}`, async () => {
    const expected = evidence.observations[index]!;
    assert.equal(expected.name, fixture.name);
    assert.equal(expected.caseSha256, caseHash(fixture));
    const actual = await direct(fixture);
    if (mixedJoinFormat) {
      // Issue 1079's current contract rejects mixed formats; keep the captured bytes unchanged.
      assert.equal(actual.stdoutHex, "");
      assert.equal(actual.exitCode, 1);
      assert.match(Buffer.from(actual.stderrHex, "hex").toString(), /conflicting output format specifications/u);
    } else {
      assert.equal(actual.stdoutHex, currentStdoutHex ?? expected.stdoutHex);
      assert.equal(actual.exitCode, expected.exitCode);
      assert.equal(Boolean(actual.stderrHex), Boolean(expected.stderrHex));
    }
    assert.deepEqual(actual.files, fixture.files);
  });
}
