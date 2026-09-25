import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';

for (const [check, id] of [['none', 0], ['crc32', 1], ['crc64', 4], ['sha256', 10]] as const) {
  test(`XZ encodes ${check} and aliases decode it`, async () => {
    const plain = Buffer.from('checksum payload'.repeat(100));
    const encoded = await run('xz', ['-c', `--check=${check}`], chunks(plain));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout[7], id);
    for (const command of ['xz', 'unxz', 'xzcat']) {
      const decoded = await run(command, ['-dc'], chunks(encoded.stdout));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, plain);
    }
  });
}

test('ignore-check bypasses data checks on every member but preserves header validation', async () => {
  const plain = Buffer.from('checksum payload');
  const encoded = await run('xz', ['-c'], chunks(plain));
  const corrupt = Buffer.from(encoded.stdout);
  corrupt[corrupt.length - 25]! ^= 1;
  for (const command of ['xz', 'unxz', 'xzcat']) {
    assert.equal((await run(command, ['-dc'], chunks(corrupt))).exitCode, 1);
    const decoded = await run(command, ['-dc', '--ignore-check'], chunks(corrupt, corrupt));
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.deepEqual(decoded.stdout, Buffer.concat([plain, plain]));
    assert.equal((await run(command, ['-t', '--ignore-check'], chunks(corrupt))).exitCode, 0);
  }
  const badHeader = Buffer.from(encoded.stdout);
  badHeader[8]! ^= 1;
  assert.equal((await run('xz', ['-dc', '--ignore-check'], chunks(badHeader))).exitCode, 1);
});

test('XZ check short form, separate values, ordering and validation', async () => {
  for (const flags of [['-Csha256'], ['-C', 'sha256'], ['--check', 'sha256'], ['--check=none', '--check=sha256']]) {
    const encoded = await run('xz', ['-c', ...flags], chunks(Buffer.from('payload')));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout[7], 10);
  }
  for (const flags of [['--check=invalid'], ['--check=toString'], ['--check=__proto__'], ['--check'], ['-C']]) {
    assert.equal((await run('xz', ['-c', ...flags], chunks())).exitCode, 2);
  }
});
