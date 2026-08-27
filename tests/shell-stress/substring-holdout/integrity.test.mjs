import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { nativeCases, hostCases, policy } from './cases.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(await readFile(new URL('./freeze.json', import.meta.url), 'utf8'));
const native = JSON.parse(await readFile(new URL('./native-frozen.json', import.meta.url), 'utf8'));

test('frozen independent inputs, native evidence and helper identities match', async () => {
  for (const [path, expected] of Object.entries(frozen.files)) assert.equal(hash(await readFile(new URL(path, import.meta.url))), expected, path);
  assert.equal(hash(await readFile(new URL('../current-shell/support.mjs', import.meta.url))), native.helper.sha256);
  assert.equal(hash(await readFile(new URL('./cases.mjs', import.meta.url))), native.casesHash);
});

test('all24 unchanged cases occur in every version/locale profile', () => {
  assert.equal(nativeCases.length, 24); assert.equal(new Set(nativeCases.map(row => row.id)).size, 24);
  assert.equal(hostCases.length, 2);
  assert.deepEqual(native.profiles.map(profile => profile.id), ['primary-C', 'primary-en_US.UTF-8', 'historical-C', 'historical-en_US.UTF-8']);
  for (const profile of native.profiles) {
    assert.deepEqual(profile.rows.map(row => row.id), nativeCases.map(row => row.id));
    for (const [index, row] of profile.rows.entries()) {
      const fixture = nativeCases[index];
      assert.equal(row.scriptSha256, hash(fixture.script));
      assert.deepEqual(row.args, ['--noprofile', '--norc', '-c', fixture.script, policy.shellName, ...fixture.args]);
      assert.equal(row.stdin, fixture.stdin); assert.equal(row.env.LC_ALL, profile.locale); assert.equal(row.env.LANG, profile.locale);
      assert.equal(row.tuple.stdout, row.run.stdout); assert.equal(row.tuple.stderr, row.run.stderr); assert.equal(row.tuple.status, row.run.status);
      assert.deepEqual(row.before, Object.fromEntries(Object.entries(fixture.files).sort(([left], [right]) => left.localeCompare(right)).map(([path, text]) => [path, { bytes: Buffer.from(text).toString('base64'), mode: 0o644 }])));
    }
  }
});

test('native errors stay observations rather than unavailable or skipped controls', () => {
  assert.deepEqual(native.profiles.map(profile => profile.rows.filter(row => row.tuple.status !== 0).length), [4, 4, 6, 6]);
  assert.ok(native.profiles.every(profile => profile.control.run.stdout === profile.control.expected));
  assert.ok(native.cleanup.allChildrenCompleted); assert.ok(native.cleanup.allDirectoriesAbsent);
  assert.ok(native.cleanup.children.every(child => child.signal === null && !child.timedOut && !child.overflow && !child.groupAlive));
  assert.equal(native.productImported, false);
});
