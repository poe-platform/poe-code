import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { containedJob } from './watchdog.mjs';
import { addEvidence, cohorts, compare, frozen, json, owned, sha256, verifyFrozen } from './review.mjs';

const stage = JSON.parse(readFileSync(`${owned}/candidate-fe7083d9-20260827/stage.json`));
const label = process.argv[2];
if (!label) { verifyFrozen(); console.log('Read-only verification complete. Candidate capture requires a NEW explicit label.'); process.exit(0); }
assert(/^[a-z0-9-]+$/.test(label));
const destination = `${owned}/${label}`;
assert(!existsSync(destination), 'unique acceptance destination required');
const before = verifyFrozen();
const driver = pathToFileURL(resolve(owned, 'runtime-driver.mjs')).href;
const candidate = { commit: stage.commit, sourceTreeSha256: stage.sourceTreeSha256, adapterSha256: sha256(readFileSync(new URL(driver))), installedArtifactSha256: stage.installedArtifactSha256, dirty: false };
const importGraph = new Map(), traces = [], summaries = [];
let failures = 0;
for (const cohort of cohorts()) {
  const report = { schema: 1, freezeManifestSha256: sha256(frozen(cohort.commit, `${cohort.base}/evidence/${cohort.id === 'original95' ? 'original-20260827' : 'native-20260827'}/manifest.json`)), candidate, profiles: [] };
  const comparisons = [];
  for (const profile of cohort.receipt.profiles) {
    const observed = { id: profile.id, environment: profile.environment, results: [] };
    const expectedRows = profile.results ?? [{ ...profile.result, argvUtf8Hex: cohort.receipt.argvUtf8Hex }];
    for (const expected of expectedRows) {
      const argv = expected.argvUtf8Hex.map(hex => Buffer.from(hex, 'hex').toString('utf8'));
      const outer = await containedJob(driver, { installed: stage.installed, mode: 'native', argv, environment: profile.environment });
      const envelope = outer.state === 'returned' && outer.value?.state === 'fulfilled' ? outer.value.value : null;
      const actual = envelope?.result;
      const row = { id: expected.id, caseSha256: expected.caseSha256 ?? null,
        status: actual?.status ?? null, stdoutBase64: actual?.stdoutBase64 ?? '', stderrBase64: actual?.stderrBase64 ?? '', signal: null,
        failure: !actual || envelope.controlFailure ? { outer: outer.state, inner: outer.value?.state, control: envelope?.controlFailure } : null };
      observed.results.push(row);
      const comparison = compare(expected, row);
      if (!comparison.strict) failures++;
      comparisons.push({ id: expected.id, profile: profile.id, argv, expected, actual: row, comparison,
        classification: comparison.semantic ? comparison.diagnostic ? 'strict match' : 'diagnostic difference' : Buffer.from(row.stderrBase64, 'base64').toString().includes('locale') ? 'unsupported named locale; frozen mismatch retained' : 'semantic/status/output difference' });
      for (const edge of envelope?.imports ?? []) importGraph.set(`${edge.parent}\0${edge.resolved}`, edge);
      traces.push({ cohort: cohort.id, profile: profile.id, id: expected.id, events: envelope?.events, activeBeforeSafetyCleanup: envelope?.activeBeforeSafetyCleanup, mainCompiles: actual?.mainCompiles, stdinAccess: actual?.stdinAccess, fsAccess: actual?.fsAccess, invokeAccess: actual?.invokeAccess, outer: { ...outer, value: undefined } });
    }
    report.profiles.push(observed);
  }
  const summary = { cohort: cohort.id, profiles: report.profiles.map(profile => {
    const rows = comparisons.filter(row => row.profile === profile.id);
    return { id: profile.id, denominator: rows.length, semanticMatches: rows.filter(row => row.comparison.semantic).length, diagnosticMatches: rows.filter(row => row.comparison.diagnostic).length, strictMatches: rows.filter(row => row.comparison.strict).length };
  }) };
  summaries.push(summary);
  addEvidence(`${destination}/${cohort.id}-report.json`, report);
  addEvidence(`${destination}/${cohort.id}-comparison.json`, { candidate, ...summary, rows: comparisons });
  console.log(json(summary));
}
assert.deepEqual(verifyFrozen(), before);
addEvidence(`${destination}/runtime-traces.json`, { candidate, traces, importGraph: [...importGraph.values()], bounds: { outerWorkerDeadlineMs: 2000, outerOldGenerationMb: 64, outputBytes: 8192, maximumConcurrentProbes: 1 }, noSourceFallback: true });
addEvidence(`${destination}/summary.json`, { candidate, summaries, strictFailures: failures, acceptance: failures ? 'FAIL: frozen mismatches retained' : 'native tuples only; controls not covered', frozenIntegrityAfter: true });
