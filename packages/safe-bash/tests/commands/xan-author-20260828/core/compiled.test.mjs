import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.XAN_PACKAGE_ROOT, 'requires assembled moved compiled package');
const root = process.env.XAN_PACKAGE_ROOT;
const load = relative => import(pathToFileURL(join(root, 'dist', relative)).href);
const { createXanCommand, createXanCommands, xanCommands, defaultLimits, hardLimits } = await load('commands/xan/index.js');
const { Budget, Bytes, LimitError } = await load('commands/xan/budget.js');
const { MemoryFileSystem } = await load('fs/memory/index.js');
const { FsError } = await load('contracts/errors.js');
const { CommandRegistry } = await load('contracts/command.js');
const { Shell } = await load('shell/index.js');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;
function source(value, size = 65536) {
  const data = bytes(value);
  return { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < data.length; offset += size) yield data.subarray(offset, offset + size); } };
}
async function run(args, input = '', options = {}) {
  const stdout = [];
  const stderr = [];
  const cleanups = [];
  const context = {
    command: 'xan', args, cwd: '/', env: {}, fs: options.fs ?? new MemoryFileSystem(),
    stdin: options.stdin ?? source(input, options.chunkSize), stdinIsDefault: false,
    stdout: options.stdout ?? { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: options.stderr ?? { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    signal: options.signal ?? new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); options.registerCleanup?.(cleanup); },
  };
  const result = await createXanCommand(options.factory).execute(context);
  await Promise.all(cleanups.map(cleanup => cleanup()));
  return { ...result, out: Buffer.concat(stdout).toString(), err: Buffer.concat(stderr).toString(), raw: Buffer.concat(stdout), context };
}
async function good(args, input, expected, options) {
  const result = await run(args, input, options);
  assert.equal(result.exitCode, 0, result.err);
  assert.equal(result.err, ''); assert.equal(result.out, expected);
  return result;
}

test('factory validation: all eighteen defaults/hard ceilings and invalid values', () => {
  assert.equal(Object.keys(defaultLimits).length, 18);
  assert.equal(Object.keys(hardLimits).length, 18);
  assert.equal(createXanCommand().name, 'xan');
  assert.deepEqual(createXanCommands().map(command => command.name), ['xan']);
  for (const key of Object.keys(defaultLimits)) {
    for (const value of [undefined, null, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, hardLimits[key] + 1, '1']) {
      assert.throws(() => createXanCommand({ limits: { [key]: value } }), { name: 'RangeError', message: `Invalid xan limit: ${key}` });
    }
    createXanCommand({ limits: { [key]: 1 } }); createXanCommand({ limits: { [key]: hardLimits[key] } });
  }
  for (const options of [{ bogus: true }, { limits: { bogus: 2 } }, { replace: 'yes' }, { replace: undefined }, { limits: null }, null]) assert.throws(() => createXanCommand(options), TypeError);
  const registry = new CommandRegistry(createXanCommands());
  assert.throws(() => xanCommands().setup({ commands: registry }), /already registered/u);
  xanCommands({ replace: true }).setup({ commands: registry });
});

const ordinary = 'a,b\n1,2\n3,4\n';
const rich = 'a,a,ab,ba,a*,*,"a""""b",0,x:y,"x,y",,a]\nA0,A1,AB,BA,AST,STAR,QQ,ZERO,COL,COM,EMPTY,CLOSE\n';
test('literal consuming selectors: order, occurrence, signed, range, complement, quote oddities', async () => {
  const cases = [
    ['', ordinary], ['*', ordinary], [':', ordinary], ['0:1', ordinary], ['!', '\n\n\n'],
    ['0,', 'a\n1\n3\n'], ['-1', 'b\n2\n4\n'], ['!0', 'b\n2\n4\n'],
    ['-1:+0', 'b,a\n2,1\n4,3\n'], ['0,0', 'a,a\n1,1\n3,3\n'], ['"+0"', 'a\n1\n3\n'],
  ];
  for (const [selection, expected] of cases) await good(['select', '--', selection], ordinary, expected);
  const names = [
    ['a[-1]', 'a\nA1\n'], ['a[1],a[0],a[1]', 'a,a,a\nA1,A0,A1\n'],
    ['**', 'a*,*\nAST,STAR\n'], ['*a*', 'a*\nAST\n'], ['a**', 'a*\nAST\n'],
    ['"a""b"', '"a""""b"\nQQ\n'], ['0[0]', '0\nZERO\n'], ['[+0]', '""\nEMPTY\n'],
    ['a]', 'a]\nCLOSE\n'], ['0:*', 'a,a,ab,ba,a*,*\nA0,A1,AB,BA,AST,STAR\n'],
    ['a*[0]:0', 'a*,ba,ab,a,a\nAST,BA,AB,A1,A0\n'], ['"x:y","x,y"', 'x:y,"x,y"\nCOL,COM\n'],
    ['"a*"', 'a,a,ab,a*,"a""""b",a]\nA0,A1,AB,AST,QQ,CLOSE\n'],
  ];
  for (const [selection, expected] of names) await good(['select', '--', selection], rich, expected, { chunkSize: 1 });
});

