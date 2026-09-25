import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';
import { humanListing } from './xz-list.js';
import { parseOptions } from './options.js';

test('XZ human units and list mode selectors match native', () => {
  assert.match(humanListing({ streams: 1, blocks: 1, compressed: 76, uncompressed: 1024, padding: 0, checks: new Set([4]) }, 'data.xz'), /1024 B/);
  assert.match(humanListing({ streams: 1, blocks: 1, compressed: 284, uncompressed: 1048576, padding: 0, checks: new Set([4]) }, 'data.xz'), /1024\.0 KiB/);
  assert.equal(parseOptions('xz', ['--list', '-d']).xzList, undefined);
  assert.throws(() => parseOptions('xz', ['--list', '--format=raw']));
});

test('XZ robot listing reads metadata and preserves files', async () => {
  const encoded = await run('xz', ['-3c', '--block-size=4'], chunks(Buffer.from('hello world')));
  const fs = encoded.fs;
  await fs.writeFile('/data.xz', encoded.stdout);
  const result = await run('xz', ['--robot', '--list', '/data.xz'], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), 'name\t/data.xz\nfile\t1\t3\t120\t11\t---\tCRC64\t0\ntotals\t1\t3\t120\t11\t---\tCRC64\t0\t1\n');
  assert.deepEqual(Buffer.from(await fs.readFile('/data.xz')), encoded.stdout);
  assert.equal((await run('xz', ['--list', '--lzma2=dict=bad', '/data.xz'], chunks(), { fs })).exitCode, 1);
  assert.equal((await run('xz', ['--list', '--lzma2', '--x86', '/data.xz'], chunks(), { fs })).exitCode, 0);
  assert.equal((await run('xz', ['--list', '--memlimit=1', '/data.xz'], chunks(), { fs })).exitCode, 1);
  assert.equal((await run('xz', ['--list', '--memlimit=1MiB', '/data.xz'], chunks(), { fs })).exitCode, 0);
  // Listing does not validate the compressed payload, unlike --test.
  const damaged = encoded.stdout.slice();
  damaged[28] = damaged[28]! ^ 255;
  await fs.writeFile('/data.xz', damaged);
  assert.equal((await run('xz', ['--list', '/data.xz'], chunks(), { fs })).exitCode, 0);
  assert.equal((await run('xz', ['-t', '/data.xz'], chunks(), { fs })).exitCode, 1);
});
test('XZ listing checks indices, concatenated streams and stdin restrictions', async () => {
  const encoded = await run('xz', ['-3c'], chunks(Buffer.from('hello world')));
  const fs = encoded.fs;
  const concatenated = Buffer.concat([encoded.stdout, Buffer.alloc(4), encoded.stdout, Buffer.alloc(8)]);
  await fs.writeFile('/data.xz', concatenated);
  const result = await run('xzcat', ['--list', '--robot', '/data.xz'], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout.toString(), /file\t2\t2\t148\t22\t6\.727\tCRC64\t12/);
  const corrupt = concatenated.slice();
  corrupt[corrupt.length - 17] = corrupt[corrupt.length - 17]! ^ 1;
  await fs.writeFile('/data.xz', corrupt);
  assert.equal((await run('xz', ['--list', '/data.xz'], chunks(), { fs })).exitCode, 1);
  assert.equal((await run('xz', ['--list'], chunks(encoded.stdout))).exitCode, 1);
  const missing = await run('xz', ['--robot', '--list', '/missing', '/data.xz'], chunks(), { fs });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stdout.toString(), /totals\t0\t0\t0\t0\t---\tNone\t0\t0/);
});
