import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { chunks, run } from './helpers.js';

for (const args of [['-tc'], ['-ct'], ['-t', '-c'], ['--test', '--stdout'], ['--to-stdout', '--test']]) {
  test(`bzip2 ${args.join(' ')} rejects incompatible modes before reading stdin`, async () => {
    let read = false;
    async function* stdin() {
      read = true;
      yield Buffer.from('plaintext');
    }
    const result = await run('bzip2', args, stdin());
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr, 'bzip2: -c and -t cannot be used together.\n');
    assert.equal(read, false);
  });
}

test('bzip2 rejects test-to-stdout for intact and missing operands, preserving the archive', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('hello\n')));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const fs = createMemoryFileSystem();
  await fs.writeFile('/a.bz2', encoded.stdout);
  for (const operand of ['/a.bz2', '/missing.bz2']) {
    const result = await run('bzip2', ['-tc', operand], undefined, { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr, 'bzip2: -c and -t cannot be used together.\n');
  }
  const valid = await run('bzip2', ['-t', '/a.bz2'], undefined, { fs });
  assert.equal(valid.exitCode, 0, valid.stderr);
  assert.equal(valid.stdout.length, 0);
  assert.deepEqual(Buffer.from(await fs.readFile('/a.bz2')), encoded.stdout);
});

test('bzcat tests intact input unless stdout is explicitly requested', async () => {
  const encoded = await run('bzip2', ['-c'], chunks(Buffer.from('hello\n')));
  for (const [flags, code] of [[['-t'], 0], [['-tc'], 1], [['--stdout', '--test'], 1]] as const) {
    const result = await run('bzcat', [...flags], chunks(encoded.stdout));
    assert.equal(result.exitCode, code);
    assert.equal(result.stderr, code ? 'bzcat: -c and -t cannot be used together.\n' : '');
    assert.equal(result.stdout.length, 0);
  }
});
