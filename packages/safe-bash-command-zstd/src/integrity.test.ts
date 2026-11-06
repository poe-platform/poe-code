import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { chunks, run } from './helpers.js';

for (const args of [['-t'], ['-df'], ['-t', 'good.zst']]) {
  test(`checksum failures identify the damaged operand with ${args.join(' ')}`, async () => {
    const encoded = await run('zstd', ['-c'], chunks(Buffer.from('checksum\n'.repeat(200))));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    const damaged = Buffer.from(encoded.stdout);
    damaged[damaged.length - 1]! ^= 1;
    const fs = createMemoryFileSystem();
    await fs.writeFile('/good.zst', encoded.stdout);
    await fs.writeFile('/broken.zst', damaged);
    await fs.writeFile('/broken', Buffer.from('existing output'));
    const result = await run('zstd', [...args, 'broken.zst'], chunks(), { fs });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('broken.zst: Restored data doesn\'t match checksum'), result.stderr);
    assert.ok(!result.stderr.includes('memory limit'), result.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile('/broken.zst')), damaged);
    assert.equal(Buffer.from(await fs.readFile('/broken')).toString(), 'existing output');
    const valid = await run('zstd', ['-t', 'good.zst'], chunks(), { fs });
    assert.equal(valid.exitCode, 0, valid.stderr);
  });
}

test('checksum diagnostics label stdin and respect double quiet', async () => {
  const encoded = await run('zstd', ['-c'], chunks(Buffer.from('checksum')));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const damaged = Buffer.from(encoded.stdout);
  damaged[damaged.length - 1]! ^= 1;
  const result = await run('zstd', ['-t'], chunks(damaged));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "zstd: stdin: Restored data doesn't match checksum\n");
  const quiet = await run('zstd', ['-qqt'], chunks(damaged));
  assert.equal(quiet.exitCode, 1);
  assert.equal(quiet.stderr, '');
});

test('integrity checks report decoded sizes without writing or removing files', async () => {
  const input = Buffer.from('integrity\n'.repeat(200));
  const encoded = await run('zstd', ['-c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const fs = createMemoryFileSystem();
  await fs.writeFile('/good.zst', encoded.stdout);
  await fs.writeFile('/also.zst', encoded.stdout);
  for (const [args, expected] of [
    [['-t', 'good.zst'], `good.zst            : ${input.length} bytes \n`],
    [['-t', 'good.zst', 'also.zst'], `2 files decompressed :   ${input.length * 2} bytes total \n`],
    [['-qt', 'good.zst'], ''],
    [['-qt', 'good.zst', 'also.zst'], ''],
    [['-t'], `/*stdin*\\           : ${input.length} bytes \n`],
  ] as const) {
    const result = await run('zstd', args, chunks(encoded.stdout), { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr, expected);
  }
  assert.deepEqual(Buffer.from(await fs.readFile('/good.zst')), encoded.stdout);
  assert.deepEqual(Buffer.from(await fs.readFile('/also.zst')), encoded.stdout);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['also.zst', 'good.zst']);
});

test('failed integrity checks do not report a successful decoded size', async () => {
  const result = await run('zstd', ['-t'], chunks(Buffer.from('invalid')));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.length, 0);
  assert.ok(!result.stderr.includes(' bytes'));
});

test('multi-file integrity totals count successful files and all concatenated members', async () => {
  const encoded = await run('zstd', ['-c'], chunks(Buffer.from('abc')));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const fs = createMemoryFileSystem();
  await fs.writeFile('/good.zst', Buffer.concat([encoded.stdout, encoded.stdout]));
  await fs.writeFile('/bad.zst', Buffer.concat([encoded.stdout, Buffer.from('invalid')]));
  const result = await run('zstd', ['-t', 'bad.zst', 'good.zst'], chunks(), { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.length, 0);
  assert.ok(result.stderr.endsWith('1 files decompressed :   6 bytes total \n'), result.stderr);
});