test('S/N selectors and argv fail before metadata or iterator acquisition', async () => {
  let acquired = 0;
  const stdin = { [Symbol.asyncIterator]() { acquired++; throw new Error('poison input'); } };
  const fs = new Proxy(new MemoryFileSystem(), { get(target, property) {
    if (['stat', 'lstat', 'readStream', 'writeStream', 'writeFile'].includes(property)) return () => { acquired++; throw new Error('poison filesystem'); };
    return Reflect.get(target, property);
  } });
  for (const selection of [',', '!,', ',0', '0,,1', '0,,', '0::1', '0:1:0', '::', '*:1', 'a*:0', '*a[0]', '*[0]', '"a"junk', 'a[0][1]', 'a[0]junk', 'a[0]*', 'a[]', 'a[+ ]', 'a[0[1]]', 'a[9223372036854775808]', '"a', 'a[0']) {
    const result = await run(['select', '-o', '/output', '--', selection, '/input'], '', { fs, stdin });
    assert.equal(result.exitCode, 1, selection); assert.equal(result.out, ''); assert.match(result.err, /xan select:/u);
  }
  for (const args of [['headers', '-n'], ['count', '-p'], ['count', '--threads=2'], ['select', '-e', 'x'], ['slice', '--raw'], ['slice', '-L1', '-I0'], ['slice', '-I0', '-s1'], ['slice', '-i0', '-e1'], ['slice', '-e2', '-l1'], ['slice', '-s2', '-e1'], ['count', '-nn'], ['headers', '--color=always'], ['count', '-d', '\n'], ['count', '-d', '"'], ['count', '-d', 'é'], ['slice', '-s', ''], ['slice', '-s', ' 1'], ['slice', '-s', '0x1'], ['slice', '-s18446744073709551616'], ['slice', '-i18446744073709551615'], ['slice', '-I', '0,,2'], ['count', 'input.gz'], ['select', '\ud800'], ['headers', '-', '-']]) {
    const result = await run(args, '', { fs, stdin }); assert.equal(result.exitCode, 1, String(args));
  }
  assert.equal(acquired, 0);
});

test('R resolution reads exactly one header and never touches poison next or output', async () => {
  for (const selection of ['missing', '9223372036854775808', '0:*', '2', '-3', 'a[1]', 'z*', '*z']) {
    let nexts = 0; let returns = 0;
    const stdin = { [Symbol.asyncIterator]() { return { async next() { if (nexts++) throw new Error('poison next'); return { done: false, value: bytes('a,b\n') }; }, async return() { returns++; return { done: true }; } }; } };
    const result = await run(['select', '--', selection], '', { stdin });
    assert.equal(result.exitCode, 1); assert.equal(result.out, ''); assert.equal(nexts, 1); assert.equal(returns, 0);
  }
});

