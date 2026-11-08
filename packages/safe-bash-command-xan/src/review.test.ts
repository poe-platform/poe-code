import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createCommandArguments, toByteSource } from 'safe-bash-contracts';
import { createXanCommand, type XanLimits } from './index.js';

async function run(args: string[], input: string | Uint8Array, right = '', limits: Partial<XanLimits> = {}) {
  const values = createCommandArguments(args);
  const fs = createMemoryFileSystem();
  await fs.writeFile('/right.csv', new TextEncoder().encode(right));
  const chunks: Uint8Array[] = [];
  let stderr = '';
  const result = await createXanCommand({ limits }).execute({
    command: 'xan', args: values.args, argumentValues: values, cwd: '/', env: {}, fs,
    stdin: toByteSource(input), signal: new AbortController().signal,
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { ...result, bytes, stdout: new TextDecoder().decode(bytes), stderr };
}

for (const flag of ['-L', '--last']) test(`slice ${flag} reads the last rows from a file under default limits`, async () => {
  const result = await run(['slice', flag, '2', '/right.csv'], '', 'id,val\n1,a\n2,b\n3,c\n4,d\n');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'id,val\n3,c\n4,d\n');
});

test('search combines selected columns, case folding, inversion and exact matching', async () => {
  const input = 'a,b\nALPHA,alpha\nalpha,beta\nbeta,beta\n';
  const result = await run(['search', '-i', '--every-column', '-e', 'alpha'], input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'a,b\nALPHA,alpha\n');
  assert.equal((await run(['search', '-i', '-v', 'alpha'], input)).stdout, 'a,b\nbeta,beta\n');
});

test('rename parses quoted replacement cells and retains headerless input as data', async () => {
  const result = await run(['rename', '-n', '"first,name",second'], 'a,b\nc,d\n');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '"first,name",second\na,b\nc,d\n');
});

test('reverse and frequency preserve distinct invalid UTF-8 cell bytes', async () => {
  const input = Uint8Array.of(120, 10, 255, 10, 254, 10);
  const reversed = await run(['reverse'], input);
  assert.equal(reversed.exitCode, 0, reversed.stderr);
  assert.deepEqual(reversed.bytes, Uint8Array.of(120, 10, 254, 10, 255, 10));
  const frequencies = await run(['freq'], input);
  assert.equal(frequencies.exitCode, 0, frequencies.stderr);
  assert.deepEqual(frequencies.bytes, new Uint8Array([
    ...new TextEncoder().encode('field,value,count\nx,'), 254,
    ...new TextEncoder().encode(',1\nx,'), 255, ...new TextEncoder().encode(',1\n'),
  ]));
});

test('join separates composite key boundaries and keeps all duplicate matches', async () => {
  const result = await run(['join', '--drop-key', 'none', 'a,b', '-', 'a,b', '/right.csv'],
    'a,b,v\nab,c,left1\na,bc,left2\n', 'a,b,w\na,bc,right2\nab,c,right1\nab,c,right3\n');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'a,b,v,a,b,w\nab,c,left1,ab,c,right1\nab,c,left1,ab,c,right3\na,bc,left2,a,bc,right2\n');
});

test('full join emits unmatched rows on both sides, with empty cells for absent records', async () => {
  const result = await run(['join', '--full', '--drop-key', 'none', 'id', '-', 'id', '/right.csv'],
    'id,v\na,left\nx,orphan\n', 'id,w\na,right\ny,orphan\n');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'id,v,id,w\na,left,a,right\nx,orphan,,\n,,y,orphan\n');
});

test('join rejects incompatible widths and explicit resource exhaustion', async () => {
  assert.equal((await run(['join', 'id', '-', 'id', '/right.csv'], 'id,v\na,left\n', 'id,w\na\n')).exitCode, 1);
  assert.equal((await run(['join', 'id', '-', 'id', '/right.csv'], 'id,v\na,left\n', 'id,w\na,right\n', { maxWork: 100 })).exitCode, 1);
});

test('search closes a suspended input when its limit is reached', async () => {
  const values = createCommandArguments(['search', '-l', '1', 'a', '/input.csv']);
  let closed = false;
  let reads = 0;
  const result = await createXanCommand().execute({
    command: 'xan', args: values.args, argumentValues: values, cwd: '/', env: {},
    signal: new AbortController().signal, stdin: toByteSource(''),
    fs: Object.assign(createMemoryFileSystem(), { readStream() { return { async *[Symbol.asyncIterator]() {
      try {
        reads++;
        yield new TextEncoder().encode('name\na\n');
        reads++;
        yield new TextEncoder().encode('b\n');
      } finally { closed = true; }
    } }; } }),
    stdout: { async write() {} }, stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(reads, 1);
  assert.equal(closed, true);
});

test('transform propagates sink failure and closes suspended input', async () => {
  const values = createCommandArguments(['search', 'a', '/input.csv']);
  const failure = new Error('sink failure');
  let closed = false;
  await assert.rejects(async () => createXanCommand().execute({
    command: 'xan', args: values.args, argumentValues: values, cwd: '/', env: {},
    signal: new AbortController().signal, stdin: toByteSource(''),
    fs: Object.assign(createMemoryFileSystem(), { readStream() { return { async *[Symbol.asyncIterator]() {
      try { yield new TextEncoder().encode('name\na\n'); }
      finally { closed = true; }
    } }; } }),
    stdout: { async write() { throw failure; } }, stderr: { async write() {} },
  }), error => error === failure);
  assert.equal(closed, true);
});

test('numeric sort validates even a single data row', async () => {
  const result = await run(['sort', '-N'], 'value\ninvalid\n');
  assert.equal(result.exitCode, 1);
});

test('stats reports upstream mixed types in precedence order and zero sums for nonnumeric fields', async () => {
  const mixed = await run(['stats'], 'value\n2\n2.5\nword\n""\n');
  assert.equal(mixed.exitCode, 0, mixed.stderr);
  assert.deepEqual(mixed.stdout.trimEnd().split('\n')[1]!.split(',').slice(0, 6),
    ['value', '3', '1', 'mixed', 'string|float|int|empty', '4.5']);
  const empty = await run(['stats'], 'value\n""\n');
  assert.equal(empty.exitCode, 0, empty.stderr);
  assert.deepEqual(empty.stdout.trimEnd().split('\n')[1]!.split(',').slice(0, 6),
    ['value', '0', '1', 'empty', 'empty', '0']);
  const text = await run(['stats'], 'value\nword\n');
  assert.equal(text.exitCode, 0, text.stderr);
  assert.equal(text.stdout.trimEnd().split('\n')[1]!.split(',')[5], '0');
});
