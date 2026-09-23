import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { Shell } from '../../../../src/shell/shell.js';
import { CommandRegistry } from '../../../../src/contracts/index.js';
import { createCompressionCommands } from '../../../../src/commands/bytes/compression/index.js';
import { createCodec } from '../../../../src/commands/bytes/compression/codec-loader.js';
import zstd from '../../../../src/commands/bytes/compression/native/generated/zstd.mjs';

const input = Buffer.from('supplemental zstd options\n'.repeat(20));
for (const command of ['zstd', 'unzstd', 'zstdcat']) {
  for (const flags of [['--no-progress'], ['--single-thread'], ['--threads=1'], ['-T1'], ['--check'], ['--no-asyncio'], ['--asyncio'], ['--format=zstd'], ['--no-dictID'], ['--no-sparse'], ['--auto-threads=logical'], ['--ultra'], ['--compress-literals'], ['--no-compress-literals'], ['--row-match-finder'], ['--no-row-match-finder'], ['--size-hint=500'], [`--stream-size=${input.length}`], ['--long=20']]) {
    test(`${command} ${flags.join(' ')} preserves bytes`, async () => {
      const encoded = await run('zstd', ['-c', ...flags], chunks(input));
      assert.equal(encoded.exitCode, 0, encoded.stderr);
      const decoded = await run(command, ['-dc', ...flags], chunks(encoded.stdout));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, input);
    });
  }
  test(`${command} explicit pass-through overrides alias default`, async () => {
    const copied = await run(command, ['-dc', '--pass-through'], chunks(input));
    assert.equal(copied.exitCode, 0, copied.stderr);
    assert.deepEqual(copied.stdout, input);
    const rejected = await run(command, ['-dc', '--pass-through', '--no-pass-through'], chunks(input));
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stdout.length, 0);
  });
}
test('Zstd checksum controls affect framing and validation', async () => {
  const checked = await run('zstd', ['-c'], chunks(input));
  const unchecked = await run('zstd', ['-c', '--no-check'], chunks(input));
  assert.equal(unchecked.exitCode, 0, unchecked.stderr);
  assert.equal(checked.stdout[4]! & 4, 4);
  assert.equal(unchecked.stdout[4]! & 4, 0);
  const damaged = Buffer.from(checked.stdout);
  damaged[damaged.length - 1]! ^= 1;
  assert.equal((await run('unzstd', ['-c'], chunks(damaged))).exitCode, 1);
  const ignored = await run('unzstd', ['-c', '--no-check'], chunks(damaged));
  assert.equal(ignored.exitCode, 0, ignored.stderr);
  assert.deepEqual(ignored.stdout, input);
});
test('Zstd rejects unsupported execution capabilities and malformed values before output', async () => {
  for (const flag of ['--threads=2', '--threads=0', '--adapt', '--rsyncable', '--progress', '--long=31', '--format=lz4', '--stream-size=oops', '--size-hint=-1', '--auto-threads=unknown']) {
    const result = await run('zstd', ['-c', flag], chunks(input));
    assert.equal(result.exitCode, 2, flag);
    assert.equal(result.stdout.length, 0);
  }
});
test('Zstd enforces pledged stream size', async () => {
  const result = await run('zstd', ['-c', '--stream-size=1'], chunks(input));
  assert.equal(result.exitCode, 1);
});
test('Zstd excludes compressed file names even with stdout and force, retaining VFS inputs', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/archive.gz', input);
  await fs.writeFile('/plain', input);
  const shell = new Shell({ fs, commands: new CommandRegistry(createCompressionCommands()) });
  const result = await shell.exec('zstd --exclude-compressed -fc /archive.gz /plain | unzstd -c');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, input.toString());
  assert.deepEqual(Buffer.from(await fs.readFile('/archive.gz')), input);
  assert.deepEqual(Buffer.from(await fs.readFile('/plain')), input);
});
test('Zstd stdin pass-through works without explicit stdout; test mode still validates', async () => {
  const copied = await run('unzstd', ['--pass-through'], chunks(input));
  assert.equal(copied.exitCode, 0, copied.stderr);
  assert.deepEqual(copied.stdout, input);
  assert.equal((await run('unzstd', ['--pass-through', '-t'], chunks(input))).exitCode, 1);
});
test('Zstd stream-size writes a frame content size', async () => {
  const result = await run('zstd', ['-c', `--stream-size=${input.length}`], chunks(input));
  assert.equal(result.exitCode, 0, result.stderr);
  // A nonzero content-size flag or single-segment flag declares a frame size.
  assert.ok(result.stdout[4]! & 0xe0);
});
test('Zstd no-asyncio disables input read-ahead', async () => {
  const firstWrites: number[] = [];
  for (const flag of ['--asyncio', '--no-asyncio']) {
    let reads = 0;
    let firstWrite: number | undefined;
    let state = 1;
    const source = (async function* () {
      for (let index = 0; index < 8; index++) {
        reads++;
        const bytes = new Uint8Array(65536);
        for (let offset = 0; offset < bytes.length; offset++) {
          state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
          bytes[offset] = state & 255;
        }
        yield bytes;
      }
    })();
    const result = await run('zstd', ['-c', flag], source, { stdout: { async write() { firstWrite ??= reads; } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(firstWrite !== undefined);
    firstWrites.push(firstWrite);
  }
  assert.equal(firstWrites[0], firstWrites[1]! + 1);
});
test('Zstd compression controls reach the generated codec', async () => {
  let parameters: number[] | undefined;
  const codec = await createCodec({ format: 'zstd', decompress: false, level: 3,
    zstd: { check: false, literals: 2, row: 1, window: 20, streamSize: 0x100000001, sizeHint: 1234 },
  }, new AbortController().signal, wasi => {
    const module = zstd(wasi);
    const configure = module.bridge_zstd_config!;
    module.bridge_zstd_config = (...args) => { parameters = args; return configure(...args); };
    return module;
  });
  try { assert.deepEqual(parameters, [0, 2, 1, 20, 1, 1, 1, 1234]); }
  finally { codec.close(); }
});
test('Zstd compressed suffix exclusions match the native case-sensitive set', async () => {
  for (const suffix of ['.zst', '.tzst', '.gz', '.tgz', '.xz', '.txz', '.lzma', '.tlz', '.bz2', '.tbz2', '.lz4', '.zip', '.7z', '.rar', '.lz', '.br', '.cab', '.tbz', '.lzo', '.Z', '.ZST']) {
    const fs = createMemoryFileSystem();
    const path = '/input' + suffix;
    await fs.writeFile(path, input);
    const result = await run('zstd', ['--exclude-compressed', '-fc', path], chunks(), { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length === 0, !['.tbz', '.lzo', '.Z', '.ZST'].includes(suffix), suffix);
  }
});
test('Zstd pass-through publishes plaintext through VFS staging', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/plain.zst', input);
  const result = await run('unzstd', ['--pass-through', '/plain.zst'], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(await fs.readFile('/plain')), input);
  assert.deepEqual(Buffer.from(await fs.readFile('/plain.zst')), input);
});