test('CSV command-specific CR, count quote splitting, BOM, EOF and chunk boundaries', async () => {
  const cases = [
    ['\ra,b\r\nx\ry,z\r\nu,v\r', 'a,b\n"x\ry",z\nu,"v\r"\n', 'a,b\n"x\ry",z\nu,v\n', '2\n'],
    ['\ufeffa,b\n1,2\n', 'a,b\n1,2\n', 'a,b\n1,2\n', '1\n'],
    ['\ufeff', '\n', '\n', '0\n'], ['', '\n', '\n', '0\n'],
    ['a,b\n1,"x\ny', 'a,b\n1,"x\ny"\n', 'a,b\n1,"x\ny"\n', '1\n'],
    ['""\r\n"a\nb"\r\n"q""r"\r\n', '""\n"a\nb"\n"q""r"\n', '""\n"a\nb"\n"q""r"\n', '2\n'],
    ['a,b\n"1","2"\n', 'a,b\n"1","2"\n', 'a,b\n1,2\n', '1\n'],
  ];
  for (const [input, select, slice, count] of cases) for (let chunkSize = 1; chunkSize <= Math.max(1, bytes(input).length); chunkSize++) {
    await good(['select', '*'], input, select, { chunkSize });
    await good(['slice'], input, slice, { chunkSize });
    await good(['count'], input, count, { chunkSize });
  }
  await good(['select', '-n', '1,0'], 'x,\ufeffz\n', '"\ufeffz",x\n', { chunkSize: 1 });
  await good(['select', '-d;', '-n', '1,0'], '"a;b";"x,y"\r\n"";""\r\n"q""r";"u\r\nv"\r\n', '"x,y",a;b\n,\n"u\r\nv","q""r"\n', { chunkSize: 1 });
  await good(['headers', '-j'], 'a"b,c\n', 'a"b\nc\n');
  await good(['count'], 'a,b\n1,x"y\n2,z\n', '1\n');
  for (const command of ['select', 'slice']) for (const input of ['a,b\n1,x"y\n2,z\n', 'a,b\n1,"x"z\n']) {
    const result = await run(command === 'select' ? [command, '*'] : [command], input, { chunkSize: 1 });
    assert.equal(result.exitCode, 1); assert.equal(result.out, 'a,b\n'); assert.equal(result.err, `xan ${command}: unsupported malformed CSV quoting\n`);
  }
});

test('byte ownership with reused producer buffer and mutation at finalization', async () => {
  const original = bytes('a,b\n"one","two"\nthree,four\n');
  for (const args of [['select', '1,0'], ['slice', '-L2'], ['headers', '-j'], ['count']]) {
    const expected = await run(args, original);
    const storage = Buffer.alloc(3);
    const stdin = { async *[Symbol.asyncIterator]() {
      try { for (let offset = 0; offset < original.length; offset += 3) { storage.fill(0); const length = Math.min(3, original.length - offset); storage.set(original.subarray(offset, offset + length)); yield storage.subarray(0, length); } }
      finally { storage.fill(88); }
    } };
    const actual = await run(args, '', { stdin });
    assert.deepEqual([actual.exitCode, actual.raw, actual.err], [expected.exitCode, expected.raw, expected.err]);
  }
});

test('binary invalid UTF-8 is confined to headers display, with byte-exact indexed cells', async () => {
  const input = Buffer.from([255, 44, 97, 10, 254, 44, 98, 10]);
  const result = await run(['select', '0'], input, { chunkSize: 1 });
  assert.equal(result.exitCode, 0); assert.deepEqual(result.raw, Buffer.from([255, 10, 254, 10]));
  await good(['select', 'a'], input, 'a\nb\n');
  assert.equal((await run(['headers'], input)).exitCode, 1);
  await good(['count'], input, '1\n');
  for (const prefix of [[239], [239, 187]]) {
    const result = await run(['select', '-n', '0'], Buffer.from(prefix), { chunkSize: 1 });
    assert.deepEqual(result.raw, Buffer.from([...prefix, 10]));
  }
});

