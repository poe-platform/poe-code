import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { counts, directory, frozenCases, inherited, inventory, json, save } from './common.mjs';
import { admit } from './run.mjs';
import { coverage, materialize, scalarPayload, scenario } from './mapping.mjs';
import { child, dispatchModes, series } from './series.mjs';

const results = [];
const test = async (id, execute) => { await execute(); results.push({ id, classification: 'SYNTHETIC_ONLY', status: 'pass' }); };
const original = inherited();
const data = await frozenCases();
await test('SYN01-immutable22-and86-membership', () => {
  assert.equal(Object.values(original).filter(entry => entry.kind === 'file').length, 22);
  assert.equal(data.cases.length, 82); assert.equal(data.diagnosticCases.length, 4);
  assert.equal(data.invariants.length, 12); assert.equal(data.integrationControls.length, 7);
  assert.equal(new Set([...data.cases, ...data.diagnosticCases].map(row => row.id)).size, 86);
});
await test('SYN02-exact-group-counts-and-field-mapping', () => {
  const mapping = coverage(data);
  const groups = {};
  for (const row of mapping) { groups[row.group] = (groups[row.group] ?? 0) + 1; assert.deepEqual(row.modes, ['source', 'installed', 'moved']); assert.equal(row.status, 'NOT RUN'); }
  assert.deepEqual(groups, { behavior: 16, permissions: 14, adapters: 6, state: 9, output: 5, cancellation: 5, limits: 27, diagnostics: 4 });
  assert(mapping.find(row => row.id === 'L26').sourceReviewFields.includes('state'));
});
await test('SYN03-frozen-type-fixture-membership-no-compiler', () => {
  const positive = readFileSync(resolve(directory, '../types-positive-v1.mts.fixture'), 'utf8');
  const negative = readFileSync(resolve(directory, '../types-negative-v1.mts.fixture'), 'utf8');
  assert.equal((positive.match(/^type Positive\d\d =/gmu) ?? []).length, 10);
  assert.equal((negative.match(/^export const Negative\d\d:/gmu) ?? []).length, 10);
});
await test('SYN04-exact-cap-arithmetic', () => {
  assert.equal(4098 + 4097 * 14, 61456); assert.equal(4097 * 2, 8194);
  assert.equal(48824 + 57 * 146312, 8388608);
  assert.equal(48824 + 1 + 57 * 146312 + 4 - 4, 8388609);
  assert.equal(40100 + 69 * 120008, 8320652);
  assert.equal(8388608 - 8320652, 67956); assert(67956 < 80004);
});
await test('SYN05-diagnostic-scalar-boundaries', () => {
  assert.equal(Buffer.byteLength(' [truncated]'), 12);
  for (const row of data.diagnosticCases) { const payload = scalarPayload(row); assert.equal(Buffer.byteLength(payload), row.outputBytes); assert(Buffer.byteLength(payload) <= 65792); if (row.truncated) assert(!/[\uD800-\uDBFF]$/u.test(payload.slice(0, -12))); }
  assert.equal(Buffer.byteLength(materialize(data.diagnosticCases[1].payload)), 65793);
});
await test('SYN06-derived-call-scripts-not-product-probes', () => {
  const get = id => scenario(data.cases.find(row => row.id === id), data.defaults);
  assert.equal(get('L18').calls.length, 8194);
  assert.equal(get('L19').calls.length, 114);
  assert.equal(get('L20').calls.filter(call => call.method === 'stat').length, 57);
  assert.equal(get('L20').calls.filter(call => call.method === 'access').length, 52);
  assert.equal(get('L21').calls.length, 138);
  for (const id of ['O02', 'O03', 'O04']) assert.deepEqual(get(id).calls.map(call => [call.method, call.path]), [['stat', '/p/t'], ['access', '/p/t']]);
  assert.equal(get('L26').source, 'cd /d; cd /e');
  assert.equal(Buffer.byteLength(get('L24').env.TARGET), 65536);
});
await test('SYN07-missing-pending-invalid-binding-gates-before-executor', async () => {
  let invocations = 0;
  const fakeExecutor = async () => { invocations++; throw new Error('SYNTHETIC executor must never be reached'); };
  const pending = json(resolve(directory, 'BINDING.pending.json'));
  for (const binding of [undefined, pending, { ...pending, state: 'routed-candidate' }, { ...pending, state: 'routed-candidate', candidateCommit: 'SYNTHETIC_NOT_A_SHA' }]) await assert.rejects(admit(binding, undefined, fakeExecutor), error => error.code === 'CD_REVIEW_ADMISSION_DENIED');
  assert.equal(invocations, 0);
});
await test('SYN08-fake-series-clean-assertion-failure-continues', async () => {
  const visited = [];
  const outcome = await series([{ id: 'FAKE-A' }, { id: 'FAKE-B' }], async row => { visited.push(row.id); return { id: row.id, status: row.id === 'FAKE-A' ? 'assertion-failure' : 'public-pass', cleanup: 'clean' }; });
  assert.deepEqual(visited, ['FAKE-A', 'FAKE-B']); assert.equal(outcome.stopped, false); assert.equal(outcome.results[0].status, 'assertion-failure');
});
await test('SYN09-fake-series-cleanup-failure-stops', async () => {
  let calls = 0;
  const outcome = await series([{ id: 'FAKE-A' }, { id: 'FAKE-B' }], async row => { calls++; return { id: row.id, status: 'cleanup-failure', cleanup: 'failed' }; });
  assert.equal(calls, 1); assert.equal(outcome.reason, 'cleanup-failure');
});
await test('SYN10-fake-series-awaits-cleanup-before-next', async () => {
  const events = [];
  await series([{ id: 'FAKE-A' }, { id: 'FAKE-B' }], async row => { events.push(`${row.id}:start`); await new Promise(resolve => setImmediate(resolve)); events.push(`${row.id}:cleanup`); return { id: row.id, status: 'public-pass-design-pending', cleanup: 'clean' }; });
  assert.deepEqual(events, ['FAKE-A:start', 'FAKE-A:cleanup', 'FAKE-B:start', 'FAKE-B:cleanup']);
});
await test('SYN11-fake-modes-dispatch-and-stop', async () => {
  assert.deepEqual((await dispatchModes(async () => ({ naturalSettlement: true, cleanupClean: true }))).map(row => row.mode), ['source', 'installed', 'moved']);
  assert.equal((await dispatchModes(async () => ({ naturalSettlement: false, cleanupClean: false }))).length, 1);
});
await test('SYN12-synthetic-child-natural-and-ordinary-failure', async () => {
  const normal = await child(process.execPath, ['-e', 'process.stdout.write("SYNTHETIC_ONLY");'], { env: {} });
  assert.equal(normal.stdout, 'SYNTHETIC_ONLY'); assert.equal(normal.status, 0); assert(normal.naturalSettlement);
  const failure = await child(process.execPath, ['-e', 'process.stderr.write("SYNTHETIC_ONLY");process.exitCode=1;'], { env: {} });
  assert.equal(failure.status, 1); assert(failure.cleanupClean && failure.naturalSettlement);
});
await test('SYN13-synthetic-child-bounded-capture', async () => {
  const capture = await child(process.execPath, ['-e', 'process.stdout.write("SYNTHETIC_ONLY".repeat(1024));setInterval(()=>{},100);'], { env: {}, bounds: { maxCaptureBytes: 64, timeoutMs: 3000, killGraceMs: 100 } });
  assert.equal(capture.stopReason, 'capture-bound'); assert(!capture.naturalSettlement && !capture.cleanupClean); assert(capture.bytes <= 64);
  const timeout = await child(process.execPath, ['-e', 'setInterval(()=>{},100);'], { env: {}, bounds: { timeoutMs: 100, killGraceMs: 100 } });
  assert.equal(timeout.stopReason, 'harness-timeout'); assert(!timeout.cleanupClean && !timeout.naturalSettlement);
});
await test('SYN14-missing-binding-cli-denial-no-product', async () => {
  const result = await child(process.execPath, [resolve(directory, 'run.mjs')], { env: {} });
  assert.equal(result.status, 1); assert(result.naturalSettlement);
  assert.equal(JSON.parse(result.stderr).code, 'CD_REVIEW_ADMISSION_DENIED');
});
await test('SYN15-pending-template-cli-denial-no-product', async () => {
  const result = await child(process.execPath, [resolve(directory, 'run.mjs'), resolve(directory, 'BINDING.pending.json'), resolve(directory, 'ROUTE.pending.json')], { env: {} });
  assert.equal(result.status, 1); assert(result.naturalSettlement); assert.equal(JSON.parse(result.stderr).code, 'CD_REVIEW_ADMISSION_DENIED');
});
await test('SYN16-exact-membership-addition-and-change-negatives', () => {
  const originalOwn = inventory(directory);
  for (const originalMap of [originalOwn, original]) {
    assert.throws(() => assert.deepEqual({ ...originalMap, 'SYNTHETIC-ADDITION': { kind: 'directory', mode: 493 } }, originalMap));
    const key = Object.keys(originalMap).find(name => originalMap[name].kind === 'file');
    assert.throws(() => assert.deepEqual({ ...originalMap, [key]: { ...originalMap[key], bytes: originalMap[key].bytes + 1 } }, originalMap));
  }
});
await test('SYN17-owned-syntax-only', () => {
  for (const file of readdirSync(directory).filter(name => name.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', resolve(directory, file)], { stdio: 'pipe' });
});
assert.deepEqual(inherited(), original);
const result = { schema: 1, classification: 'SYNTHETIC_PREPARATION_ONLY_POST_AUTHOR_RELEASE', checkedAt: new Date().toISOString(), node: process.version, syntheticChecks: results.length, results, frozenCounts: counts, futureModes: { source: '86 NOT RUN; types10+10 NOT RUN', installed: '86 NOT RUN; types10+10 NOT RUN', moved: '86 NOT RUN; types10+10 NOT RUN' }, candidateInspected: false, productImports: 0, productExecution: 0, nativeRuns: 0, providerRuns: 0, typeCompilerRuns: 0, buildPackInstall: 0 };
if (process.argv.includes('--record')) save(resolve(directory, 'SYNTHETIC-RESULTS.json'), result);
console.log(JSON.stringify(result, null, 2));
