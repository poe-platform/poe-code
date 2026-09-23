import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../../../src/shell/shell.js';
import { agentCommands } from '../../../../src/plugins/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { boundedCodec } from '../../../../src/commands/bytes/compression/bounded-codec.js';
import { createCodec } from '../../../../src/commands/bytes/compression/codec-loader.js';
import { CodecReader } from '../../../../src/commands/bytes/compression/codec.js';
import bz2 from '../../../../src/commands/bytes/compression/native/generated/bz2.mjs';
import { chunks, run } from './helpers.js';

for (const command of ['bzip2', 'bunzip2', 'bzcat']) {
  for (const flag of ['--compress', '-z']) test(`${command} ${flag} selects compression`, async () => {
    const input = Buffer.from('abc\n');
    const encoded = await run(command, [flag, '-c'], chunks(input));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout.subarray(0, 4).toString(), 'BZh9');
    const decoded = await run('bzip2', ['-dc'], chunks(encoded.stdout));
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.deepEqual(decoded.stdout, input);
  });
}

for (const flags of [['--small', '-9c'], ['-9sc'], ['-s9c'], ['-s1c']]) {
  test(`bzip2 ${flags.join(' ')} caps compression at block size two`, async () => {
    const encoded = await run('bzip2', flags, chunks(Buffer.from('abc\n')));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout.subarray(0, 4).toString(), flags.includes('-s1c') ? 'BZh1' : 'BZh2');
    const decoded = await run('bzip2', ['--small', '-dc'], chunks(encoded.stdout));
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.equal(decoded.stdout.toString(), 'abc\n');
  });
}

test('reported bzip2 aliases round trip through agentCommands pipelines', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', Buffer.from('abc\n'));
  const shell = new Shell({ fs }).use(agentCommands());
  for (const flag of ['--compress', '--small']) {
    const result = await shell.exec(`bzip2 ${flag} -c /input | bzip2 -dc`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'abc\n');
    assert.equal(result.stderr, '');
  }
});

test('bzip2 last compression/decompression selector wins', async () => {
  const input = Buffer.from('abc\n');
  const encoded = await run('bzip2', ['-dzc'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const decoded = await run('bzip2', ['-zdc'], chunks(encoded.stdout));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, input);
});

test('small bzip2 decoding allocates less codec memory and validates concatenated members', async () => {
  const input = Buffer.from('abc\n'.repeat(1000));
  const encoded = await run('bzip2', ['-9c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const peaks: number[] = [];
  for (const small of [false, true]) {
    const signal = new AbortController().signal;
    const modules: ReturnType<typeof bz2>[] = [];
    const reader = new CodecReader(chunks(encoded.stdout, encoded.stdout), signal);
    const output: Uint8Array[] = [];
    for await (const bytes of boundedCodec(reader, { format: 'bzip2', level: 9, decompress: true, small }, signal,
      (options, activeSignal) => createCodec(options, activeSignal, wasi => {
        const module = bz2(wasi);
        modules.push(module);
        return module;
      }))) output.push(bytes);
    assert.deepEqual(Buffer.concat(output), Buffer.concat([input, input]));
    assert.equal(modules.length, 2);
    for (const module of modules) assert.equal(module.bridge_used(), 0);
    peaks.push(modules[0]!.bridge_peak());
  }
  assert.ok(peaks[1]! < peaks[0]! * 0.75, `small allocation ${peaks[1]} versus normal ${peaks[0]}`);
  const corrupt = encoded.stdout.slice();
  corrupt[corrupt.length - 2] = corrupt[corrupt.length - 2]! ^ 1;
  const failed = await run('bzip2', ['-sdc'], chunks(corrupt));
  assert.notEqual(failed.exitCode, 0);
});
