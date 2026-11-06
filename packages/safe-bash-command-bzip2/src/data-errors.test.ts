import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
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

for (const damage of ['crc', 'truncated', 'plaintext'] as const) {
  for (const mode of ['-d', '-dc', '-t']) {
    test(`bzip2 ${mode} handles later operands after ${damage}`, async () => {
      const input = Buffer.from('later archive contents\n');
      const encoded = await run('bzip2', ['-c'], chunks(input));
      assert.equal(encoded.exitCode, 0, encoded.stderr);
      const bad = damage === 'plaintext' ? Buffer.from('not bzip data')
        : damage === 'truncated' ? encoded.stdout.subarray(0, -4) : Buffer.from(encoded.stdout);
      if (damage === 'crc') bad[10] = bad[10]! ^ 1;
      const fs = createMemoryFileSystem();
      await fs.writeFile('/bad.bz2', bad);
      await fs.writeFile('/good.bz2', encoded.stdout);
      const result = await run('bzip2', [mode, '/bad.bz2', '/good.bz2'], chunks(), { fs });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.deepEqual(Buffer.from(await fs.readFile('/bad.bz2')), bad);
      const continues = damage === 'plaintext' || mode === '-t';
      if (mode === '-d' && continues) {
        assert.deepEqual(Buffer.from(await fs.readFile('/good')), input);
        await assert.rejects(fs.stat('/good.bz2'));
      } else {
        assert.deepEqual(Buffer.from(await fs.readFile('/good.bz2')), encoded.stdout);
        await assert.rejects(fs.stat('/good'));
      }
      await assert.rejects(fs.stat('/bad'));
      assert.deepEqual(result.stdout, mode === '-dc' && continues ? input : Buffer.alloc(0));
      if (mode === '-t' && damage !== 'plaintext') {
        await fs.writeFile('/good.bz2', bad);
        const checked = await run('bzip2', [mode, '/bad.bz2', '/good.bz2'], chunks(), { fs });
        assert.equal(checked.stderr.trim().split('\n').length, 2, checked.stderr);
      }
    });
  }
}