test('headers presentation, multiple inputs duplicate tally and transposed CSV', async () => {
  await good(['headers'], 'alpha,beta\nignored,body\n', '0   alpha\n1   beta\n');
  await good(['h', '-js10000'], 'alpha,beta\n', 'alpha\nbeta\n');
  await good(['headers', '-s10000'], 'a,b\n', '10000a\n10001b\n');
  await good(['headers', '--color', 'never', '-s9'], '\ufeffname,"line\nfield",name," tab\t "\r\n1,2,3,4\r\n', '9   name\n10  line\\nfield\n11  name\n12  ·tab\\t·\n');
  await good(['headers', '-j'], '" x ","a\nb",a\u00adb,\u00a0z\u00a0\n', '·x·\na\\nb\nab\n··z··\n');
  const fs = new MemoryFileSystem();
  await fs.writeFile('/one.csv', bytes('a,a,b\n'));
  await fs.writeFile('/two.csv', bytes('a,b,c\n'));
  await good(['headers', '-j', '/one.csv', '/two.csv'], '', '/one.csv\na\na\nb\n\n/two.csv\na\nb\nc\n\nAll files don\'t have the same headers!\nDiverging headers: c\n', { fs });
  await good(['headers', '--csv', '/one.csv', '/two.csv'], '', '/one.csv,/two.csv\na,a\na,b\nb,c\n', { fs });
  await good(['headers', '--csv'], '', '<stdin>\n');
});

test('slice ordinary post-write zero ranges, indices, tail ring, and uniform L0', async () => {
  const input = 'a\n0\n1\n2\n3\n';
  for (const args of [['-l0'], ['-e0']]) await good(['slice', ...args], input, input);
  for (const args of [['-s1', '-l0'], ['-s1', '-e1']]) await good(['slice', ...args], input, 'a\n1\n2\n3\n');
  await good(['slice', '-I3,1,1,0'], input, 'a\n0\n1\n3\n');
  await good(['slice', '-L2'], input, 'a\n2\n3\n');
  await good(['slice', '--skip=2', '-l1'], input, 'a\n2\n');
  await good(['slice', '-s+00000000000000000000000000000000000002', '-l1'], input, 'a\n2\n');
  await good(['slice', '-s1', '--skip=3', '-l1'], input, 'a\n1\n');
  let acquired = 0;
  const stdin = { [Symbol.asyncIterator]() { acquired++; throw new Error('L0 must not acquire'); } };
  await good(['slice', '-nL0'], '', '', { stdin }); assert.equal(acquired, 0);
  const fs = new MemoryFileSystem(); await fs.writeFile('/input', bytes(input));
  for (const path of [[], ['/input']]) { await good(['slice', '-L0', ...path], input, 'a\n', { fs }); await good(['slice', '-nL0', ...path], input, '', { fs }); }
});

test('early output stops avoid poison chunks and do not return borrowed stdin', async () => {
  for (const args of [['headers', '-j'], ['slice', '-L0'], ['slice', '-l1'], ['slice', '-I0']]) {
    let nexts = 0; let returns = 0;
    const stdin = { [Symbol.asyncIterator]() { return { async next() { nexts++; if (nexts > 1) throw new Error('poison'); return { done: false, value: bytes(args[0] === 'headers' || args.includes('-L0') ? 'a,b\n"bad' : 'a,b\n1,2\n"bad') }; }, async return() { returns++; return { done: true }; } }; } };
    assert.equal((await run(args, '', { stdin })).exitCode, 0); assert.equal(nexts, 1); assert.equal(returns, 0);
  }
});

test('count is width-independent; selected/sliced ragged rows preserve earlier output', async () => {
  await good(['count'], 'a,b\n1\n2,3,4\n', '2\n');
  await good(['count', '-n'], 'a,b\n1\n2,3,4\n', '3\n');
  const result = await run(['select', '*'], 'a,b\n1\n');
  assert.equal(result.out, 'a,b\n'); assert.equal(result.exitCode, 1);
  assert.equal(result.err, 'xan select: CSV error: record 2 (byte: 4): found record with 1 fields, but the previous record has 2 fields\n');
});

