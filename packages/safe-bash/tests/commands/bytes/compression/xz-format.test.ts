import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';

test('forced LZMA format encodes real legacy streams across XZ aliases', async () => {
  const plain = Buffer.from('legacy format\0\xff'.repeat(30));
  for (const command of ['xz', 'unxz', 'xzcat']) {
    const encoded = await run(command, ['--compress', '--format=lzma', '-0c'], chunks(plain));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout[0], 0x5d);
    assert.equal(encoded.stdout.readUInt32LE(1), 256 * 1024);
    for (const flag of ['--format=lzma', '-Flzma']) {
      const decoded = await run(command, ['-dc', flag], chunks(...Array.from(encoded.stdout, byte => Uint8Array.of(byte))));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, plain);
    }
    const automatic = await run('xz', ['-dc'], chunks(encoded.stdout));
    assert.equal(automatic.exitCode, 0, automatic.stderr);
    assert.deepEqual(automatic.stdout, plain);
  }
});

test('forced LZMA rejects XZ streams, validates checks, and preserves file inputs on failure', async () => {
  const plain = Buffer.from('legacy files');
  const xz = await run('xz', ['-c'], chunks(plain));
  const rejected = await run('xz', ['-dc', '--format=lzma'], chunks(xz.stdout));
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.stdout.length, 0);
  const copied = await run('xz', ['-dcf', '--format=lzma'], chunks(xz.stdout));
  assert.equal(copied.exitCode, 0, copied.stderr);
  assert.deepEqual(copied.stdout, xz.stdout);
  for (const check of ['crc32', 'crc64', 'sha256']) {
    const invalid = await run('xz', ['-c', '--format=lzma', `--check=${check}`], chunks(plain));
    assert.equal(invalid.exitCode, 2);
  }
  const fs = xz.fs;
  await fs.writeFile('/legacy', plain);
  const encoded = await run('xz', ['-k', '--format=lzma', '/legacy'], chunks(), { fs });
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  await fs.unlink!('/legacy');
  const decoded = await run('unxz', ['--format=lzma', '/legacy.lzma'], chunks(), { fs });
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(Buffer.from(await fs.readFile('/legacy')), plain);
  const automaticEncoded = await run('xz', ['-0c', '--format=lzma'], chunks(plain));
  await fs.writeFile('/automatic.lzma', automaticEncoded.stdout);
  const automaticFile = await run('unxz', ['/automatic.lzma'], chunks(), { fs });
  assert.equal(automaticFile.exitCode, 0, automaticFile.stderr);
  assert.deepEqual(Buffer.from(await fs.readFile('/automatic')), plain);
  await fs.writeFile('/broken.lzma', Buffer.from('broken'));
  await fs.writeFile('/broken', Buffer.from('existing'));
  const failure = await run('unxz', ['-f', '--format=lzma', '/broken.lzma'], chunks(), { fs });
  assert.equal(failure.exitCode, 1);
  assert.deepEqual(Buffer.from(await fs.readFile('/broken.lzma')), Buffer.from('broken'));
  assert.deepEqual(Buffer.from(await fs.readFile('/broken')), Buffer.from('existing'));
  const stream = await run('xz', ['-0c', '--format=lzma'], chunks(plain));
  const truncated = await run('xz', ['-dc', '--format=lzma'], chunks(stream.stdout.subarray(0, -4)));
  assert.equal(truncated.exitCode, 1);
  const limited = await run('xz', ['-dc', '--format=lzma', '--memlimit-decompress=1KiB'], chunks(stream.stdout));
  assert.equal(limited.exitCode, 1);
  const checked = await run('xz', ['-t', '--format=lzma'], chunks(stream.stdout));
  assert.equal(checked.exitCode, 0, checked.stderr);
  assert.equal(checked.stdout.length, 0);
  const trailing = await run('xz', ['-dc', '--format=lzma'], chunks(stream.stdout, stream.stdout));
  assert.equal(trailing.exitCode, 1);
  assert.deepEqual(trailing.stdout, plain);
  const single = await run('xz', ['-dc', '--format=lzma', '--single-stream'], chunks(stream.stdout, stream.stdout));
  assert.equal(single.exitCode, 0, single.stderr);
  assert.deepEqual(single.stdout, plain);
  const noCheck = await run('xz', ['-0c', '--format=lzma', '--check=none'], chunks(plain));
  assert.equal(noCheck.exitCode, 0, noCheck.stderr);
  assert.deepEqual(noCheck.stdout, stream.stdout);
});

for (const format of ['--format=xz', '-Fxz', '-F xz']) {
  test(`forced XZ format ${format} round-trips and rejects legacy input`, async () => {
    const flags = format.split(' ');
    const plain = Buffer.from('forced XZ\0\xff');
    const encoded = await run('xz', [...flags, '-c'], chunks(plain));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    for (const command of ['xz', 'unxz', 'xzcat']) {
      const decoded = await run(command, [...flags, '-dc'], chunks(...Array.from(encoded.stdout, byte => Uint8Array.of(byte))));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, plain);
      const legacy = Buffer.from('XQAABAD//////////wCD//v//8AAAAA=', 'base64');
      const rejected = await run(command, [...flags, '-dc'], chunks(legacy));
      assert.equal(rejected.exitCode, 1);
      assert.equal(rejected.stdout.length, 0);
    }
  });
}

test('forced XZ checks every concatenated member and auto can override it', async () => {
  const plain = Buffer.from('hello');
  const encoded = await run('xz', ['-c'], chunks(plain));
  const legacy = Buffer.from('XQAABAD//////////wCD//v//8AAAAA=', 'base64');
  const mixed = Buffer.concat([encoded.stdout, legacy]);
  const rejected = await run('xz', ['-dc', '--format=xz'], chunks(mixed));
  assert.equal(rejected.exitCode, 1);
  assert.deepEqual(rejected.stdout, plain);
  const automatic = await run('xz', ['-dc', '--format=xz', '--format=auto'], chunks(legacy));
  assert.equal(automatic.exitCode, 0, automatic.stderr);
  const forcedCopy = await run('xz', ['-dcf', '--format=xz'], chunks(legacy));
  assert.equal(forcedCopy.exitCode, 0, forcedCopy.stderr);
  assert.deepEqual(forcedCopy.stdout, legacy);
  const testMode = await run('xz', ['-t', '--format=xz'], chunks(legacy));
  assert.equal(testMode.exitCode, 1);
});
