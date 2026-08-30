import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), read = path => readFileSync(join(here, path));
const result = JSON.parse(read('attempt-1/RESULT.json'));
assert.equal(result.error, undefined); assert.equal(result.bodyAcceptance, true); assert.equal(result.cleaned, true);
assert.deepEqual(result.counts, { tests: 45, pass: 45, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
assert.equal(result.runtime.version, 'v24.11.1'); assert.equal(result.runtime.sha256, '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0');
assert.equal(result.originalRuntime.version, 'v22.22.2');
assert.equal(result.runnerSha256, hash(read('run.mjs')));
assert.equal(result.wholeGate, false); assert.equal(result.sourceEdits, false); assert.equal(result.engineBuiltOrInstalled, false); assert.equal(result.privateExecution, false);
assert.equal(result.phases.length, 4); assert.deepEqual(result.phases.map(phase => phase.accounting.summary.tests), [7, 7, 25, 6]);
assert.equal(result.controls.length, 3); assert.deepEqual(result.controls.map(phase => phase.status), [0, 1, 1]);
for (const phase of [...result.phases, ...result.controls]) {
  assert.equal(phase.clean, true); assert.equal(phase.timedOut, false); assert.equal(phase.outputExceeded, false); assert.equal(phase.signal, null); assert.deepEqual(phase.signals, []); assert.deepEqual(phase.survivors, []);
  for (const channel of ['stdout', 'stderr']) assert.equal(hash(read(`attempt-1/${phase.label}.${channel}.log`)), phase[`${channel}Sha256`]);
  const receipts = read(`attempt-1/${phase.label}.runtime.ndjson`).toString().trim().split('\n').map(line => JSON.parse(line)); assert.deepEqual(receipts, phase.runtime);
  for (const receipt of receipts) { assert.equal(receipt.version, result.runtime.version); assert.equal(receipt.sha256, result.runtime.sha256); assert.equal(receipt.realExecPath, result.runtime.executable); assert.equal(receipt.source, result.environment.FULL_GATE_SOURCE); assert.equal(receipt.safejsRoot, result.engineCopy.root); }
  if (phase.entry) {
    assert.ok(!phase.args.some(value => value.includes('test-name-pattern'))); assert.equal(phase.status, 0); assert.equal(phase.accounting.reconciled, true);
    assert.ok(receipts.some(receipt => receipt.argv[1] === join(result.environment.FULL_GATE_SOURCE, phase.entry) && phase.observed.some(process => process.pid === receipt.pid)));
    const bytes = execFileSync('git', ['--no-replace-objects', 'show', `${result.candidate}:${phase.entry}`], { cwd: repository, timeout: 10000 }); assert.equal(hash(bytes), result.source[phase.entry].sha256);
    const text = read(`attempt-1/${phase.label}.stdout.log`).toString(); assert.match(text, /^# fail 0$/mu); assert.match(text, /^# skipped 0$/mu); assert.match(text, /^# cancelled 0$/mu);
  }
}
assert.match(read('attempt-1/guard-source-tamper.stderr.log').toString(), /Frozen env source bytes: src\/commands\/env-split\.ts/u);
assert.match(read('attempt-1/guard-outside-source.stderr.log').toString(), /FROZEN_IMPORT_OUTSIDE/u);
assert.doesNotMatch(read('attempt-1/guard-outside-source.stderr.log').toString(), /Error: OUTSIDE_BODY_EXECUTED/u);
assert.deepEqual(result.privateBefore, result.privateAfter); assert.equal(result.privateUnchanged, true);
assert.deepEqual(result.privateInputs, result.privateFilesAfter); assert.equal(result.privateFilesUnchangedIncludingNewEntries, true);
assert.equal(result.privateInputs.length, 264); assert.equal(hash(JSON.stringify(result.privateInputs)), result.engineCopy.treeSha256);
assert.equal(result.engineCopy.treeSha256, 'e1bbb8110c1b917f3ef78df2e7594a4a7b89e3851bc0903e247f78d1b80148fb');
assert.equal(result.sourceTreeBeforeSha256, result.sourceTreeAfterSha256); assert.equal(result.unchangedAndNoNewSourceEntries, true);
assert.equal(Object.keys(result.source).length, 529); assert.equal(Object.keys(result.tools).length, 314);
assert.equal(result.guardSha256, 'af4608b333f6b2dc4384fb28d3866a134ba3efc0a120d63a9adeee79f0f21114');
const files = {};
const walk = (prefix = '') => { for (const entry of readdirSync(join(here, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name; assert.equal(entry.isSymbolicLink(), false);
  if (entry.isDirectory()) walk(path); else if (path !== 'MANIFEST.json') { const bytes = read(path); files[path] = { bytes: bytes.length, sha256: hash(bytes) }; }
} }; walk();
if (process.argv[2] === '--seal') { assert.equal(existsSync(join(here, 'MANIFEST.json')), false); writeFileSync(join(here, 'MANIFEST.json'), JSON.stringify({ candidate: result.candidate, runtime: result.runtime, files }, null, 2) + '\n', { flag: 'wx' }); }
else assert.deepEqual(JSON.parse(read('MANIFEST.json')).files, files);
console.log(JSON.stringify({ actualBodies: '45/45', files: 4, skips: 0, cancelled: 0, runtime: result.runtime.version, guardControls: 'positive0/source-tamper1/outside1', copiedEngineFiles: 264, privateUnchanged: true, sourceAndEntrySetsUnchanged: true, wholeGate: false }));
