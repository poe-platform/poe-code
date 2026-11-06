import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { chunks, run } from './helpers.js';

for (const [source, destination] of [
  ['/note.bz2', '/note'],
  ['/note.bz', '/note'],
  ['/pkg.tbz', '/pkg.tar'],
  ['/pkg.tbz2', '/pkg.tar'],
] as const) {
  test(`bzip2 and bunzip2 decompress ${source} to ${destination}`, async () => {
    const input = Buffer.from('archive contents\n');
    const encoded = await run('bzip2', ['-c'], chunks(input));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    for (const command of ['bzip2', 'bunzip2']) {
      for (const keep of [true, false]) {
        const fs = createMemoryFileSystem();
        await fs.writeFile(source, encoded.stdout);
        const result = await run(command, [keep ? '-dk' : '-d', source], chunks(), { fs });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout.length, 0);
        assert.deepEqual(Buffer.from(await fs.readFile(destination)), input);
        if (keep) assert.deepEqual(Buffer.from(await fs.readFile(source)), encoded.stdout);
        else await assert.rejects(fs.stat(source), { code: 'ENOENT' });
      }
    }
  });

  test(`bzip2 preserves existing output and input for ${source}`, async () => {
    const fs = createMemoryFileSystem();
    const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('archive contents\n')));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    await fs.writeFile(source, encoded.stdout);
    const existing = Buffer.from('existing output');
    await fs.writeFile(destination, existing);
    const result = await run('bzip2', ['-d', source], chunks(), { fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EEXIST/);
    assert.deepEqual(Buffer.from(await fs.readFile(destination)), existing);
    assert.deepEqual(Buffer.from(await fs.readFile(source)), encoded.stdout);
  });
}
