import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { owned, save, sha256 } from './support.mjs';

const names = ['inputs.json', 'baseline-6e3e316.json', 'aligned-native-20260827.json'];
const bytes = await Promise.all(names.map(name => readFile(resolve(owned, name))));
const [inputs, baseline, native] = bytes.map(value => JSON.parse(value));
const specimens = inputs.rows.filter(row => ['differential', 'syntax', 'gaps'].includes(row.cohort));
const observations = baseline.records.filter(row => row.context === 'original');
assert.equal(specimens.length, 88);
assert.equal(observations.length, 88);
assert.equal(baseline.sourceCommit, '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a');
assert.equal(baseline.stable, true);
const bytesAndTypes = entries => Object.fromEntries(Object.entries(entries).map(([path, { mode, ...entry }]) => [path, entry]));
const profiles = [];
for (const profile of native.profiles) {
  assert.deepEqual(profile.rows.map(row => row.id), specimens.map(row => row.id));
  const rows = profile.rows.map(reference => {
    const input = specimens.find(row => row.id === reference.id);
    const saved = observations.find(row => row.id === reference.id);
    assert.ok(saved.valid);
    assert.equal(saved.result.launch.actualSource, input.source);
    assert.deepEqual(saved.result.launch.calls, []);
    assert.deepEqual(saved.result.launch.originalRootEnv, {});
    assert.equal(reference.source, input.source);
    assert.deepEqual(reference.args, ['--noprofile', '--norc', '-c', input.source, 'shell']);
    assert.equal(reference.stdinHex, input.stdinHex);
    const actual = saved.result.actual;
    const expected = { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects };
    const fields = Object.fromEntries(['stdout', 'stderr', 'status', 'effects'].map(field => [field, isDeepStrictEqual(actual[field], expected[field])]));
    const streamsExact = fields.stdout && fields.stderr && fields.status;
    const fileBytesAndTypesExact = isDeepStrictEqual(bytesAndTypes(actual.effects), bytesAndTypes(expected.effects));
    const originalComparedFieldsExact = streamsExact && fileBytesAndTypesExact;
    const modeDifferences = Object.keys(expected.effects).filter(path => actual.effects[path] && actual.effects[path].mode !== expected.effects[path].mode).map(path => ({ path, native: expected.effects[path].mode, virtual: actual.effects[path].mode }));
    const originalSyntaxAssertion = input.cohort === 'syntax' ? actual.status === 2 && actual.stdout === '' && actual.stderr !== '' && Object.keys(actual.effects).length === 0 : null;
    return { id: input.id, cohort: input.cohort, source: input.source, sourceSha256: sha256(input.source), productRecordContext: saved.context, productBeforeGuard: saved.before, productAfterGuard: saved.after, productLoadGuard: saved.loads, productExecutionReused: true, native: expected, virtual: actual, fields, streamsExact, fileBytesAndTypesExact, originalComparedFieldsExact, originalSyntaxAssertion, fullTupleExact: Object.values(fields).every(Boolean), modeDifferences };
  });
  const totals = subset => ({ denominator: subset.length, originalComparedFieldsExact: subset.filter(row => row.originalComparedFieldsExact).length, fullTupleExact: subset.filter(row => row.fullTupleExact).length, modeLossRows: subset.filter(row => row.modeDifferences.length).length, originalAssertionPass: subset.filter(row => row.originalSyntaxAssertion ?? row.originalComparedFieldsExact).length });
  profiles.push({ id: profile.id, total: totals(rows), cohorts: Object.fromEntries(['differential', 'syntax', 'gaps'].map(cohort => [cohort, totals(rows.filter(row => row.cohort === cohort))])), rows });
}
save('aligned-comparison-20260827.json', { phase: 'preparation only; no candidate inspected/executed', createdAt: new Date().toISOString(), inputs: Object.fromEntries(names.map((name, index) => [name, sha256(bytes[index])])), sourceCommit: baseline.sourceCommit, productReused: { observations: 88, comparisons: 176, sourceCaptureStartedAt: baseline.startedAt, sourceCaptureCompletedAt: baseline.capturedAt, freshExecutions: 0, archivedSourceOnly: true, originalInputGuard: baseline.originalInputGuard, runtime: baseline.committed['src/shell/runtime.ts'], parser: baseline.committed['src/shell/parser.ts'], context: 'Direct Shell.exec(original source); saved launch.args is unused rendering metadata, not an executed virtual bash -c wrapper.' }, comparisonScope: 'Exact streams/status and relative file bytes/types (original assertion shape); full tuples and all mode losses separately retained, not waived. Syntax originals had broader assertions, shown separately from strict bytes.', profiles });
console.log(JSON.stringify(profiles.map(profile => ({ id: profile.id, total: profile.total, cohorts: profile.cohorts })), null, 2));