test('all eighteen limit boundaries: pure ledgers and command refusal recipes', async () => {
  for (const name of Object.keys(defaultLimits)) {
    const budget = new Budget({ ...defaultLimits, [name]: 2 }, new AbortController().signal);
    budget.bound(name, 2); assert.throws(() => budget.bound(name, 3), new RegExp(name));
  }
  const recipes = [
    ['maxArgs', 1, ['count', '-n'], ''], ['maxArgumentBytes', 4, ['count'], ''],
    ['maxInputFiles', 1, ['headers', '/a', '/b'], ''], ['maxInputBytes', 3, ['count'], 'a\n0\n'],
    ['maxChunks', 1, ['count'], 'a\n'], ['maxChunkBytes', 1, ['count'], 'a\n'],
    ['maxRecordBytes', 2, ['count'], 'abc\n'], ['maxCellBytes', 2, ['count'], 'abc\n'],
    ['maxColumns', 1, ['count'], 'a,b\n'], ['maxRecords', 1, ['count'], 'a\nb\n'],
    ['maxSelectorBytes', 1, ['select', '0,0'], 'a\n'], ['maxSelectorNodes', 1, ['select', '0,0'], 'a\n'],
    ['maxSelectorDepth', 1, ['select', '0'], 'a\n'], ['maxSelectedColumns', 1, ['select', '0,0'], 'a\n'],
    ['maxLastRows', 1, ['slice', '-L2'], 'a\n'], ['maxWork', 2, ['count'], ''],
    ['maxOutputBytes', 1, ['count'], 'a\n'], ['maxRetainedBytes', 1, ['select', '*'], 'a\n'],
  ];
  for (const [name, value, args, input] of recipes) {
    const result = await run(args, input, { factory: { limits: { [name]: value } }, ...(name === 'maxChunks' ? { chunkSize: 1 } : {}) });
    assert.equal(result.exitCode, 1, name); assert.equal(result.out, '', name);
    if (result.err) assert.match(result.err, new RegExp(name));
  }
  const budget = new Budget({ ...defaultLimits, maxRetainedBytes: 5 }, new AbortController().signal);
  const store = new Bytes(budget); await store.push(1); await store.push(2);
  assert.equal(budget.retained, 2); await assert.rejects(store.push(3), /maxRetainedBytes/u); store.free(); assert.equal(budget.retained, 0);
  const fs = new MemoryFileSystem(); await fs.writeFile('/a', bytes('a\n')); await fs.writeFile('/b', bytes('b\n'));
  const cumulative = await run(['headers', '/a', '/b'], '', { fs, factory: { limits: { maxRecords: 1 } } });
  assert.equal(cumulative.exitCode, 1); assert.match(cumulative.err, /maxRecords/u);
  let deliveries = 0;
  const emptyChunks = { async *[Symbol.asyncIterator]() { deliveries++; yield new Uint8Array(0); deliveries++; yield new Uint8Array(0); } };
  assert.equal((await run(['count'], '', { stdin: emptyChunks, factory: { limits: { maxChunks: 1 } } })).exitCode, 1); assert.equal(deliveries, 2);
  const readAhead = await run(['headers', '-j'], 'a\n' + 'x'.repeat(100), { factory: { limits: { maxInputBytes: 2 } } }); assert.equal(readAhead.exitCode, 1);
  await good(['count'], 'a\nb\n', '1\n', { factory: { limits: { maxInputBytes: 4, maxRecordBytes: 1, maxCellBytes: 1, maxColumns: 1, maxRecords: 2, maxChunks: 1, maxChunkBytes: 4, maxOutputBytes: 2 } } });
});

test('diagnostic is all-or-nothing and shares stdout budget', async () => {
  const result = await run(['select', '*'], 'a,b\n1\n', { factory: { limits: { maxOutputBytes: 4 } } });
  assert.equal(result.exitCode, 1); assert.equal(result.out, 'a,b\n'); assert.equal(result.err, '');
  const message = 'xan count: maxRecords limit exceeded\n';
  const fits = await run(['count'], 'a\nb\n', { factory: { limits: { maxRecords: 1, maxOutputBytes: bytes(message).length } } });
  assert.equal(fits.err, message);
  const short = await run(['count'], 'a\nb\n', { factory: { limits: { maxRecords: 1, maxOutputBytes: bytes(message).length - 1 } } });
  assert.equal(short.err, '');
});

