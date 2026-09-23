import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';

for (const format of ['--format=xz', '-Fxz', '-F xz']) {
  test(`forced XZ format ${format} round-trips and rejects legacy input`, async () => {
    const flags = format.split(' ');
    const plain = Buffer.from('forced XZ\0\xff');
    const encoded = await run('xz', [...flags, '-c'], chunks(plain));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    for (const command of ['xz', 'unxz', 'xzcat']) {
      const decoded = await run(command, [...flags, '-dc'], chunks(...Array.from(encoded.stdout, byte => Uint8Array.of(byte))));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, plain);
      const legacy = Buffer.from('XQAABAD//////////wCD//v//8AAAAA=', 'base64');
      const rejected = await run(command, [...flags, '-dc'], chunks(legacy));
      assert.equal(rejected.exitCode, 1);
      assert.equal(rejected.stdout.length, 0);
    }
  });
}

test('forced XZ checks every concatenated member and auto can override it', async () => {
  const plain = Buffer.from('hello');
  const encoded = await run('xz', ['-c'], chunks(plain));
  const legacy = Buffer.from('XQAABAD//////////wCD//v//8AAAAA=', 'base64');
  const mixed = Buffer.concat([encoded.stdout, legacy]);
  const rejected = await run('xz', ['-dc', '--format=xz'], chunks(mixed));
  assert.equal(rejected.exitCode, 1);
  assert.deepEqual(rejected.stdout, plain);
  const automatic = await run('xz', ['-dc', '--format=xz', '--format=auto'], chunks(legacy));
  assert.equal(automatic.exitCode, 0, automatic.stderr);
  const forcedCopy = await run('xz', ['-dcf', '--format=xz'], chunks(legacy));
  assert.equal(forcedCopy.exitCode, 0, forcedCopy.stderr);
  assert.deepEqual(forcedCopy.stdout, legacy);
  const testMode = await run('xz', ['-t', '--format=xz'], chunks(legacy));
  assert.equal(testMode.exitCode, 1);
});
