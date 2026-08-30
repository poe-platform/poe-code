import assert from "node:assert/strict";
import test from "node:test";
import { quote, shell } from "./helpers.js";
import { isExtraSeqDiagnostic, observeSeqDiagnosticCandidate, seqDiagnosticFormats, seqDiagnosticOracle } from "./seq-diagnostic-profile.js";

test("seq diagnostic oracle is pinned GNU 9.7 on Darwin arm64", async context => {
  seqDiagnosticOracle.fixtures();
  const result = await seqDiagnosticOracle.qualify();
  if (result.status === "UNAVAILABLE") context.skip(result.reason);
  else context.diagnostic(`ADMITTED ${result.profileId}: identity/version only, not behavioral qualification`);
});

for (const [ordinal, format] of seqDiagnosticFormats.entries()) {
  test(`seq diagnostic ${JSON.stringify(format)}: ${isExtraSeqDiagnostic(format) ? "identify extra directive operand" : "preserve negative distinction or escaped-percent output"}`, async context => {
    const fixtureReady = Promise.resolve().then(() => seqDiagnosticOracle.fixtures()[ordinal]!);
    const candidateReady = fixtureReady.then(fixture => observeSeqDiagnosticCandidate(shell(), ["seq", ...fixture.args.map(quote)].join(" ")));
    void candidateReady.catch(() => {});
    const nativeChild = context.test("historical native comparison", async child => {
      const fixture = await fixtureReady;
      const result = await seqDiagnosticOracle.native(fixture.args);
      if (result.status === "UNAVAILABLE") { child.skip(result.reason); return; }
      const reference = result.identity.observation;
      assert.deepEqual(reference, fixture.native);
      const actual = await candidateReady;
      assert.equal(actual.exitCode, reference.exitCode);
      assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from(reference.stdoutHex, "hex"));
      if (isExtraSeqDiagnostic(format)) assert.deepEqual(Buffer.from(actual.stderrBytes), result.identity.stderrBytes);
      else if (["", "literal", "%%", "%%f"].includes(format)) assert.match(reference.stderr, /has no % directive\n$/u);
      else if (["%", "%%%", "%s", "%%%s"].includes(format)) assert.match(reference.stderr, /(?:ends in %|has unknown %s directive)\n$/u);
      else assert.deepEqual(Buffer.from(actual.stderrBytes), result.identity.stderrBytes);
    });
    let failed = false, failure: unknown;
    try {
      const fixture = await fixtureReady;
      const actual = await candidateReady;
      assert.equal(actual.exitCode, fixture.source.exitCode);
      assert.equal(Buffer.from(actual.stdoutBytes).toString("hex"), fixture.source.stdoutHex);
      if (isExtraSeqDiagnostic(format)) {
        assert.equal(actual.stderr, `seq: format '${format}' has too many % directives\n`);
      } else {
        assert.equal(actual.stderr, fixture.source.stderr);
        if (["", "literal", "%%", "%%f"].includes(format)) {
          assert.equal(actual.stderr, "seq: format must contain exactly one conversion\n");
        } else if (["%", "%%%", "%s", "%%%s"].includes(format)) {
          assert.equal(actual.stderr, "seq: format requires one f, e or g conversion\n");
        }
      }
    } catch (error) { failed = true; failure = error; }
    try { await nativeChild; }
    catch (error) { if (failed) throw new AggregateError([failure, error], "seq diagnostic portable and native child failed"); throw error; }
    if (failed) throw failure;
  });
}
