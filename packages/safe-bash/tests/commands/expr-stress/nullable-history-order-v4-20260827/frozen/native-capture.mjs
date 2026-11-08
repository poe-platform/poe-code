import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addJSON, command, directory, env, hash, json, root } from './common.mjs';

assert.equal(process.argv[2], '--capture-once', 'explicit immutable capture only, not canonical discovery');
const inputs = json('INPUTS.json');
assert.equal(inputs.cases.length, 32);
assert.equal(new Set(inputs.cases.map(row => JSON.stringify([row.subject, row.pattern]))).size, 32);
const profiles = {
  gnu: { filename: path.join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr'), sha256: 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c', qualification: 'GNU expr 9.7 on Darwin, not GNU/Linux; linked library not independently hashed' },
  apple: { filename: '/bin/expr', sha256: '584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f', qualification: 'Apple /bin/expr on Darwin; no GNU version claim or inferred internal spans' },
};
for (const profile of Object.values(profiles)) assert.equal(hash(readFileSync(profile.filename)), profile.sha256);
const capture = { started: new Date().toISOString(), inputSha256: hash(readFileSync(path.join(directory, 'INPUTS.json'))), environment: env, host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version }, profiles, qualificationCalls: { gnu: command(profiles.gnu.filename, ['--version']), apple: command(profiles.apple.filename, ['--version']) }, rows: [] };
assert.ok(Buffer.from(capture.qualificationCalls.gnu.stdoutHex, 'hex').toString().startsWith('expr (GNU coreutils) 9.7\n'));
for (const fixture of inputs.cases) {
  const row = { id: fixture.id, subject: fixture.subject, pattern: fixture.pattern, observations: {} };
  for (const [name, profile] of Object.entries(profiles)) {
    for (const form of ['portable', 'plus']) {
      const argv = [...(form === 'plus' ? ['+'] : []), fixture.subject, ':', fixture.pattern];
      row.observations[`${name}-${form}`] = command(profile.filename, argv);
    }
  }
  capture.rows.push(row);
}
for (const profile of Object.values(profiles)) assert.equal(hash(readFileSync(profile.filename)), profile.sha256);
capture.finished = new Date().toISOString();
capture.counts = { distinctInputs: 32, semanticNativeCalls: capture.rows.length * 4, qualificationCalls: 2, executionFailures: capture.rows.flatMap(row => Object.values(row.observations)).filter(row => row.error || row.signal).length };
capture.cleanup = { allChildrenAwaited: true, nativeScratchCreated: false, binaryHashesBeforeAfterEqual: true, nativeSpans: 'unobserved; command stdout does not establish internal registers' };
addJSON('native-01.json', capture);
addJSON('EXPECTED-PROFILES.json', { schema: 1, inputSha256: capture.inputSha256, nativeCaptureSha256: hash(readFileSync(path.join(directory, 'native-01.json'))), interpretation: 'Frozen observed command profiles, not normative votes. Portable and GNU-style + forms are distinct even when bytes agree; Apple + errors are invocation differences, not regex failures. No native spans invented.', projectRules: inputs.projectRules, rows: capture.rows.map(row => ({ id: row.id, qualified: Object.fromEntries(Object.entries(row.observations).map(([name, observed]) => [name, { status: observed.status, signal: observed.signal, error: observed.error, stdoutHex: observed.stdoutHex, stderrHex: observed.stderrHex }])), normative: row.id === 'P-aaa' ? 'root narrow completed a; GNU discrepancy retained' : 'unresolved in this freeze' })) });
console.log(JSON.stringify(capture.counts));
