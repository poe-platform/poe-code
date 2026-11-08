import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { sha256 } from '../current-shell/support.mjs';
import { cases, hostCases, invocation } from './cases.mjs';
import { owned } from './native.mjs';

const root = resolve(owned, '../../..');
const bytes = await readFile(resolve(owned, 'acceptance-6e3e316-initial.json'));
const report = JSON.parse(bytes);
const native = JSON.parse(await readFile(resolve(owned, 'native-frozen.json')));

test('the initial interrupted acceptance and original ten-file freeze remain immutable', async () => {
  assert.equal(sha256(bytes), '5bcdd259bc65bf30cbbcac2a00e741c06661de61217c87ae3cc3689262e041d3');
  assert.equal(Object.keys(report.frozenFiles).length, 10);
  for (const [path, expected] of Object.entries(report.frozenFiles)) {
    assert.equal(sha256(await readFile(resolve(root, path))), expected);
    assert.equal(sha256(execFileSync('git', ['show', `${report.frozenCommit}:${path}`], { cwd: root })), expected);
  }
});

test('all 108 case slots and four host slots retain their two-reference denominators', () => {
  assert.equal(report.rows.length, 112);
  assert.equal(new Set(report.rows.map(row => `${row.role}:${row.id}`)).size, 112);
  for (const role of ['bash', 'sh']) assert.deepEqual(report.rows.filter(row => row.role === role).map(row => row.id), cases.map(specimen => specimen.id));
  assert.deepEqual(report.rows.filter(row => row.role === 'host').map(row => row.id), hostCases.map(specimen => specimen.id));
  assert.equal(report.rows.flatMap(row => row.comparisons).length, 216);
  assert.equal(report.freshNativeRuns, 0);
  assert.equal(report.nativeReused, true);
  for (const row of report.rows) for (const comparison of row.comparisons) {
    const reference = native.profiles.find(profile => profile.id === comparison.profile).rows.find(reference => reference.id === row.id);
    assert.deepEqual(comparison.expected, { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects });
  }
});

test('six accepted cases, one drift-invalid evaluation and 105 import blocks stay distinct', () => {
  assert.equal(report.rows.filter(row => row.valid).length, 6);
  assert.equal(report.rows.filter(row => row.transportValid).length, 7);
  const drifting = report.rows.filter(row => row.changed.length);
  assert.equal(drifting.length, 1);
  assert.equal(drifting[0].role, 'bash'); assert.equal(drifting[0].id, 'E07');
  assert.equal(drifting[0].loadMismatches.length, 3);
  const blocked = report.rows.filter(row => row.actual.protocolError);
  assert.equal(blocked.length, 105);
  assert.equal(blocked.filter(row => row.role === 'host').length, 4);
  for (const row of blocked) { assert.equal(row.run.status, 1); assert.equal(row.run.stdout, ''); assert.match(Buffer.from(row.run.stderr, 'base64').toString(), /src\/commands\/search\/rg\.ts:118:0: ERROR: Unexpected "export"/u); assert.equal(row.valid, false); }
  assert.deepEqual(report.summary.map(summary => [summary.denominator, summary.rawExact, summary.accepted]), [[54, 7, 6], [54, 0, 0], [54, 7, 6], [54, 0, 0], [4, 0, 0]]);
});

test('READY and committed shell identity are independent of foreign loaded-dependency stability', () => {
  assert.equal(report.sourceCommit, '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a');
  assert.ok(report.ready.text.includes(report.sourceCommit));
  assert.match(report.ready.text, /SOURCE WRITE LEASE RELINQUISHED/u);
  assert.equal(sha256(report.ready.text), report.ready.sha256);
  assert.equal(Object.keys(report.shellCommitted).length, 10);
  assert.equal(Object.keys(report.manifests[report.initial]).length, 518);
  for (const row of report.rows) {
    const before = report.manifests[row.before], after = report.manifests[row.after], loaded = report.manifests[row.loaded];
    for (const [path, expected] of Object.entries(report.shellCommitted)) { assert.equal(before[path], expected); assert.equal(after[path], expected); }
    if (row.valid) {
      assert.equal(Object.keys(loaded).length, 166);
      for (const [path, expected] of Object.entries(loaded)) { assert.equal(before[path], expected); assert.equal(after[path], expected); }
      for (const [path, expected] of Object.entries(report.expectedShell)) assert.equal(loaded[path], expected);
      assert.deepEqual(row.changed, []); assert.deepEqual(row.loadMismatches, []); assert.deepEqual(row.forbidden, []);
    }
  }
  assert.deepEqual(report.endpointDrift, ['src/commands/regex-execution/client.ts', 'src/commands/search/matcher.ts', 'src/commands/search/options.ts', 'src/commands/search/rg.ts']);
});

test('actual completed invocations retain frozen source and semantic arguments', () => {
  for (const row of report.rows.filter(row => row.launch)) {
    const specimen = cases.find(specimen => specimen.id === row.id);
    const launch = invocation(specimen, row.role);
    assert.deepEqual(row.launch.nativeLaunch, launch);
    assert.deepEqual(row.launch.args, launch.args.slice(2));
    assert.deepEqual(row.launch.actualInvocations[0], { command: row.role, args: launch.args.slice(2) });
    assert.equal(row.launch.stdin, launch.stdin);
    assert.deepEqual(row.launch.initial, native.profiles.find(profile => profile.id === `gnu53-${row.role}-C`).rows.find(reference => reference.id === row.id).initial);
  }
});

test('initial per-row guard manifests pin the additive drivers actually used', async () => {
  const initial = report.manifests[report.initial];
  for (const name of ['acceptance.mjs', 'acceptance-product.mjs', 'acceptance-trace.mjs']) assert.equal(sha256(await readFile(resolve(owned, name))), initial[`tests/shell-stress/errexit-holdout/${name}`]);
  for (const [key, value] of Object.entries(report.manifests)) assert.equal(sha256(JSON.stringify(value)), key);
});

test('all child groups and scratch were cleaned without timeout or output-cap escapes', () => {
  assert.deepEqual(report.cleanup, { directoryRemoved: true, allGroupsAbsent: true });
  for (const row of report.rows) { assert.equal(row.run.timedOut, false); assert.equal(row.run.overflow, false); assert.equal(row.run.signal, null); assert.equal(row.run.groupAlive, false); assert.equal(row.process.deadlineMs, 3000); assert.equal(row.process.outputCapBytes, 1048576); }
});
