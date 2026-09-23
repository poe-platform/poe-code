import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunks, run } from './helpers.js';
import { Shell } from '../../../../src/shell/shell.js';
import { CommandRegistry } from '../../../../src/contracts/index.js';
import { createCompressionCommands } from '../../../../src/commands/bytes/compression/index.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';

// Native XZ fixtures preserved in issue 234 comment 5767 (liblzma 5.4.5).
const first = Buffer.from('/Td6WFoAAATm1rRGAgAhAQwAAACPmEGcAQANQ2hhbmdlZEZpcnN0/QoAAAC2zsf1f77UeQABJg4IG+AEH7bzfQEAAAAABFla', 'base64');
const second = Buffer.from('/Td6WFoAAATm1rRGAgAhAQwAAACPmEGcAQAOQ2hhbmdlZFNlY29uZIEKAABXVBEKfZtYRAABJw/fGvxqH7bzfQEAAAAABFla', 'base64');
const payload = Buffer.from('ChangedFirst\xfd\n', 'latin1');

for (const command of ['xz', 'unxz', 'xzcat']) {
  for (const size of [1, 7, 65536]) test(`${command} single-stream stops before the next stream with chunks of ${size}`, async () => {
    const input = Buffer.concat([first, second]);
    const source = (async function* () {
      for (let offset = 0; offset < input.length; offset += size) yield input.subarray(offset, offset + size);
    })();
    const result = await run(command, ['-dc', '--single-stream'], source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, payload);
    assert.equal(result.stderr, '');
  });

  test(`${command} single-stream ignores trailing garbage but validates the first stream`, async () => {
    const good = await run(command, ['-dc', '--single-stream'], chunks(first, Buffer.from('garbage')));
    assert.equal(good.exitCode, 0, good.stderr);
    assert.deepEqual(good.stdout, payload);
    const bad = await run(command, ['-dc', '--single-stream'], chunks(first.subarray(0, first.length - 1)));
    assert.equal(bad.exitCode, 1);
    assert.notEqual(bad.stderr, '');
  });

  for (const flag of ['--format=auto', '--format', '-Fauto', '-F']) test(`${command} ${flag} retains automatic XZ/LZMA detection`, async () => {
    const flags = flag === '--format' || flag === '-F' ? [flag, 'auto'] : [flag];
    for (const [input, expected] of [[first, payload], [Buffer.from('XQAABAD//////////wAhmggnELc2u24TTuGo1i68Ofu//+/fAAA=', 'base64'), payload]]) {
      const result = await run(command, ['-dc', ...flags], chunks(input!));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout, expected);
    }
  });

  test(`${command} quiet preserves failure status and repeated quiet suppresses errors`, async () => {
    for (const flags of [['--quiet'], ['-q'], ['-qq'], ['--quiet', '--quiet']]) {
      const result = await run(command, ['-dc', ...flags], chunks(Buffer.from('invalid')));
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr === '', flags.length === 2 || flags[0] === '-qq');
      const missing = await run(command, ['-dc', ...flags, '/missing']);
      assert.equal(missing.exitCode, 1);
      assert.equal(missing.stderr === '', flags.length === 2 || flags[0] === '-qq');
    }
  });

  for (const flag of ['--no-sparse', '--no-warn']) test(`${command} ${flag} retains valid bytes and reports data errors`, async () => {
    const good = await run(command, ['-dc', flag], chunks(first));
    assert.equal(good.exitCode, 0, good.stderr);
    assert.deepEqual(good.stdout, payload);
    const bad = await run(command, ['-dc', flag], chunks(Buffer.from('invalid')));
    assert.equal(bad.exitCode, 1);
    assert.notEqual(bad.stderr, '');
  });
}

test('XZ single-stream applies to virtual file output and test mode', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input.xz', Buffer.concat([first, second]));
  const shell = new Shell({ fs, commands: new CommandRegistry(createCompressionCommands()) });
  const result = await shell.exec('unxz --single-stream -k /input.xz');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(await fs.readFile('/input')), payload);
  await fs.writeFile('/tail.xz', Buffer.concat([first, Buffer.from('garbage')]));
  const tested = await shell.exec('xz --single-stream -t /tail.xz');
  assert.equal(tested.exitCode, 0, tested.stderr);
  assert.equal(tested.stdout, '');
});

test('XZ single-stream does not truncate compression input', async () => {
  const input = Buffer.from('whole input\0with zeros');
  const encoded = await run('xz', ['--single-stream', '--format=auto', '--no-sparse', '--no-warn', '-0c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const decoded = await run('xz', ['-dc'], chunks(encoded.stdout));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, input);
});

test('XZ controls reject values on switches and unsupported forced formats', async () => {
  for (const flag of ['--single-stream=1', '--quiet=1', '--no-warn=1', '--no-sparse=1', '--format=raw', '--format', '-F']) {
    const result = await run('xz', ['-dc', flag], chunks(first));
    assert.equal(result.exitCode, 2, flag);
    assert.equal(result.stdout.length, 0, flag);
    assert.notEqual(result.stderr, '', flag);
  }
});