test('caller cancellation exact primitives/errors and sink failures escape unchanged', async () => {
  for (const reason of [0, undefined, new Error('caller')]) {
    const controller = new AbortController(); controller.abort(reason);
    await assert.rejects(run(['count'], '', { signal: controller.signal }), error => error === controller.signal.reason);
  }
  for (const reason of [0, undefined, new Error('sink'), new FsError('EIO')]) {
    await assert.rejects(run(['select', '*'], ordinary, { stdout: { async write() { throw reason; } } }), error => error === reason);
  }
  for (const reason of [0, undefined, new LimitError('maxOutputBytes'), new Error('stderr sink')]) {
    await assert.rejects(run(['select', 'missing'], ordinary, { stderr: { async write() { throw reason; } } }), error => error === reason);
  }
  const controller = new AbortController(); const reason = { caller: true };
  await assert.rejects(run(['select', '*'], ordinary, { signal: controller.signal, stdout: { async write() { controller.abort(reason); throw new Error('secondary'); } } }), error => error === reason);
});

test('backpressure, already closed stdout, independent file destination and stderr', async () => {
  let writes = 0; let concurrent = 0;
  const stdout = { async write() { concurrent++; assert.equal(concurrent, 1); await new Promise(resolve => setTimeout(resolve, 1)); writes++; concurrent--; } };
  assert.equal((await run(['select', '*'], ordinary, { stdout })).exitCode, 0); assert.equal(writes, 3);
  const closed = new AbortController(); const reason = new Error('consumer closed'); closed.abort(reason);
  let acquired = 0;
  const sink = { async write() { throw new Error('wrong destination'); }, ownedOutput: { consumerClosed: closed.signal, async write() { throw new Error('must not write'); } } };
  await assert.rejects(run(['headers'], '', { stdout: sink, stdin: { [Symbol.asyncIterator]() { acquired++; throw new Error('must not acquire'); } } }), error => error === reason);
  assert.equal(acquired, 0);
  const fs = new MemoryFileSystem(); await good(['select', '-o', '/new', '*'], ordinary, '', { stdout: sink, fs });
  assert.equal(decoder.decode(await fs.readFile('/new')), ordinary);
});

test('output alias guards, actual exclusive creation, dangling links, partial file and fallback', async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile('/input', bytes(ordinary)); await fs.writeFile('/existing', bytes('old'));
  for (const args of [['select', '*', '/input', '-o', '/input'], ['select', '*', '-o', '/existing']]) {
    const result = await run(args, ordinary, { fs }); assert.equal(result.exitCode, 1);
  }
  await fs.link('/input', '/alias'); assert.equal((await run(['select', '*', '/input', '-o', '/alias'], '', { fs })).exitCode, 1);
  await fs.symlink('/absent', '/dangling'); assert.equal((await run(['select', '*', '/input', '-o', '/dangling'], '', { fs })).exitCode, 1);
  await good(['select', '1', '/input', '-o', '/existing'], '', '', { fs }); assert.equal(decoder.decode(await fs.readFile('/existing')), 'b\n2\n4\n');
  await fs.writeFile('/bad', bytes('a,b\n1\n'));
  const partial = await run(['select', '*', '/bad', '-o', '/partial'], '', { fs }); assert.equal(partial.exitCode, 1); assert.equal(decoder.decode(await fs.readFile('/partial')), 'a,b\n');
  const unknown = Object.create(fs);
  for (const name of ['lstat', 'stat']) unknown[name] = async (...args) => { const { identityScope, ino, dev, ...stat } = await fs[name](...args); return stat; };
  unknown.compareEntry = async () => 'unknown'; unknown.readStream = fs.readStream.bind(fs); unknown.writeStream = fs.writeStream.bind(fs);
  assert.equal((await run(['select', '*', '/input', '-o', '/existing'], '', { fs: unknown })).exitCode, 1);
  const fallback = Object.create(fs); fallback.writeStream = undefined; fallback.readStream = fs.readStream.bind(fs); fallback.lstat = fs.lstat.bind(fs); fallback.stat = fs.stat.bind(fs);
  const calls = [];
  fallback.writeFile = async (path, payload, options) => { calls.push({ path, options, payload: new Uint8Array(payload) }); return fs.writeFile(path, payload, options); };
  await good(['select', '*', '-o', '/fallback'], ordinary, '', { fs: fallback });
  assert.equal(calls.length, 1); assert.equal(calls[0].options.flag, 'wx'); assert.equal(Object.hasOwn(calls[0].options, 'mode'), false); assert.equal(decoder.decode(await fs.readFile('/fallback')), ordinary);
  await good(['slice', '-nL0', '-o', '/empty'], '', '', { fs: fallback }); assert.equal((await fs.readFile('/empty')).length, 0);
  const raced = Object.create(fs); raced.lstat = fs.lstat.bind(fs); raced.writeStream = async (path, input, options) => { await fs.writeFile(path, bytes('winner')); return fs.writeStream(path, input, options); };
  assert.equal((await run(['select', '*', '-o', '/race'], ordinary, { fs: raced })).exitCode, 1); assert.equal(decoder.decode(await fs.readFile('/race')), 'winner');
});

