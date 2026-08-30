import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { directory, digest, verifySeal } from './seal.mjs';
import { evaluate as originalEvaluate } from '../safety-v1/oracle.mjs';
import { verifySeal as originalSeal } from '../safety-v1/seal.mjs';

const sealed = verifySeal();
const evidenceRoot = join(directory, '../safety-run-evidence');
const evidence = JSON.parse(readFileSync(join(evidenceRoot, 'MANIFEST.json')));
for (const entry of evidence.files) {
  const bytes = readFileSync(join(evidenceRoot, entry.path));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(digest(bytes), entry.sha256, entry.path);
}
const rootAuth = JSON.parse(readFileSync(join(evidenceRoot, 'original-root-approved.json')));
const originalProposal = JSON.parse(readFileSync(join(evidenceRoot, 'original-proposal.json')));
assert.deepEqual({ ...rootAuth, approval: originalProposal.approval }, originalProposal);
const original = originalSeal();
const summaryBytes = readFileSync(join(evidenceRoot, 'original-run/summary.json'));
assert.equal(digest(summaryBytes), sealed.manifest.originalRunSummarySha256);
const summary = JSON.parse(summaryBytes);
assert.equal(summary.childStarts, 4);
assert.equal(summary.observedCommandStarts, 4);
assert.equal(summary.incompleteChildrenHaveUnknownFinalProductEffects, false);
assert.equal(summary.nativeCalls, 0);
assert.equal(summary.retries, 0);
assert.deepEqual(summary.rows.map(row => row.id), original.cases.map(entry => entry.id));
assert.deepEqual(summary.rows.map(row => row.status), ['pass', 'HOLD', 'HOLD', 'pass', 'pass', 'pass']);
const allowedFiles = new Map(rootAuth.files.map(entry => [entry.path, entry.sha256]));
const rows = [];
for (const row of summary.rows) {
  if (row.status === 'HOLD') {
    assert.equal(row.productInvocations, 0);
    assert.equal(row.pid, undefined);
    assert.equal(row.report, undefined);
    rows.push({ id: row.id, status: 'HOLD', childStarts: 0, commandStarts: 0 });
    continue;
  }
  const entry = original.cases.find(value => value.id === row.id);
  assert.equal(originalEvaluate(entry, row.report).status, 'pass');
  assert.equal(row.childCode, 0);
  assert.equal(row.signal, null);
  assert.equal(row.stopped, undefined);
  assert.equal(row.report.heapSizeLimit, 134217728);
  assert(row.observedRss <= original.caps.observedRssBytes);
  const transport = ['stdout', 'stderr'].reduce((total, stream) => total + readFileSync(join(evidenceRoot, `original-run/${row.id}.${stream}.txt`)).length, 0);
  assert(transport + row.report.stdoutBytes + row.report.stderrBytes <= original.caps.captureBytes);
  const modules = readFileSync(join(evidenceRoot, `original-run/${row.id}.modules.jsonl`), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  for (const module of modules) {
    assert(module.path.startsWith(rootAuth.snapshot + '/'));
    assert.equal(module.sha256, allowedFiles.get(module.path.slice(rootAuth.snapshot.length + 1)));
  }
  rows.push({ id: row.id, status: row.status, childStarts: 1, commandStarts: row.observedCommandStarts, childCode: row.childCode,
    disposed: row.report.shellDisposed, unhandled: row.report.unhandled.length, mutations: row.report.mutations,
    observedRss: row.observedRss, heapLimit: row.report.heapSizeLimit, productStdoutBytes: row.report.stdoutBytes,
    productStderrBytes: row.report.stderrBytes, transportBytes: transport, moduleLoads: modules.length,
    streamBytes: row.report.streams.reduce((total, stream) => total + stream.bytes, 0),
    iteratorReturns: row.report.streams.reduce((total, stream) => total + stream.returned, 0) });
}
console.log(JSON.stringify({ kind: 'offline-original-evidence-and-derived-seal-validation', rows, previousProductInvocations: 4,
  newProductInvocations: 0, derivedRowsPrepared: sealed.cases.map(entry => entry.id), derivedAuthorization: 'PENDING_ROOT', nativeCalls: 0 }, null, 2));
