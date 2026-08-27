import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, directory, identity, root, save } from './tools.mjs';

const read = name => JSON.parse(readFileSync(directory + `evidence/${name}.json`, 'utf8'));
const traces = name => read(name).stdout.split('\n').filter(line => line.includes('HARNESS_TIMING ')).map(line => JSON.parse(line.slice(line.indexOf('HARNESS_TIMING ') + 'HARNESS_TIMING '.length)));
const canonical = read('canonical-summary');
const negatives = read('negative-summary');
const audit = read('static-audit');
const authentication = read('author-authentication');
const before = read('canonical-before');
const after = read('canonical-after');
const finalIdentity = identity();
save('evidence/final-identity.json', finalIdentity);
const jq = [];
const native = [];
const wrapperChildPids = [];
for (const result of canonical.semanticResults) {
  const records = traces(result.name);
  if (result.kind === 'jq') {
    const durations = records.filter(record => record.event === 'jq-execute-complete').map(record => record.detail.durationMs).sort((left, right) => left - right);
    jq.push({ name: result.name, triples: durations.length, cases: 15, processMs: result.durationMs,
      childModuleReadyAtPerformanceMs: records.find(record => record.event === 'jq-module-ready').atMs,
      executionMs: { minimum: durations[0], median: durations[Math.floor(durations.length / 2)], maximum: durations.at(-1) },
      processEvents: read(result.name).events.filter(event => ['spawn', 'first-byte', 'exit', 'stdout-close', 'stderr-close', 'close'].includes(event.event)),
    });
  } else {
    if (result.kind === 'wrapper') wrapperChildPids.push(records.find(record => record.event === 'streaming-module-ready').pid);
    for (const { detail } of records.filter(record => record.event === 'native-delivery')) {
      const event = name => detail.events.find(event => event.event === name)?.ms;
      native.push({ name: result.name, repetition: detail.repetition, pid: detail.pid, argv: detail.argv,
        spawnMs: event('spawn'), stdoutFirstMs: event('stdout-data'), readinessMs: event('ready'),
        suffixMs: detail.events.find(event => event.event === 'write' && event.detail.end).ms,
        exitMs: event('exit'), stdoutCloseMs: event('stdout-close'), stderrCloseMs: event('stderr-close'), childCloseMs: event('close'),
        actualClose: detail.actualClose, closeObserved: detail.closeObserved, activeTimers: detail.activeTimers, ownedListenersRemaining: detail.ownedListenersRemaining,
        timerEvents: detail.events.filter(event => event.event.startsWith('timer-')),
      });
    }
  }
}
const guardRows = negatives.attempts.map(attempt => ({
  name: attempt.name, expected: attempt.expected ?? null, actualFailure: attempt.actualFailure ?? null, durationMs: attempt.durationMs ?? null,
  outerFallbackFired: attempt.ownOuterFired ?? false, sentinelAlive: attempt.sentinelAlive ?? null,
  actualCloseBeforeAcknowledgementRelease: attempt.evidence?.actualClose ?? null,
  realControlledChildAlreadyClosed: attempt.independentlyClosedBeforeCleanup ?? null,
  timerFires: attempt.evidence?.events.filter(event => event.event === 'timer-fired') ?? [],
  assertionFailure: attempt.assertionFailure ?? null,
}));
const authorManifest = JSON.parse(readFileSync(root + 'tests/stress/harness-timing-20260827/evidence/author-manifest.json', 'utf8'));
const authorChanges = Object.entries({ ...authorManifest.code, ...authorManifest.artifacts, [authorManifest.report.path]: authorManifest.report.sha256 }).filter(([path, hash]) => digest(readFileSync(root + path)) !== hash).map(([path]) => path);
assert.deepEqual(authorChanges, []);
const globalTypes = 'tests/integration/full-gate-20260827/evidence/first/typecheck.stdout.log';
const globalTypeText = readFileSync(root + globalTypes, 'utf8');
save('evidence/historical-global-typecheck.stdout.log', globalTypeText);
const summary = {
  scope: 'independent harness-only verification; no default/source/fullgate acceptance',
  finalAt: finalIdentity.at, executionWindow: { start: before.at, end: after.at },
  profile: { node: before.node, platform: before.platform, arch: before.arch, rgVersion: read('native-profile').stdout },
  staticChecks: { passed: audit.checksPassed, total: audit.checksTotal, authenticatedAuthorFiles: authentication.verified.length, unchangedAuthorFilesAfterReview: authorChanges.length === 0 },
  completed: { canonicalInvocations: canonical.semanticResults.length, jqCases: jq.length * 15, jqTriples: jq.reduce((total, row) => total + row.triples, 0), streamingCases: 18, wrapperAssertions: 1, independentNegativeGuards: 7, calibration: 1 },
  jq, native, guardRows,
  cleanup: { reviewDriver: read('independent-guards'), canonicalDirectChildren: canonical.directlyOwned, controlledChildren: negatives.children, nativePrefixChildren: native.map(({ pid, actualClose, closeObserved, activeTimers, ownedListenersRemaining }) => ({ pid, actualClose, closeObserved, activeTimers, ownedListenersRemaining })), wrapperChildPids,
    wrapperAndThreeWholeWriteOracles: 'synchronous successful child status and complete captures; no per-stream asynchronous event timestamps exposed by unchanged shared helper',
    activeDirectChildren: canonical.activeChildren, maximumScheduledDescendants: 3 },
  source: { frozenAtCanonicalStart: Object.keys(before.hashes).filter(path => path.startsWith('src/')).length,
    changesSinceIndependentFreeze: audit.changesSinceIndependentFreeze,
    changesDuringCanonicalWindow: canonical.changed,
    changesAfterCanonicalBeforeReport: Object.entries(after.hashes).filter(([path, hash]) => finalIdentity.hashes[path] !== hash).map(([path, hash]) => ({ path, before: hash, after: finalIdentity.hashes[path] })),
    qualification: 'working-tree pre/post hashes, not a clean-checkout benchmark or proof of no transient intermediate mutation' },
  historicalGlobalTypes: { path: globalTypes, sha256: digest(globalTypeText), diagnostics: globalTypeText.split('\n').filter(line => line.includes('error TS')).length, role: 'historical fullgate cold-type failure retained; not rerun or edited; type remediation belongs to Plato/root' },
  authorScopedTypes: { source: 'tests/stress/harness-timing-20260827/evidence/final-scoped-types.json', code: JSON.parse(readFileSync(root + 'tests/stress/harness-timing-20260827/evidence/final-scoped-types.json')).code, qualification: 'authenticated author result, not a new independent typecheck' },
};
save('evidence/review-summary.json', summary);
console.log(JSON.stringify({ completed: summary.completed, executionWindow: summary.executionWindow, jq, native: native.map(({ timerEvents, ...rest }) => rest), guardRows, source: summary.source, historicalGlobalTypes: summary.historicalGlobalTypes }, null, 2));