test('missing readStream refuses, owned early cleanup registers before acquisition and is idempotent', async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile('/input', bytes(ordinary));
  const missing = Object.create(fs); missing.readStream = undefined;
  assert.equal((await run(['count', '/input'], '', { fs: missing })).exitCode, 1);
  let registered = false; let released = 0;
  const owned = Object.create(fs);
  owned.readStream = () => { assert.equal(registered, true); return { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: bytes('a,b\n') }; }, async return() { await new Promise(resolve => setTimeout(resolve, 1)); released++; return { done: true }; } }; } }; };
  await good(['headers', '-j', '/input'], '', 'a\nb\n', { fs: owned, registerCleanup() { registered = true; } }); assert.equal(released, 1);
});

test('actual baseline Shell registry pipeline and parent output budget', async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile('/input', bytes(ordinary));
  const shell = new Shell({ fs, commands: new CommandRegistry(createXanCommands()) });
  const result = await shell.exec('xan select 1 /input | xan count'); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, '2\n');
  await assert.rejects(shell.exec('xan select 0 /input', { limits: { maxOutputBytes: 1 } }), { name: 'ShellLimitError', limit: 'maxOutputBytes' });
  await shell.dispose();
});

test('registered owned cooperative return drains on abort without waiting opaque next', async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const reason = { abort: true };
  let started;
  const acquired = new Promise(resolve => { started = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let returned = 0;
  let settled = false;
  let rejectNext;
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise((resolve, reject) => { rejectNext = reject; }); },
    async return() { returned++; await gate; return { done: true }; },
  }; } });
  const pending = run(['headers', '/input'], '', { fs, signal: controller.signal });
  const checked = assert.rejects(pending, error => error === reason).then(() => { settled = true; });
  await acquired; controller.abort(reason);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, 1); assert.equal(settled, false);
  release(); await checked;
  rejectNext(new Error('observed late opaque next failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('cleanup failure beats ordinary status but never original sink/caller rejection', async () => {
  for (const mode of ['success', 'ordinary', 'sink', 'caller']) {
    const fs = new MemoryFileSystem();
    const cleanup = new Error('cleanup'); const sink = new Error('sink'); const caller = new Error('caller');
    const controller = new AbortController();
    let returns = 0;
    fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
      async next() { return { done: false, value: bytes('a,b\n') }; },
      async return() { returns++; throw cleanup; },
    }; } });
    const args = mode === 'ordinary' ? ['select', 'missing', '/input'] : ['slice', '-L0', '/input'];
    const options = { fs, signal: controller.signal,
      ...(mode === 'sink' || mode === 'caller' ? { stdout: { async write() { if (mode === 'caller') controller.abort(caller); throw sink; } } } : {}),
    };
    await assert.rejects(run(args, '', options), error => error === (mode === 'caller' ? caller : mode === 'sink' ? sink : cleanup));
    assert.equal(returns, 1);
  }
});

test('cooperative work yields, aborts before full scan and preserves exact reason', async () => {
  const controller = new AbortController(); const reason = { work: 'abort' };
  const pending = run(['count'], 'a\n' + 'x'.repeat(200000), { signal: controller.signal });
  setImmediate(() => controller.abort(reason));
  await assert.rejects(pending, error => error === reason);
});

