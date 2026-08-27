import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const output = resolve(process.argv[2] ?? join(own, 'evidence-final'));
assert.ok(output.startsWith(own + '/') || output.startsWith('/tmp/'));
const load = async name => JSON.parse(await readFile(join(output, name), 'utf8'));
const manifest = await load('manifest.json');
const cleanup = await load('cache-cleanup.json');
assert.equal(manifest.source, 'c7823633ee99f711f1319ace59d4cf2b7f622ecc');
assert.equal(manifest.completed, true);
assert.equal(manifest.frozenInputsUnchanged, true);
assert.equal(manifest.cleanedOwnedScratch, true);
assert.equal(cleanup.foreignEntriesUntouched, true);
const sourceCohorts = {};
for (const [label, total, pass, fail] of [['source-original223', 223, 221, 2], ['source-existing83', 83, 83, 0], ['source-new54', 54, 54, 0]]) {
  const bytes = await readFile(join(output, label + '.stdout'));
  const rows = [...bytes.toString().matchAll(/^( *)(not ok|ok) (\d+) - (.*)$/gm)].map(match => ({
    name: match[4], result: match[2] === 'ok' ? 'pass' : 'fail', nestingSpaces: match[1].length, tapNumber: Number(match[3]),
  }));
  assert.equal(rows.length, total); assert.equal(rows.filter(row => row.result === 'pass').length, pass); assert.equal(rows.filter(row => row.result === 'fail').length, fail);
  assert.deepEqual(manifest.commands[label].counts, { tests: total, pass, fail, cancelled: 0, skipped: 0, todo: 0 });
  sourceCohorts[label] = { total, pass, fail, mode: 'unchanged full-source-archive fixtures; not packed',
    rawStdoutFile: label + '.stdout', rawStderrFile: label + '.stderr', rawRunnerBytes: {
      stdout: manifest.commands[label].stdout, stderr: manifest.commands[label].stderr,
    }, commandByteTelemetry: 'Original tests do not log each successful internal command capture; none fabricated. Assertions, names and raw TAP including failing status expected1/actual0 are preserved.', rows };
}
assert.deepEqual(sourceCohorts['source-original223'].rows.filter(row => row.result === 'fail').map(row => row.name), [
  'date rejects unsupported/invalid input without stdout: -d@0 +%12N',
  'date rejects unsupported/invalid input without stdout: -d@0 +%-N',
]);
const old = await load('holdouts.json'), current = await load('hidden-rows.json'), controls = await load('controls.json'), profiles = await load('fresh-native-matrix.json');
assert.equal(old.rows.length, 305); assert.equal(old.rows.filter(row => row.result === 'pass').length, 304);
const appleFailure = old.rows.filter(row => row.result === 'fail');
assert.equal(appleFailure.length, 1);
assert.equal(appleFailure[0].name, 'Apple BSD printenv separate profile');
assert.deepEqual(appleFailure[0].expected, { status: 0, stdoutHex: '0a', stderrHex: '' });
assert.deepEqual(appleFailure[0].actual, { status: 0, stdoutHex: '0ae99baa0a', stderrHex: '' });
assert.equal(current.rows.length, 304); assert.ok(current.rows.every(row => row.result === 'pass'));
assert.equal(controls.rows.length, 14); assert.ok(controls.rows.every(row => row.result === 'pass'));
const sleep8 = old.rows.filter(row => ['public-sleep-lifecycle', 'public-sleep-isolation'].includes(row.category));
assert.equal(sleep8.length, 8); assert.ok(sleep8.every(row => row.result === 'pass'));
assert.equal(profiles.rows.length, 36); assert.equal(profiles.rows.filter(row => row.gnuMatch).length, 31);
assert.equal(profiles.rows.filter(row => row.appleMatch).length, 0);
assert.ok(profiles.rows.filter(row => !row.gnuMatch).every(row => row.category === 'zone-label-profile'));
const historical = await load('historical/native-after-v1.json');
const bare = historical.rows.filter(row => row.category === 'host-resolution-bare-N-profile');
assert.equal(bare.length, 12); assert.equal(bare.filter(row => !row.gnuMatch).length, 11);
for (const [label, count, codes] of [
  ['public-negative-types', 2, [2353, 2322]],
  ['internal-leaf-negative-types', 5, [2353, 2322, 2741, 2322, 2322]],
  ['public-time-env-unavailable-types', 2, [2724, 2305]],
]) {
  const diagnostic = await readFile(join(output, label + '.stdout'), 'utf8');
  const observed = [...diagnostic.matchAll(/error TS(\d+)/g)].map(match => Number(match[1]));
  assert.equal(observed.length, count); assert.deepEqual(observed, codes);
  assert.ok(!/TS2307|Cannot find module|Cannot find type definition|TS6053|TS5083/.test(diagnostic));
}
for (const [label, command] of Object.entries(manifest.commands)) {
  assert.equal(command.clean, true, label); assert.deepEqual(command.survivors, [], label);
  for (const stream of ['stdout', 'stderr']) {
    const bytes = await readFile(join(output, label + '.' + stream));
    assert.equal(bytes.length, command[stream].bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), command[stream].sha256);
  }
}
const result = {
  identity: manifest.identity, frozenSource: manifest.source, sourceAcceptance: false, canonicalAssertionChangesAuthorized: false,
  packageSha256: manifest.package.sha256, sourceCohorts,
  packedCohorts: {
    original305: { total: 305, pass: 304, fail: 1, rawRows: 'holdouts.json', failures: appleFailure,
      adaptation: 'Only two import paths and their import.meta.resolve metadata paths; original assertions and labels unchanged.' },
    immutable304: { total: 304, pass: 304, fail: 0, rawRows: 'hidden-rows.json', adaptation: 'None; committed holdout and guard are byte-identical.' },
    originalSleep8: { total: 8, pass: 8, fail: 0, subsetOf: 'original305, not an additive denominator', rows: sleep8 },
    controls14: { total: 14, pass: 14, fail: 0, rawRows: 'controls.json' },
  },
  profiles: {
    measuredExisting36: { total: 36, GNU97DarwinMatches: 31, GNU97DarwinNonmatches: 5, AppleMatches: 0,
      rawRows: 'fresh-native-matrix.json', nonmatches: profiles.rows.filter(row => !row.gnuMatch) },
    historicalBareN: { classification: 'UNCHANGED AUTHOR CAPTURE, NOT a new independent native replay or semantic acceptance',
      total: 12, exactGNU97DarwinMatches: 1, nonmatches: 11, rawRows: 'historical/native-after-v1.json', rows: bare },
  },
  publicApi: {
    positive: 'Exported virtual-bash Shell/FS/registry/plugin types and emitted bare imports work.',
    negativeTypes: { actualPublicRoot: ['TS2353 unknown Shell option', 'TS2322 incorrect command callback'],
      internalPackedLeafOnly: ['TS2353 unknown family option', 'TS2322 clock result', 'TS2741 incomplete scheduler', 'TS2322 output limit', 'TS2322 timer callback'],
      missingPublicTimeEnv: ['TS2724 createTimeEnvCommands absent from root', 'TS2305 timeEnvCommands absent from root'] },
    timeEnvPublicFactoryAvailable: false, timeEnvExportMapSubpathAvailable: false, defaultCommandCount: 65, defaultTimeEnvIntegration: false,
    guardNegative: 'Actual archived build/dist import rejected by unchanged packed guard, not a missing-module failure.',
  },
  cacheCleanup: { removedProvenOwnedEntries: cleanup.removed.length, foreignEntriesUntouched: true, evidence: 'cache-cleanup-before.json and cache-cleanup.json' },
  verdict: 'Scoped cohort/packaging replay matches the recorded expectations, with original failures and profile nonmatches retained. No source-semantic, public-time-env, whole-product, performance or superiority acceptance.',
};
await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ source: Object.fromEntries(Object.entries(sourceCohorts).map(([name, cohort]) => [name, { total: cohort.total, pass: cohort.pass, fail: cohort.fail }])), packed: manifest.summary, gate: 'expected scoped results verified; not all-pass or source acceptance' }, null, 2));
