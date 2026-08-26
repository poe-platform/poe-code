import assert from "node:assert/strict";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import type { ByteSource, CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { execute } from "./harness.js";

async function* split(bytes: Uint8Array, size: number): ByteSource {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}

const malformed = [
  '[1,]', '{"x":}', '{"x" 1}', '{"x":1,}', '[true false]', '[01]', '[1e]', 'truefalse', '1e+',
  '0x10', '"bad\nstring"', '"\\q"', '"\\u12"', '"\\uD800"', '"\\uDC00"', '\uFEFF0', 'null\u0000',
  '[}', '[[[]]', '{"x": [1}', '1e9999', '-Infinity', 'NaN',
];
for (const [index, input] of malformed.entries()) test(`${input === '1e9999' ? 'valid large exponent' : 'strict malformed JSON'} ${index} across chunk boundaries`, { timeout: 3000 }, async () => {
  for (const size of [1, 2, 5, 64]) {
    const result = await execute(['-c', '.'], split(Buffer.from(input), size));
    assert.equal(result.status, input === '1e9999' ? 0 : 5, JSON.stringify({ input, size, result }));
    assert.equal(result.stdout, input === '1e9999' ? '1E+9999\n' : '');
    if (input === '1e9999') assert.equal(result.stderr, '');
    else assert.match(result.stderr, /^jq: /u);
  }
});

test('malformed suffix preserves completed prefix but slurp remains atomic', async () => {
  for (const suffix of ['[1,]', '"\\uD800"', 'truefalse']) for (const size of [1, 3, 64]) {
    for (const flags of [['-c'], ['-sc']]) {
      const result = await execute([...flags, '.'], split(Buffer.from(`{"ok":1}\n${suffix}`), size));
      assert.equal(result.status, 5);
      assert.equal(result.stdout, flags[0] === '-sc' ? '' : '{"ok":1}\n');
    }
  }
});

test('invalid UTF-8 never becomes replacement text', async () => {
  for (const invalid of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f], [0x80]]) {
    const bytes = Buffer.concat([Buffer.from('{}\n'), Buffer.from(invalid)]);
    for (const size of [1, 2, 64]) {
      const result = await execute(['-c', '.'], split(bytes, size));
      assert.equal(result.status, 5);
      assert.equal(result.stdout, '{}\n');
      assert.match(result.stderr, /UTF-8/u);
    }
  }
});

const preflight: readonly [readonly string[], number][] = [
  [['-c', '1,('], 3], [['-c', 'if true then 1 else $missing end'], 3], [['-c', 'false and nope'], 3],
  [['-c', '"\\q"'], 3], [['-c', '.foo='], 3], [['-c', 'sort_by()'], 3], [['-c', '.[0:1]=0'], 3],
  [['-c', '.[]? |= 0'], 3], [['-c', 'join(",";":")'], 3], [['-RZ', '.'], 2], [['--raw-input=lines', '.'], 2],
  [['--argjson', 'x', '{"bad":}', '$x'], 2], [['--argjson', 'x', '1 2', '$x'], 2],
];
for (const [index, [argv, status]] of preflight.entries()) test(`preflight ${index} acquires no input or data files`, async () => {
  let acquired = 0;
  let opened = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { acquired++; throw new Error('unexpected stdin acquisition'); } };
  const fs = new Proxy(new MemoryFileSystem(), { get(target, property) {
    if (property === 'readFile' || property === 'readStream') return () => { opened++; throw new Error('unexpected data file read'); };
    const member: unknown = Reflect.get(target, property);
    return typeof member === 'function' ? member.bind(target) : member;
  } });
  const result = await execute([...argv, '/must-not-open'], stdin, {}, { fs });
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(acquired, 0);
  assert.equal(opened, 0);
});

test('null input ignores invalid stdin and missing data files', async () => {
  const stdin: ByteSource = { [Symbol.asyncIterator]() { throw new Error('unexpected stdin acquisition'); } };
  const result = await execute(['-nsc', '.', '/missing'], stdin);
  assert.deepEqual(result, { status: 0, stdout: 'null\n', stderr: '' });
});

test('virtual argv preserves NUL without invoking a host process', async () => {
  const result = await execute(['-nr', '--arg', 'value', 'a\u0000b', '$value']);
  assert.deepEqual(result, { status: 0, stdout: 'a\u0000b\n', stderr: '' });
});

test('empty last remains distinct from empty first under exit-status mode', async () => {
  assert.deepEqual(await execute(['-ne', 'last(empty)']), { status: 1, stdout: 'null\n', stderr: '' });
  assert.deepEqual(await execute(['-ne', 'first(empty)']), { status: 4, stdout: '', stderr: '' });
});

