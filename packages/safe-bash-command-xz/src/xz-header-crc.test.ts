import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from '../tests/helpers.js';

test('XZ detailed listing validates block header CRC without testing payloads', async () => {
  const encoded = await run('xz', ['-c', '--check=crc32', '--block-size=512'], chunks(Buffer.from('hello world')));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const fs = encoded.fs;
  await fs.writeFile('/data.xz', encoded.stdout);
  assert.equal((await run('xz', ['-lvv', 'data.xz'], chunks(), { fs })).exitCode, 0);

  const damaged = Buffer.from(encoded.stdout);
  damaged[14] = damaged[14]! ^ 1;
  await fs.writeFile('/data.xz', damaged);
  for (const args of [['-lvv'], ['--robot', '-lvv']]) {
    const result = await run('xz', [...args, 'data.xz'], chunks(), { fs });
    assert.equal(result.exitCode, 1, args.join(' '));
    assert.match(result.stderr, /Compressed data is corrupt/);
  }
  assert.equal((await run('xz', ['-t', 'data.xz'], chunks(), { fs })).exitCode, 1);
  assert.equal((await run('xz', ['-l', 'data.xz'], chunks(), { fs })).exitCode, 0);

  const payloadDamage = Buffer.from(encoded.stdout);
  const headerSize = (payloadDamage[12]! + 1) * 4;
  payloadDamage[12 + headerSize] = 255;
  await fs.writeFile('/data.xz', payloadDamage);
  assert.equal((await run('xz', ['-lvv', 'data.xz'], chunks(), { fs })).exitCode, 0);
  assert.equal((await run('xz', ['-t', 'data.xz'], chunks(), { fs })).exitCode, 1);
});
