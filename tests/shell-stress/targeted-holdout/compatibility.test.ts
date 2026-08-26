import assert from "node:assert/strict";
import { test } from "node:test";
import { runVirtualScript, sourceEvidence } from "../helpers.js";
import { comparable, references, validateReferences, virtualFixture } from "./frozen.js";

validateReferences();

for (const row of references.cases) {
  test(`frozen GNU5.3 holdout ${row.fixture.group}: ${row.fixture.name}`, { timeout: 8000 }, async context => {
    const before = sourceEvidence();
    const actual = await runVirtualScript(virtualFixture(row.fixture));
    const after = sourceEvidence();
    context.diagnostic(JSON.stringify({ sourceBefore: before.aggregate, sourceAfter: after.aggregate, primaryVersion: references.primary.stdout.split("\n")[0], primaryBinarySha256: references.primary.sha256, legacyDiffers: row.differs }));
    assert.equal(after.aggregate, before.aggregate, "Source snapshot invalidated; rerun this focused case rather than attribute a regression");
    assert.deepEqual(comparable(actual), comparable(row.primary), JSON.stringify({ script: row.fixture.script, stdin: row.fixture.stdin, files: row.fixture.initialFiles, locale: row.fixture.locale ?? "C", rawExpected: row.primary, rawActual: actual, rawLegacy: row.legacy, source: before.aggregate }, null, 2));
  });
}
