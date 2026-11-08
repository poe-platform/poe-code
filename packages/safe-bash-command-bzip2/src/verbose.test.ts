import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { chunks, run } from './helpers.js';

const input = Buffer.from('hello world\n'.repeat(20));

test('verbose integrity checks report each good and corrupt operand', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(input));
  const bad = Buffer.from(encoded.stdout);
  bad[10] = bad[10]! ^ 1;
  const fs = createMemoryFileSystem();
  await fs.writeFile('/bad.bz2', bad);
  await fs.writeFile('/good.bz2', encoded.stdout);
  const good = await run('bzip2', ['-tv', 'good.bz2', 'good.bz2'], chunks(), { fs });
  assert.equal(good.exitCode, 0);
  assert.equal(good.stderr, '  good.bz2: ok\n  good.bz2: ok\n');
  const mixed = await run('bzip2', ['-tv', 'bad.bz2', 'good.bz2'], chunks(), { fs });
  assert.equal(mixed.exitCode, 2);
  assert.match(mixed.stderr, /bad\.bz2:.*(?:data|CRC)/);
  assert.match(mixed.stderr, /good\.bz2: ok\n/);
  assert.equal(mixed.stdout.length, 0);
});

test('verbose stdin compression reports actual streamed counts and ratios', async () => {
  const result = await run('bzip2', ['-vc'], chunks(input.subarray(0, 37), input.subarray(37)));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 62);
  assert.equal(result.stderr, '  (stdin):  3.871:1,  2.067 bits/byte, 74.17% saved, 240 in, 62 out.\n');
  const empty = await run('bzip2', ['--verbose', '-c']);
  assert.equal(empty.stderr, '  (stdin):  no data compressed.\n');
});

test('verbose file compression reports per-file counts and decompression completion', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/a', input);
  await fs.writeFile('/b', new Uint8Array());
  const result = await run('bzip2', ['-v', 'a', 'b'], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '  a:  3.871:1,  2.067 bits/byte, 74.17% saved, 240 in, 62 out.\n  b:  no data compressed.\n');
  const decoded = await run('bunzip2', ['--verbose', 'a.bz2'], chunks(), { fs });
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.equal(decoded.stderr, '  a.bz2: done\n');
  assert.deepEqual(Buffer.from(await fs.readFile('/a')), input);
});

test('verbosity supplied by the environment works without changing quiet defaults', async () => {
  assert.equal((await run('bzip2', ['-c'], chunks(input))).stderr, '');
  const result = await run('bzip2', ['-c'], chunks(input), { env: { BZIP2: '--verbose' } });
  assert.match(result.stderr, /240 in, 62 out/);
});

test('verbose output failures do not report successful compression', async () => {
  const result = await run('bzip2', ['-vc'], chunks(input), {
    stdout: { async write() { throw new Error('sink failure'); } },
  });
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stderr, /saved|done|ok/);
});

test('verbose archive checks escape control characters in operand names', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(input));
  const fs = createMemoryFileSystem();
  await fs.writeFile('/a\u001b[31m.bz2', encoded.stdout);
  const result = await run('bzip2', ['-tv', 'a\u001b[31m.bz2'], chunks(), { fs });
  assert.equal(result.exitCode, 0);
  assert.ok(!result.stderr.includes('\u001b'));
  assert.ok(result.stderr.endsWith(': ok\n'));
});
