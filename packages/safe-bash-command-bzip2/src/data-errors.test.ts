import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { chunks, run } from './helpers.js';

for (const command of ['bzip2', 'bunzip2', 'bzcat']) {
  test(`${command} reports data errors as 2 and file errors as 1`, async () => {
    for (const input of [Buffer.alloc(0), Buffer.from('invalid')]) {
      const result = await run(command, ['-dc'], chunks(input));
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout.length, 0);
    }
    assert.equal((await run(command, ['-dc', '/missing'])).exitCode, 1);
  });
}

test('bzip2 streams complete output buffers but discards a truncated final buffer', async () => {
  const input = Buffer.alloc(12001, 120);
  const encoded = await run('bzip2', ['-c'], chunks(input));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const valid = await run('bzip2', ['-dc'], chunks(encoded.stdout));
  assert.equal(valid.exitCode, 0, valid.stderr);
  assert.deepEqual(valid.stdout, input);
  const result = await run('bzip2', ['-dc'], chunks(encoded.stdout.subarray(0, -1)));
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.stdout, input.subarray(0, 10000));
});

test('bzip2 output failures retain status 1', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('valid')));
  const result = await run('bzip2', ['-dc'], chunks(encoded.stdout), {
    stdout: { async write() { throw new Error('sink failure'); } },
  });
  assert.equal(result.exitCode, 1);
});

for (const damage of ['crc', 'truncated', 'plaintext'] as const) {
  for (const mode of ['-d', '-dc', '-t']) {
    test(`bzip2 ${mode} handles later operands after ${damage}`, async () => {
      const input = Buffer.from('later archive contents\n');
      const encoded = await run('bzip2', ['-c'], chunks(input));
      assert.equal(encoded.exitCode, 0, encoded.stderr);
      const bad = damage === 'plaintext' ? Buffer.from('not bzip data')
        : damage === 'truncated' ? encoded.stdout.subarray(0, -4) : Buffer.from(encoded.stdout);
      if (damage === 'crc') bad[10] = bad[10]! ^ 1;
      const fs = createMemoryFileSystem();
      await fs.writeFile('/bad.bz2', bad);
      await fs.writeFile('/good.bz2', encoded.stdout);
      const result = await run('bzip2', [mode, '/bad.bz2', '/good.bz2'], chunks(), { fs });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.deepEqual(Buffer.from(await fs.readFile('/bad.bz2')), bad);
      const continues = damage === 'plaintext' || mode === '-t';
      if (mode === '-d' && continues) {
        assert.deepEqual(Buffer.from(await fs.readFile('/good')), input);
        await assert.rejects(fs.stat('/good.bz2'));
      } else {
        assert.deepEqual(Buffer.from(await fs.readFile('/good.bz2')), encoded.stdout);
        await assert.rejects(fs.stat('/good'));
      }
      await assert.rejects(fs.stat('/bad'));
      assert.deepEqual(result.stdout, mode === '-dc' && continues ? input : Buffer.alloc(0));
      if (mode === '-t' && damage !== 'plaintext') {
        await fs.writeFile('/good.bz2', bad);
        const checked = await run('bzip2', [mode, '/bad.bz2', '/good.bz2'], chunks(), { fs });
        assert.equal(checked.stderr.trim().split('\n').length, 2, checked.stderr);
      }
    });
  }
}

for (const command of ['bzip2', 'bunzip2']) {
  test(`${command} identifies damaged operands and distinguishes integrity failures`, async () => {
    const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('archive contents\n')));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    const corrupt = Buffer.from(encoded.stdout);
    corrupt[10] = corrupt[10]! ^ 1;
    const fs = createMemoryFileSystem();
    await fs.writeFile('/bad.bz2', corrupt);
    await fs.writeFile('/plain', Buffer.from('README text\n'));
    await fs.writeFile('/short.bz2', encoded.stdout.subarray(0, -4));
    await fs.writeFile('/good.bz2', encoded.stdout);
    const tested = await run(command, ['-t', './bad.bz2', 'plain', 'good.bz2'], chunks(), { fs });
    assert.equal(tested.exitCode, 2, tested.stderr);
    const lines = tested.stderr.trim().split('\n');
    assert.equal(lines.length, 2, tested.stderr);
    assert.ok(lines[0]!.includes('./bad.bz2:') && lines[0]!.includes('CRC'), tested.stderr);
    assert.ok(lines[1]!.includes('plain:') && lines[1]!.includes('bad magic'), tested.stderr);
    const truncated = await run(command, ['-dc', './short.bz2'], chunks(), { fs });
    assert.equal(truncated.exitCode, 2, truncated.stderr);
    assert.ok(truncated.stderr.includes('./short.bz2: unexpected end of file'), truncated.stderr);
    const missing = await run(command, ['-dc', './absent', 'good.bz2'], chunks(), { fs });
    assert.equal(missing.exitCode, 1, missing.stderr);
    assert.ok(missing.stderr.includes('./absent: ENOENT: no such file or directory'), missing.stderr);
    assert.ok(!missing.stderr.includes("'/absent'"), missing.stderr);
    assert.equal(missing.stdout.toString(), 'archive contents\n');
  });
}

test('bzip2 identifies standard input in integrity diagnostics', async () => {
  const result = await run('bzip2', ['-t'], chunks(Buffer.from('plain text')));
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.includes('(stdin):') && result.stderr.includes('bad magic'), result.stderr);
});

test('bzcat names CRC failures without exposing internal error details', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('archive contents')));
  const corrupt = Buffer.from(encoded.stdout);
  corrupt[10] = corrupt[10]! ^ 1;
  const fs = createMemoryFileSystem();
  await fs.writeFile('/bad.bz2', corrupt);
  const result = await run('bzcat', ['./bad.bz2'], chunks(), { fs });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, 'bzcat: ./bad.bz2: data integrity (CRC) error\n');
  const failure = new Error('private sink details');
  const seen: unknown[] = [];
  const failed = await run('bzcat', [], chunks(encoded.stdout), {
    stdout: { async write() { throw failure; } },
    onInternalError(error) { seen.push(error); },
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.stderr, 'bzcat: (stdin): internal error\n');
  assert.deepEqual(seen, [failure]);
});
