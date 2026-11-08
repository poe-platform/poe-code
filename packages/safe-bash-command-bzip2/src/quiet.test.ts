import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { chunks, run } from './helpers.js';

for (const flags of [['-q'], ['--quiet'], ['-qq'], ['--quiet', '--quiet']]) {
  test(`bzip2 ${flags.join(' ')} preserves output and suppresses trailing-garbage warnings`, async () => {
    const input = Buffer.from('quiet archive contents\n');
    const encoded = await run('bzip2', [...flags, '-c'], chunks(input));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stderr, '');
    assert.equal(encoded.stdout.subarray(0, 4).toString(), 'BZh9');
    for (const command of ['bzip2', 'bunzip2', 'bzcat']) {
      const decoded = await run(command, [...flags, '-dc'], chunks(encoded.stdout, Buffer.from('trailing garbage')));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.equal(decoded.stderr, '');
      assert.deepEqual(decoded.stdout, input);
    }
  });

  test(`bzip2 ${flags.join(' ')} retains named CRC and file-open errors`, async () => {
    const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('archive contents\n')));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    const corrupt = Buffer.from(encoded.stdout);
    corrupt[10] = corrupt[10]! ^ 1;
    const fs = createMemoryFileSystem();
    await fs.writeFile('/bad.bz2', corrupt);
    const checked = await run('bzip2', ['-t', ...flags, 'bad.bz2'], chunks(), { fs });
    assert.equal(checked.exitCode, 2);
    assert.equal(checked.stderr, 'bzip2: bad.bz2: data integrity (CRC) error\n');
    assert.equal(checked.stdout.length, 0);
    assert.deepEqual(Buffer.from(await fs.readFile('/bad.bz2')), corrupt);
    const missing = await run('bzip2', ['-dc', ...flags, 'absent'], chunks(), { fs });
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, 'bzip2: absent: ENOENT: no such file or directory\n');
    assert.equal(missing.stdout.length, 0);
  });
}

test('bzip2 quiet defaults from both environment variables retain errors', async () => {
  const result = await run('bzip2', ['-dcqq', 'absent'], chunks(), {
    env: { BZIP2: '--quiet', BZIP: '-q' },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, 'bzip2: absent: ENOENT: no such file or directory\n');
});