test('whole-result fallback checks simultaneous staging before publication', async () => {
  const fs = new MemoryFileSystem();
  const fallback = Object.create(fs); fallback.writeStream = undefined; fallback.lstat = fs.lstat.bind(fs);
  let publications = 0;
  fallback.writeFile = async (...args) => { publications++; return fs.writeFile(...args); };
  const input = 'a\n' + 'x\n'.repeat(50);
  const streamed = await run(['select', '*', '-o', '/stream'], input, { fs, factory: { limits: { maxRetainedBytes: 650 } } });
  assert.equal(streamed.exitCode, 0, streamed.err);
  const result = await run(['select', '*', '-o', '/fallback-limit'], input, { fs: fallback, factory: { limits: { maxRetainedBytes: 650 } } });
  assert.equal(result.exitCode, 1); assert.equal(publications, 0);
  await assert.rejects(fs.stat('/fallback-limit'), error => error.code === 'ENOENT');
  const { publish, outputOperation } = await load('commands/xan/io.js');
  const context = { signal: new AbortController().signal, fs: fallback, stdout: { async write() {} } };
  const budget = new Budget({ ...defaultLimits, maxRetainedBytes: 300 }, context.signal);
  const operation = outputOperation(context, true);
  const chunks = { async *[Symbol.asyncIterator]() { yield new Uint8Array(100); yield new Uint8Array(100); } };
  await assert.rejects(publish(context, { path: '/staging', flag: 'wx' }, chunks, operation, budget), /maxRetainedBytes/u);
  assert.equal(publications, 0); await operation.close();
  assert.equal(budget.retained, 0);
  const exactBudget = new Budget({ ...defaultLimits, maxRetainedBytes: 464 }, context.signal);
  const exactOperation = outputOperation(context, true);
  await publish(context, { path: '/staging-exact', flag: 'wx' }, chunks, exactOperation, exactBudget);
  assert.equal(publications, 1); assert.equal(exactBudget.retained, 0); await exactOperation.close();
});

test('opaque metadata and file sink promises are observed, not cleanup barriers', async () => {
  for (const phase of ['metadata', 'write']) {
    const fs = new MemoryFileSystem();
    const controller = new AbortController(); const reason = new Error(`abort ${phase}`);
    let acquired;
    const started = new Promise(resolve => { acquired = resolve; });
    let rejectLate;
    const opaque = () => { acquired(); return new Promise((resolve, reject) => { rejectLate = reject; }); };
    if (phase === 'metadata') fs.lstat = opaque;
    else fs.writeStream = opaque;
    const pending = run(['select', '*', '-o', '/new'], ordinary, { fs, signal: controller.signal });
    const checked = assert.rejects(pending, error => error === reason);
    await started; controller.abort(reason); await checked;
    rejectLate(new Error('late host failure'));
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('delimiter inference, independent output inference, literal leading-dash paths and help', async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile('/in.tsv', bytes('a\tb\n1\t2\n'));
  await good(['select', '1,0', '/in.tsv', '-o', '/out.psv'], '', '', { fs }); assert.equal(decoder.decode(await fs.readFile('/out.psv')), 'b|a\n2|1\n');
  await fs.writeFile('/-file', bytes('x;y\n1;2\n'));
  await good(['select', '-d;', '--', '1,0', '-file'], '', 'y,x\n2,1\n', { fs });
  const overflow = await run(['slice', '--start', '18446744073709551616'], '');
  assert.equal(overflow.err, "Could not deserialize '18446744073709551616' to u64 for '--start'.\n");
  assert.equal((await run(['headers', '-n'], 'a\n')).err, "Usage:\n    xan headers [options] [<input>...]\n    xan h [options] [<input>...]\n\nUnknown flag: '-n' Use the -h/--help flag for more information.\n");
  assert.equal((await run(['select'], 'a\n')).err, "Usage:\n    xan select [options] [--] <selection> [<input>]\n    xan select --help\n\nInvalid subcommand or arguments! Use the -h/--help flag for more information.\n");
  assert.equal((await run(['headers'], Buffer.from([255, 44, 98, 10, 49, 44, 50, 10]))).err, 'xan headers: CSV parse error: record 0 (line 1, field: 0, byte: 0): invalid utf-8: invalid UTF-8 in field 0 near byte index 0\n');
  for (const args of [['--help'], ['headers', '-h'], ['count', '-h'], ['select', '-h'], ['slice', '-h']]) {
    const result = await run(args, '', { stdin: { [Symbol.asyncIterator]() { throw new Error('help acquired input'); } } });
    assert.equal(result.exitCode, 0); assert.match(result.out, /unsupported/u);
  }
});