test('result and UTF-8 output limits preserve exact emitted prefixes', async () => {
  const results = await execute(['-nc', 'range(20)'], '', { limits: { maxResults: 3 } });
  assert.equal(results.status, 5);
  assert.equal(results.stdout, '0\n1\n2\n');
  assert.match(results.stderr, /maxResults/u);
  const exact = await execute(['-nr', '"😀"'], '', { limits: { maxOutputBytes: 5 } });
  assert.equal(exact.stdout, '😀\n');
  assert.equal(exact.status, 0);
  const short = await execute(['-nr', '"😀"'], '', { limits: { maxOutputBytes: 4 } });
  assert.equal(short.stdout, '');
  assert.equal(short.status, 5);
  assert.match(short.stderr, /maxOutputBytes/u);
});

test('limits cannot be swallowed by optional filters or hidden products', async () => {
  const cases = [
    { filter: '([range(1000)])?', limits: { maxCollectionSize: 8 }, message: /maxCollectionSize/u },
    { filter: '([range(100000)]|empty)?', limits: { maxSteps: 64 }, message: /maxSteps/u },
    { filter: '.[1000000]=0', limits: { maxCollectionSize: 8 }, message: /maxCollectionSize/u },
    { filter: '("😀"*1000000)?', limits: { maxValueBytes: 32 }, message: /maxValueBytes/u },
    { filter: '[range(32)]|sort_by([range(32)])', limits: { maxValueBytes: 256 }, message: /maxValueBytes/u },
  ];
  for (const fixture of cases) {
    const result = await execute(['-nc', fixture.filter], '', { limits: fixture.limits });
    assert.equal(result.status, 5, fixture.filter);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, fixture.message);
  }
});

test('bounded generators remain lazy after index and slice fixes', async () => {
  for (const filter of ['first([42][range(1000000)])', 'first([42][range(1000000):1])', 'first([42][0:range(1;1000000)])']) {
    const result = await execute(['-nc', filter], '', { limits: { maxSteps: 128, maxCollectionSize: 8 } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, filter.includes(':') ? '[42]\n' : '42\n');
  }
});

test('stalled reads and writes abort and observe late host rejections', { timeout: 3000 }, async () => {
  for (const operation of ['read', 'write'] as const) {
    const controller = new AbortController();
    const reason = new Error(`independent ${operation} abort`);
    let entered!: () => void;
    let rejectLate!: (error: Error) => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = () => { entered(); return new Promise<never>((_, reject) => { rejectLate = reject; }); };
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return { next: pending }; } };
    const overrides: Partial<CommandContext> = { signal: controller.signal, ...(operation === 'write' ? { stdout: { write: pending } } : {}) };
    const running = execute(operation === 'read' ? ['.'] : ['-n', '.'], stdin, {}, overrides);
    const rejected = assert.rejects(running, error => error === reason);
    await ready;
    controller.abort(reason);
    await rejected;
    rejectLate(new Error('late failure must be observed'));
    await delay(0);
  }
});

test('CPU expansion cooperatively observes cancellation', { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error('independent CPU cancellation');
  const running = execute(['-nc', 'range(1000000000)|empty'], '', { limits: { maxSteps: 10000000 } }, { signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  await setImmediate();
  controller.abort(reason);
  await rejected;
});

test('seeded JSON roundtrips tolerate every selected byte split', { timeout: 10000 }, async () => {
  let seed = 0x6d2b79f5;
  const random = (maximum: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  const strings = ['😀', 'é', '\u0000', '\n\t"\\', '__proto__', 'constructor', '', '2'];
  const value = (depth: number): unknown => {
    const kind = random(depth ? 6 : 4);
    if (kind === 0) return null;
    if (kind === 1) return random(2) !== 0;
    if (kind === 2) return (random(201) - 100) / 8;
    if (kind === 3) return strings[random(strings.length)];
    if (kind === 4) return Array.from({ length: random(5) }, () => value(depth - 1));
    return Object.fromEntries(Array.from({ length: random(5) }, () => [strings[random(strings.length)]!, value(depth - 1)]));
  };
  for (let round = 0; round < 64; round++) {
    const input = JSON.stringify(value(3));
    for (const size of [1, 2, 7, 64]) {
      const result = await execute(['-c', '.'], split(Buffer.from(input), size));
      assert.deepEqual(result, { status: 0, stdout: `${input}\n`, stderr: '' }, `seed 0x6d2b79f5 round ${round} chunk ${size}`);
    }
  }
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});
