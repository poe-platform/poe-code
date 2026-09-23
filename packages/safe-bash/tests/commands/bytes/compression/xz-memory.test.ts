import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';

for (const command of ['xz', 'unxz', 'xzcat']) {
  test(`${command} enforces decompression memory limits`, async () => {
    const plain = Buffer.from('bounded decompression'.repeat(100));
    const encoded = await run('xz', ['-c'], chunks(plain));
    for (const flag of ['--memlimit-decompress=64MiB', '--memlimit-decompress=0', '--memlimit-decompress=1GiB']) {
      const decoded = await run(command, ['-dc', flag], chunks(encoded.stdout));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, plain);
    }
    for (const flags of [['--memlimit-decompress=1MiB'], ['--memlimit-decompress', '1024KiB']]) {
      const decoded = await run(command, ['-dc', ...flags], chunks(encoded.stdout));
      assert.equal(decoded.exitCode, 1);
      assert.equal(decoded.stdout.length, 0);
      const checked = await run(command, ['-t', ...flags], chunks(encoded.stdout));
      assert.equal(checked.exitCode, 1);
    }
    const overridden = await run(command, ['-dc', '--memlimit-decompress=1MiB', '--memlimit-decompress=64MiB'], chunks(encoded.stdout));
    assert.equal(overridden.exitCode, 0, overridden.stderr);
  });
}

test('single-thread decoding ignores the multithread memory budget but validates it', async () => {
  const plain = Buffer.from('single threaded');
  const encoded = await run('xz', ['-c'], chunks(plain));
  const decoded = await run('xz', ['-dc', '--memlimit-mt-decompress=1'], chunks(encoded.stdout));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, plain);
  for (const value of ['', '-1', 'oops', '1B', '1.5MiB', '999999999999999999999999999']) {
    const invalid = await run('xz', ['-dc', `--memlimit-decompress=${value}`], chunks(encoded.stdout));
    assert.equal(invalid.exitCode, 2, value);
  }
});

test('memory failures retain named inputs and existing destinations', async () => {
  const encoded = await run('xz', ['-c'], chunks(Buffer.from('file payload')));
  const fs = encoded.fs;
  await fs.writeFile('/data.xz', encoded.stdout);
  await fs.writeFile('/data', Buffer.from('existing'));
  const result = await run('unxz', ['-f', '--memlimit-decompress=1MiB', '/data.xz'], chunks(), { fs });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(Buffer.from(await fs.readFile('/data.xz')), encoded.stdout);
  assert.deepEqual(Buffer.from(await fs.readFile('/data')), Buffer.from('existing'));
});

test('memory budget applies to later members and legacy LZMA, without changing compression', async () => {
  const plain = Buffer.from('hello');
  const small = await run('xz', ['-0c'], chunks(plain));
  const large = await run('xz', ['-3c'], chunks(plain));
  const decoded = await run('xz', ['-dc', '--memlimit-decompress=1MiB'], chunks(small.stdout, large.stdout));
  assert.equal(decoded.exitCode, 1);
  assert.deepEqual(decoded.stdout, plain);
  const legacy = Buffer.from('XQAABAD//////////wCD//v//8AAAAA=', 'base64');
  const rejected = await run('xz', ['-dcf', '--memlimit-decompress=1KiB'], chunks(legacy));
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.stdout.length, 0);
  const compressed = await run('xz', ['-3c', '--memlimit-decompress=1'], chunks(plain));
  assert.equal(compressed.exitCode, 0, compressed.stderr);
  assert.deepEqual(compressed.stdout, large.stdout);
});
