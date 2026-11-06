import listingFixtures from '../tests/list-fixtures.json' with { type: 'json' };
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from '../tests/helpers.js';
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

// Captured with XZ Utils 5.8.4, LC_ALL=C; archives are identical in the VFS.
for (const fixture of listingFixtures) {
  test(`XZ listing matches native at every verbosity: ${fixture.name}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile('/data.xz', Buffer.from(fixture.hex, 'hex'));
    for (const { args, stdout } of fixture.outputs) {
      const result = await run('xz', [...args, 'data.xz'], chunks(), { fs });
      assert.equal(result.exitCode, 0, result.stderr);
      // liblzma's estimates include native structs: wasm32 uses smaller pointers
      // than the arm64 build that captured these fixtures. All other fields match.
      const memory = fixture.name === 'filters' ? 131888 : fixture.name === 'empty' ? 0
        : fixture.name === 'arm64' || fixture.name === 'riscv' ? 8455672 : 8454648;
      const expected = args.includes('--robot') ? stdout.split('\n').map(line => {
        const fields = line.split('\t');
        if (fields[0] === 'block' && fields.length > 10) fields[14] = String(memory);
        if (fields[0] === 'summary') fields[1] = String(memory);
        if (fields[0] === 'totals' && fields.length > 10) fields[9] = String(memory);
        return fields.join('\t');
      }).join('\n') : stdout;
      assert.equal(result.stdout.toString(), expected, args.join(' '));
    }
  });
}

test('very verbose listing validates headers without decoding block payloads', async () => {
  const fixture = listingFixtures.find(value => value.name === 'blocks')!;
  const fs = createMemoryFileSystem();
  const bytes = Buffer.from(fixture.hex, 'hex');
  bytes[24] = bytes[24]! ^ 255;
  await fs.writeFile('/data.xz', bytes);
  assert.equal((await run('xz', ['-lvv', 'data.xz'], chunks(), { fs })).exitCode, 0);
  assert.equal((await run('xz', ['-t', 'data.xz'], chunks(), { fs })).exitCode, 1);
  bytes[20] = bytes[20]! ^ 1; // Block Header CRC
  await fs.writeFile('/data.xz', bytes);
  assert.equal((await run('xz', ['-lv', 'data.xz'], chunks(), { fs })).exitCode, 0);
  const invalid = await run('xz', ['-lvv', 'data.xz'], chunks(), { fs });
  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.stderr, /Compressed data is corrupt/);
});

test('long verbose flags and repeated verbosity select detailed listing', () => {
  assert.equal(parseOptions('xz', ['--list', '--verbose', '--verbose']).xzVerbose, 2);
  assert.equal(parseOptions('xz', ['-lvvv']).xzVerbose, 2);
});
