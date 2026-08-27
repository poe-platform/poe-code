import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { sha256 } from '../current-shell/support.mjs';
import { binaryProfiles, cases, hostCases, initialFiles, invocation } from './cases.mjs';
import { complete, owned } from './native.mjs';

const readJson = async name => JSON.parse(await readFile(resolve(owned, name), 'utf8'));
const frozen = await readJson('freeze.json');
const native = await readJson('native-frozen.json');
const canonicalBytes = encoded => assert.equal(Buffer.from(encoded, 'base64').toString('base64'), encoded);
const tuple = row => JSON.stringify({ status: row.result.status, stdout: row.result.stdout, stderr: row.result.stderr, effects: row.effects });

test('all independently frozen files retain their exact hashes', async () => {
  assert.equal(frozen.schema, 1);
  assert.equal(Object.keys(frozen.files).length, 9);
  for (const [name, hash] of Object.entries(frozen.files)) assert.equal(sha256(await readFile(resolve(owned, name))), hash, name);
  assert.equal(native.caseFileSha256, frozen.files['cases.mjs']);
});

test('the hidden cohort and injected host contracts retain their full denominators', () => {
  assert.equal(cases.length, 54);
  assert.equal(new Set(cases.map(specimen => specimen.id)).size, 54);
  assert.equal(hostCases.length, 4);
  assert.equal(new Set(hostCases.map(specimen => specimen.id)).size, 4);
  assert.equal(frozen.nativeObservations, 216);
  assert.equal(frozen.hostControlsExecuted, 0);
  assert.equal(native.sourceProvenance, null);
});

test('four complete profiles retain pinned binary and actual version proof', () => {
  assert.deepEqual(native.profiles.map(profile => profile.id), ['gnu53-bash-C', 'gnu53-sh-C', 'apple32-bash-C', 'apple32-sh-C']);
  for (const profile of native.profiles) {
    assert.deepEqual(profile.binary, binaryProfiles.find(binary => binary.id === profile.binary.id));
    assert.equal(profile.rows.length, 54);
    assert.deepEqual(profile.rows.map(row => row.id), cases.map(specimen => specimen.id));
    complete(profile.version.result);
    assert.equal(profile.version.result.status, 0);
    assert.ok(Buffer.from(profile.version.result.stdout, 'base64').toString().includes(`version ${profile.binary.versionPrefix}`));
    for (const role of ['bash', 'sh']) assert.deepEqual(profile.roleFixtures[role], { target: profile.binary.path, sha256: profile.binary.sha256 });
    assert.equal(profile.roleFixtures.cat.sha256, native.before['/bin/cat']);
  }
});

test('every observation preserves literal source, launcher, environment and initial fixtures', () => {
  for (const profile of native.profiles) {
    assert.deepEqual(Object.keys(profile.env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TZ']);
    assert.equal(profile.env.LC_ALL, 'C');
    assert.equal(profile.env.HOME, '/nonexistent');
    for (const [index, row] of profile.rows.entries()) {
      const specimen = cases[index];
      const launch = invocation(specimen, profile.role);
      assert.equal(row.executable, profile.binary.path);
      assert.equal(row.sourceSha256, sha256(specimen.script));
      for (const key of ['argv0', 'args', 'stdin', 'commandName']) assert.deepEqual(row[key], launch[key]);
      assert.deepEqual(row.env, profile.env);
      assert.ok(row.cwd.startsWith(`${profile.cwdRoot}/`));
      const initial = Object.fromEntries(Object.entries(initialFiles(specimen)).sort(([left], [right]) => left.localeCompare(right)).map(([name, fixture]) => [name, { kind: 'file', mode: fixture.mode, bytes: Buffer.from(fixture.text).toString('base64') }]));
      assert.deepEqual(row.initial, initial);
    }
  }
});

test('all statuses, raw byte streams and complete relative effects are retained', () => {
  for (const profile of native.profiles) for (const row of profile.rows) {
    complete(row.result);
    assert.ok(row.result.status >= 0 && row.result.status <= 255);
    canonicalBytes(row.result.stdout); canonicalBytes(row.result.stderr);
    assert.deepEqual(Object.keys(row.effects), Object.keys(row.initial));
    for (const effect of Object.values(row.effects)) { assert.equal(effect.kind, 'file'); assert.equal(effect.mode, 0o644); canonicalBytes(effect.bytes); }
  }
});

test('whole-profile controls prove actual POSIX roles, child versions and byte capture', () => {
  for (const profile of native.profiles) {
    const control = profile.controls;
    complete(control.result);
    assert.equal(control.result.status, 0); assert.equal(control.result.stderr, '');
    assert.equal(control.argv0, profile.role);
    assert.equal(control.args.at(-1), 'shell');
    assert.deepEqual(control.checks.posixModes, [profile.role === 'sh' ? 'on' : 'off', profile.role === 'sh' ? 'on' : 'off', 'off', 'on']);
    const bytes = Buffer.from(control.result.stdout, 'base64');
    assert.deepEqual([...bytes.subarray(-2)], [0, 255]);
    const text = bytes.subarray(0, -2).toString('utf8');
    const substitution = text.split('substitution-options-begin\n')[1].split('\nsubstitution-options-end')[0];
    assert.match(substitution, new RegExp(`^errexit\\s+${profile.role === 'bash' ? 'off' : 'on'}$`, 'mu'));
    for (const role of ['bash', 'sh']) assert.ok(text.includes(`${role}-child=child:${profile.binary.versionPrefix}`));
  }
});

test('native tool endpoints and bounded-group cleanup remain explicit', () => {
  assert.deepEqual(native.before, native.after);
  for (const binary of binaryProfiles) assert.equal(native.before[binary.path], binary.sha256);
  assert.equal(native.scratchRemoved, true);
  assert.equal(native.limits.deadlineMs, 3000);
  assert.equal(native.limits.combinedOutputBytes, 1048576);
  for (const profile of native.profiles) { assert.equal(existsSync(profile.cwdRoot), false); for (const row of profile.rows) assert.equal(existsSync(row.cwd), false); }
});

test('historical and invocation-role differences remain distinct native tuples', () => {
  const differences = (left, right) => native.profiles[left].rows.filter((row, index) => tuple(row) !== tuple(native.profiles[right].rows[index])).length;
  assert.deepEqual({ bash: differences(0, 2), sh: differences(1, 3) }, frozen.historicalTupleDifferences);
  assert.deepEqual({ gnu53: differences(0, 1), apple32: differences(2, 3) }, frozen.roleTupleDifferences);
});

test('the pre-freeze launcher-control defect remains preserved, not a case rewrite', async () => {
  const investigation = await readJson('launcher-investigation.json');
  const initial = await readJson('launcher-control-initial.json');
  assert.equal(investigation.rows.length, 4); assert.equal(initial.rows.length, 4);
  assert.deepEqual(investigation.rows.map(row => row.result.status), [0, 0, 0, 0]);
  assert.deepEqual(initial.rows.map(row => row.result.status), [0, 0, 2, 2]);
  for (const row of [...investigation.rows, ...initial.rows]) { complete(row.result); canonicalBytes(row.result.stdout); canonicalBytes(row.result.stderr); }
});
