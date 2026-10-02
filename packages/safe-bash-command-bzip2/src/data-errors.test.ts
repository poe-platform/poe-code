import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';

for (const command of ['bzip2', 'bunzip2', 'bzcat']) {
  test(`${command} reports data errors as 2 and file errors as 1`, async () => {
    for (const input of [Buffer.alloc(0), Buffer.from('invalid')]) {
      const result = await run(command, ['-dc'], chunks(input));
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout.length, 0);
    }
    assert.equal((await run(command, ['-dc', '/missing'])).exitCode, 1);
  });
}

test('bzip2 streams complete output buffers but discards a truncated final buffer', async () => {
  const input = Buffer.alloc(12001, 120);
  const encoded = await run('bzip2', ['-c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const valid = await run('bzip2', ['-dc'], chunks(encoded.stdout));
  assert.equal(valid.exitCode, 0, valid.stderr);
  assert.deepEqual(valid.stdout, input);
  const result = await run('bzip2', ['-dc'], chunks(encoded.stdout.subarray(0, -1)));
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.stdout, input.subarray(0, 10000));
});

test('bzip2 output failures retain status 1', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('valid')));
  const result = await run('bzip2', ['-dc'], chunks(encoded.stdout), {
    stdout: { async write() { throw new Error('sink failure'); } },
  });
  assert.equal(result.exitCode, 1);
});
