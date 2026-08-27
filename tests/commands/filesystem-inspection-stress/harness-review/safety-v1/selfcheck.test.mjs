import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifySeal, directory, digest } from './seal.mjs';
import { evaluate } from './oracle.mjs';
import { fixtureFs } from './vfs.mjs';
import { authorize, checkPremise } from './authorization.mjs';
import { inspectPreparation } from './run.mjs';

const { cases, caps } = verifySeal();
const call = (method, path) => ({ method, path, signalPresent: true, signalAbortedAtEntry: false });
function conformingMock(entry) {
  const report = { id: entry.id, actualShell: true, shellDisposed: true, commandInvocations: 1, mutations: 0, unhandled: [], stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
    calls: [], streams: [], rejected: false, exitCode: 0 };
  if (entry.id === 'T-empty-many') {
    report.stdout = entry.expected.stdout;
    report.calls = [call('lstat', '/root'), call('readdir', '/root'), ...entry.entries.filter(item => item.type === 'file').map(item => call('lstat', item.path))];
  } else if (entry.family === 'tree') {
    report.rejected = true;
    report.exitCode = null;
    report.error = { code: 'EFBIG', message: 'tree work limit exceeded (4096)', truncated: false };
    report.calls = [call('lstat', '/root'), call('readdir', '/root')];
  } else if (entry.id === 'F-metadata-many') {
    report.exitCode = 1;
    report.stderr = 'file: output limit exceeded\n';
    report.calls = [call('lstat', '/link-0000'), call('readlink', '/link-0000')];
  } else {
    const json = entry.id === 'F-JSON-cumulative';
    const count = json ? 2 : 32;
    for (const path of entry.args.slice(2, count + 2)) {
      report.calls.push(call('lstat', path), call('readStream', path));
      report.streams.push({ path, start: 0, endExclusive: entry.limits.maxSniffBytes, chunkSize: entry.chunkBytes, bytes: json ? 8190 : 512, next: json ? 9 : 5, returned: 0 });
    }
    report.stdout = json ? entry.expected.line : 'application/octet-stream; charset=binary\n'.repeat(32);
    if (json) { report.exitCode = 1; report.stderr = 'file: step limit exceeded\n'; }
  }
  report.stdoutBytes = Buffer.byteLength(report.stdout);
  report.stderrBytes = Buffer.byteLength(report.stderr);
  report.stdoutBase64 = Buffer.from(report.stdout).toString('base64');
  report.stderrBase64 = Buffer.from(report.stderr).toString('base64');
  return report;
}

test('six inputs are sealed, bounded, and no product is imported by preparation', () => {
  assert.equal(cases.length, 6);
  const preparation = inspectPreparation();
  assert.equal(preparation.productExecutions, 0);
  assert.equal(caps.childWallMs, 5000);
  assert.equal(caps.heapMiB, 128);
  assert.equal(caps.observedRssBytes, 268435456);
  assert.equal(caps.captureBytes, 65536);
  assert.equal(caps.wholeWallMs, 30000);
  assert.equal(preparation.presealSha256, digest(readFileSync(join(directory, 'PRESEAL.json'))));
  assert.equal(cases[0].args[3], '|'.repeat(255));
  assert(cases[0].entries.filter(item => item.type === 'file').every(item => item.path.slice(6).length === 128));
  assert(cases[2].entries.filter(item => item.path.startsWith('/root/')).every(item => item.path.slice(6).length === 512));
  assert.equal(cases[0].expected.oldRowAllocationBytes, 256 * 64 * 129);
});

test('JSON/header/metadata payload recipes preserve finite proposed sizes', () => {
  for (const entry of cases[3].entries.filter(item => item.type === 'file')) {
    const bytes = Buffer.from(entry.base64, 'base64');
    assert.equal(bytes.length, 8190);
    assert.throws(() => JSON.parse(bytes.toString('utf8')), SyntaxError);
  }
  assert.equal(cases[4].entries.filter(item => item.type === 'file').length, 32);
  assert(cases[4].entries.filter(item => item.type === 'file').every(item => Buffer.from(item.base64, 'base64').length === 512));
  assert.equal(cases[5].entries.filter(item => item.type === 'symlink').length, 32);
  assert(cases[5].entries.filter(item => item.type === 'symlink').every(item => item.target === '\u0001'.repeat(4096)));
});

for (const entry of cases) {
  test(`${entry.id}: finite conforming mock accepted, lost semantics rejected`, () => {
    const good = conformingMock(entry);
    assert.equal(evaluate(entry, good).status, 'pass');
    const bad = structuredClone(good);
    if (entry.id === 'T-empty-many') bad.stdout = '/root\n';
    else if (entry.family === 'tree') { bad.rejected = false; bad.exitCode = 0; }
    else if (entry.id === 'F-JSON-cumulative') { bad.exitCode = 0; bad.stdout = entry.expected.line.repeat(8); }
    else if (entry.id === 'F-header-many') bad.streams[0].endExclusive = Number.MAX_SAFE_INTEGER;
    else bad.stdout = 'invented diagnostic output';
    bad.stdoutBytes = Buffer.byteLength(bad.stdout);
    bad.stdoutBase64 = Buffer.from(bad.stdout).toString('base64');
    assert.throws(() => evaluate(entry, bad), assert.AssertionError);
    assert.throws(() => evaluate(entry, { ...good, mutations: 1 }), assert.AssertionError);
    assert.throws(() => evaluate(entry, { ...good, shellDisposed: false }), assert.AssertionError);
  });
}

test('frozen source premise gates reject per-entry resets and constant comparison costs', () => {
  assert.throws(() => checkPremise(cases[0], { status: 'approved', emptyAlternativesNormalized: false }));
  assert.throws(() => checkPremise(cases[1], { status: 'approved', singleEntryMaximumWork: 2322, invocationMinimumWork: 10000, perOperandReset: true }));
  assert.throws(() => checkPremise(cases[2], { status: 'approved', comparedByteCostMetered: false, bothSortPassesMetered: true, minimumComparisonByteWork: 32067 }));
  assert.throws(() => checkPremise(cases[3], { status: 'approved', singleEntryMaximumWork: 8199, invocationMinimumWork: 65592, perOperandReset: false, twoEntryMinimumWork: 16000 }));
  assert.doesNotThrow(() => checkPremise(cases[3], { status: 'approved', singleEntryMaximumWork: 8199, invocationMinimumWork: 65592, perOperandReset: false, twoEntryMinimumWork: 16398 }));
  assert.doesNotThrow(() => checkPremise(cases[1], { status: 'invalidated', basis: 'suffix optimization eliminates chosen work' }));
  assert.throws(() => authorize(undefined, undefined), assert.AssertionError);
});

test('fixture producer is signal-aware and streams owned finite bytes without product code', async () => {
  class MockFsError extends Error { constructor(code) { super(code); this.code = code; } }
  const entry = cases[4];
  const trace = { calls: [], streams: [], mutations: 0 };
  const fs = fixtureFs(entry, MockFsError, trace);
  const signal = new AbortController().signal;
  const stream = fs.readStream('/header-0000', { signal, start: 0, endExclusive: 1024, chunkSize: 128 });
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  assert.equal(bytes, 512);
  assert.equal(trace.streams[0].next, 5);
  await assert.rejects(fs.writeFile('/header-0000', new Uint8Array()), /Forbidden fixture mutation/u);
  assert.equal(trace.mutations, 1);
});
