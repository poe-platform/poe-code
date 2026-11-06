import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { chunks, run } from './helpers.js';

for (const mode of ['-dk', '-dc', '-t']) {
  test(`bzip2 ${mode} accepts trailing garbage and preserves decoded data`, async () => {
    const input = Buffer.from('complete archive contents\n');
    const encoded = await run('bzip2', ['-c'], chunks(input));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    for (const tail of ['trailing data', 'BZh0']) {
      const fs = createMemoryFileSystem();
      const archive = Buffer.concat([encoded.stdout, Buffer.from(tail)]);
      await fs.writeFile('/tail.bz2', archive);
      const result = await run('bzip2', [mode, '/tail.bz2'], chunks(), { fs });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stderr, /trailing garbage/);
      assert.deepEqual(result.stdout, mode === '-dc' ? input : Buffer.alloc(0));
      if (mode === '-dk') assert.deepEqual(Buffer.from(await fs.readFile('/tail')), input);
      else await assert.rejects(fs.stat('/tail'));
      assert.deepEqual(Buffer.from(await fs.readFile('/tail.bz2')), archive);
    }
  });
}

test('bzip2 handles split trailing headers without hiding corrupt members', async () => {
  const input = Buffer.from('member contents\n');
  const encoded = await run('bzip2', ['-c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const corrupt = Buffer.from(encoded.stdout);
  corrupt[10] = corrupt[10]! ^ 1;
  for (const tail of [Buffer.from('trailing data'), Buffer.from('BZh0'), Buffer.from('B'), Buffer.from('BZ'), Buffer.from('BZh'), Buffer.from('BZh9'), corrupt, encoded.stdout]) {
    const archive = Buffer.concat([encoded.stdout, tail]);
    const garbage = tail.toString() === 'trailing data' || tail.toString() === 'BZh0';
    for (const split of [false, true]) {
      const source = split ? chunks(...Array.from(archive, byte => Buffer.from([byte]))) : chunks(archive);
      const result = await run('bzip2', ['-dc'], source);
      assert.equal(result.exitCode, garbage || tail === encoded.stdout ? 0 : 2, result.stderr);
      if (garbage || tail === encoded.stdout) {
        assert.deepEqual(result.stdout, tail === encoded.stdout ? Buffer.concat([input, input]) : input);
      }
    }
  }
});
