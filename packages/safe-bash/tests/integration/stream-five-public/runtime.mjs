import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import * as root from 'virtual-bash';
import * as format from 'virtual-bash/commands/stream-format';
import * as split from 'virtual-bash/commands/split';
import * as inspection from 'virtual-bash/commands/stream-inspection';

const { Shell, MemoryFileSystem, RealFileSystem, CommandRegistry, agentCommands, createAgentCommands, createBytePipe, collectBytes, ShellLimitError, FsError } = root;
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL('./baseline60.json', import.meta.url)));
const results = [];
const evidence = { node: process.version, environment: process.env, imports: {}, results };
const bytes = hex => Buffer.from(hex, 'hex');
const hex = value => Buffer.from(value).toString('hex');
const deferred = () => Promise.withResolvers();
async function bounded(promise, milliseconds = 15000) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('HARNESS_DEADLINE')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function check(name, action) {
  const started = Date.now();
  try { const details = await bounded(action()); results.push({ name, status: 'pass', milliseconds: Date.now() - started, details }); }
  catch (error) { results.push({ name, status: 'fail', milliseconds: Date.now() - started, error: { name: error.name, message: error.message, actual: error.actual, expected: error.expected, stack: error.stack } }); }
  writeFileSync('runtime-results.json', JSON.stringify(evidence, null, 2) + '\n');
}
function shellFor(fs = new MemoryFileSystem(), options = {}, families = {}) {
  return new Shell({ fs, env: { LC_ALL: 'C', LANG: 'C' }, limits: { pipeHighWaterMark: 1 }, ...options }).use(agentCommands(families));
}
function success(result, expected = '') {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(hex(result.stderrBytes), '');
  assert.equal(hex(result.stdoutBytes), expected);
}
async function files(fs) {
  const entries = (await fs.readdir('/parts')).sort((left, right) => left.name.localeCompare(right.name));
  const result = {};
  for (const entry of entries) {
    assert.equal(entry.type, 'file');
    result[entry.name] = hex(await fs.readFile(`/parts/${entry.name}`));
  }
  return result;
}
async function fixture(row, adapter) {
  let fs;
  if (adapter === 'real') {
    const host = join(process.cwd(), 'real-roots', row.id);
    mkdirSync(host, { recursive: true });
    fs = new RealFileSystem(host);
  } else fs = new MemoryFileSystem();
  await fs.mkdir('/parts');
  if (row.inputFile) await fs.writeFile('/input.bin', bytes(row.inputFile));
  const shell = shellFor(fs);
  if (row.producer) shell.register({ name: 'producer', async execute(context) {
    const input = bytes(row.producer);
    const allocation = new Uint8Array(3);
    for (let offset = 0, index = 0; offset < input.length; index++) {
      const length = Math.min([1, 3, 2, 1][index % 4], input.length - offset);
      allocation.set(input.subarray(offset, offset + length));
      await context.stdout.write(allocation.subarray(0, length));
      allocation.fill(238);
      offset += length;
    }
    return { exitCode: 0 };
  } });
  if (row.inputFile) shell.use(async (context, next) => {
    assert.equal(context.stdinIsDefault, true);
    context.stdin = { [Symbol.asyncIterator]() { throw new Error('F08_UNEXPECTED_STDIN_ACQUISITION'); } };
    return next();
  });
  const result = await shell.exec(row.command, { ...(row.input !== undefined ? { stdin: bytes(row.input) } : {}), ...(row.env ? { env: row.env } : {}) });
  success(result, row.stdout);
  assert.deepEqual(await files(fs), row.files ?? {});
  if (row.inputFile) assert.equal(hex(await fs.readFile('/input.bin')), row.inputFile);
  if (row.id === 'F10') {
    success(await shell.exec('cat /parts/liveaa /parts/liveab > /result.bin'));
    assert.equal(hex(await fs.readFile('/result.bin')), '313a0900ff410a323a422020430a');
  }
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['parts', ...(row.inputFile ? ['input.bin'] : []), ...(row.id === 'F10' ? ['result.bin'] : [])].sort());
  await shell.dispose();
  return { adapter, stdout: hex(result.stdoutBytes), files: row.files ?? {} };
}

await check('C01 packed APIs and actual unique65 factory/registry', async () => {
  for (const name of ['createStreamFormatCommands', 'streamFormatCommands']) assert.equal(root[name], format[name]);
  for (const name of ['createSplitCommands', 'splitCommands']) assert.equal(root[name], split[name]);
  assert.equal(root.streamInspectionCommands, inspection.streamInspectionCommands);
  for (const name of ['createNetworkCommands', 'networkCommands', 'safeJsCommands', 'createSafeJsCommands']) assert.equal(typeof root[name], 'function');
  const expected = [...baseline.defaultNames, 'seq', 'nl', 'rev', 'unexpand', 'split'].sort();
  const names = createAgentCommands().map(command => command.name).sort();
  assert.equal(names.length, 65);
  assert.equal(new Set(names).size, 65);
  assert.deepEqual(names, expected);
  const shell = shellFor();
  success(await shell.exec(''));
  assert.deepEqual(shell.commands.list().map(command => command.name).sort(), names);
  for (const name of ['curl', 'safejs', 'safe-js']) assert.equal(shell.commands.has(name), false);
  for (const specifier of ['virtual-bash', 'virtual-bash/commands/stream-format', 'virtual-bash/commands/split', 'virtual-bash/commands/stream-inspection']) evidence.imports[specifier] = import.meta.resolve(specifier);
  evidence.defaultNames = names;
  evidence.defaultCount = names.length;
  await shell.dispose();
});
for (const row of fixtures) await check(`${row.id} memory`, () => fixture(row, 'memory'));
for (const id of ['F07', 'F10']) await check(`${id} real`, () => fixture(fixtures.find(row => row.id === id), 'real'));

await check('C03 BytePipe ownership backpressure and abort identity', async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  const allocation = bytes('00ff41');
  await pipe.writable.write(allocation);
  allocation.fill(238);
  let complete = false;
  const second = pipe.writable.write(bytes('42')).then(() => { complete = true; });
  await turn();
  assert.equal(complete, false);
  const collected = collectBytes(pipe.readable, { maxBytes: 4 });
  await second;
  await pipe.close();
  assert.equal(hex(await collected), '00ff4142');
  const blocked = createBytePipe({ highWaterMark: 1 });
  await blocked.writable.write(bytes('00ff41'));
  const reason = new Error('unique-bytepipe-abort');
  const rejected = assert.rejects(blocked.writable.write(bytes('42')), error => error === reason);
  await blocked.abort(reason);
  await rejected;
});
await check('C04 live sink bounded ownership/backpressure 65536 records', async () => {
  const shell = shellFor();
  const entered = deferred();
  const gate = deferred();
  let produced = 0;
  let finished = false;
  let active = 0;
  let maximum = 0;
  const retained = [];
  shell.register({ name: 'producer', async execute(context) {
    const allocation = bytes('00ff410a');
    for (; produced < 65536; produced++) {
      allocation.set(bytes('00ff410a'));
      await context.stdout.write(allocation);
      allocation.fill(238);
    }
    finished = true;
    return { exitCode: 0 };
  } });
  const pending = shell.exec('producer | rev', { stdout: { async write(chunk) {
    active++;
    maximum = Math.max(maximum, active);
    const before = hex(chunk);
    retained.push({ chunk, before });
    entered.resolve();
    await gate.promise;
    await turn();
    assert.equal(hex(chunk), before);
    active--;
  } } });
  pending.catch(() => {});
  try {
    await bounded(entered.promise);
    await turn();
    assert.equal(finished, false);
    assert.ok(produced < 65536);
  } finally { gate.resolve(); }
  const result = await pending;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(maximum, 1);
  for (const item of retained) assert.equal(hex(item.chunk), item.before);
  assert.equal(hex(Buffer.concat(retained.map(item => item.chunk))), '41ff000a'.repeat(65536));
  await shell.dispose();
  return { produced, maximum, chunks: retained.length };
});
for (const errno of [false, true]) await check(`C05 sink cancellation ${errno ? 'FsError ENOENT' : 'Error'}`, async () => {
  const shell = shellFor();
  const controller = new AbortController();
  const entered = deferred();
  const gate = deferred();
  const reason = errno ? new FsError('ENOENT', { path: '/abort-marker' }) : new Error('unique-sink-abort');
  const pending = shell.exec('rev | unexpand -a -t4', { stdin: bytes('410a'), signal: controller.signal, stdout: { async write() { entered.resolve(); await gate.promise; } } });
  const rejected = assert.rejects(pending, error => error === reason);
  try { await bounded(entered.promise); controller.abort(reason); await bounded(rejected); }
  finally { gate.resolve(); await pending.catch(() => {}); await shell.dispose(); }
});
function intercepted(fs, onPublication, received) {
  return new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof value !== 'function') return value;
    return (...args) => {
      const options = args.find(argument => argument && typeof argument === 'object' && argument.signal instanceof AbortSignal);
      if (options) received.push({ method: property, path: args[0], signal: options.signal });
      if (['writeStream', 'writeFile', 'appendFile'].includes(property) && args[0] === '/parts/pab') return onPublication(options);
      return value.apply(target, args);
    };
  } });
}
await check('C05 split cancellation before second publication', async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir('/parts');
  const entered = deferred();
  const controller = new AbortController();
  const received = [];
  const reason = new FsError('ENOENT', { path: '/split-abort' });
  const fs = intercepted(backing, async options => {
    assert.equal(hex(await backing.readFile('/parts/paa')), '00ff41');
    assert.ok(options?.signal instanceof AbortSignal);
    entered.resolve();
    options.signal.throwIfAborted();
    await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  }, received);
  const shell = shellFor(fs);
  const pending = shell.exec('split -b3 - /parts/p', { stdin: bytes('00ff410a4243'), signal: controller.signal });
  const rejected = assert.rejects(pending, error => error === reason);
  await bounded(entered.promise);
  controller.abort(reason);
  await rejected;
  assert.deepEqual(await files(backing), { paa: '00ff41' });
  assert.ok(received.length > 0);
  assert.ok(received.every(entry => entry.signal.aborted));
  await shell.dispose();
  return received.map(({ method, path, signal }) => ({ method, path, aborted: signal.aborted }));
});
for (const [name, command, input, limit, high, low, expected] of [
  ['rev', 'rev', '41420a', 'maxInputBytes', 3, 2, '42410a'],
  ['seq', 'seq 1 2', '', 'maxOutputBytes', 4, 3, '310a320a'],
]) await check(`C06 ${name} family ${limit} boundary`, async () => {
  let published = [];
  const run = async value => {
    published = [];
    const shell = shellFor(undefined, {}, { streamFormat: { limits: { [limit]: value, maxChunkBytes: 3 } } });
    shell.use(async (context, next) => {
      const target = context.stdout;
      context.stdout = { async write(chunk) { await target.write(chunk); published.push(Buffer.from(chunk)); } };
      return next();
    });
    try { return await shell.exec(command, { stdin: bytes(input) }); } finally { await shell.dispose(); }
  };
  success(await run(high), expected);
  const result = await run(low);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, new RegExp(`^${name}:.*(?:limit|exceed)`, 'iu'));
  assert.match(result.stderr, new RegExp(`${limit === 'maxInputBytes' ? 'input' : 'output'} limit`, 'iu'));
  assert.equal(hex(result.stdoutBytes), hex(Buffer.concat(published)));
  assert.ok(expected.startsWith(hex(result.stdoutBytes)));
  assert.ok(result.stdoutBytes.length <= low);
  return { stderr: result.stderr, published: hex(result.stdoutBytes) };
});
await check('C06 split maxFiles and independent family reset', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/parts');
  const shell = shellFor(fs, {}, { split: { limits: { maxFiles: 1 } }, streamFormat: { limits: { maxOutputBytes: 4 } } });
  const result = await shell.exec('split -b3 - /parts/p', { stdin: bytes('00ff410a4243') });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^split:.*(?:file|Files).*(?:limit|exceed)|^split:.*(?:limit|exceed).*(?:file|Files)/iu);
  assert.deepEqual(await files(fs), { paa: '00ff41' });
  success(await shell.exec('seq 1 2; seq 1 2'), '310a320a310a320a');
  await shell.dispose();
  return { stderr: result.stderr, files: await files(fs) };
});
await check('C06 shared Shell maxOutputBytes rejects', async () => {
  const shell = shellFor();
  success(await shell.exec('seq 1 2', { limits: { maxOutputBytes: 4 } }), '310a320a');
  await assert.rejects(shell.exec('seq 1 2', { limits: { maxOutputBytes: 3 } }), error => error instanceof ShellLimitError && error.limit === 'maxOutputBytes');
  await assert.rejects(shell.exec('seq 1 2; seq 1 2', { limits: { maxOutputBytes: 7 } }), error => error instanceof ShellLimitError && error.limit === 'maxOutputBytes');
  await shell.dispose();
});
await check('C07 literal context.invoke middleware shared budget', async () => {
  const seen = [];
  const shell = shellFor();
  shell.use(async (context, next) => { seen.push({ command: context.command, args: context.args }); return next(); });
  shell.register({ name: 'wrapper', async execute(context) {
    assert.equal(typeof context.invoke, 'function');
    return context.invoke('seq', ['-s', '|', '0.1', '0.2', '0.5']);
  } });
  success(await shell.exec('wrapper', { limits: { maxCommands: 2 } }), '302e317c302e337c302e350a');
  assert.deepEqual(seen.map(entry => entry.command), ['wrapper', 'seq']);
  assert.deepEqual(seen[1].args, ['-s', '|', '0.1', '0.2', '0.5']);
  await assert.rejects(shell.exec('wrapper', { limits: { maxCommands: 1 } }), error => error instanceof ShellLimitError && error.limit === 'maxCommands');
  await shell.dispose();
});
for (const [name, plugin, count] of [['rev', format.streamFormatCommands, 4], ['split', split.splitCommands, 1], ['rev', agentCommands, 65]]) await check(`C07 ${count}-command plugin collision and replacement`, async () => {
  const sentinel = { name, execute: () => ({ exitCode: 23 }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([sentinel]) }).use(plugin());
  await assert.rejects(shell.exec(''), /already registered/u);
  assert.deepEqual(shell.commands.list().map(entry => entry.name), [name]);
  assert.equal(shell.commands.get(name).execute, sentinel.execute);
  await shell.dispose();
  const replaced = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([sentinel]) }).use(plugin({ replace: true }));
  success(await replaced.exec(''));
  assert.equal(replaced.commands.list().length, count);
  assert.equal(new Set(replaced.commands.list().map(entry => entry.name)).size, count);
  assert.notEqual(replaced.commands.get(name).execute, sentinel.execute);
  await replaced.dispose();
});
await check('C08 ENOSPC preserves completed segment and error path', async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir('/parts');
  const received = [];
  const fs = intercepted(backing, async () => {
    assert.equal(hex(await backing.readFile('/parts/paa')), '00ff41');
    throw new FsError('ENOSPC', { path: '/parts/pab', syscall: 'write' });
  }, received);
  const shell = shellFor(fs);
  const result = await shell.exec('split -b3 - /parts/p', { stdin: bytes('00ff410a4243fe0d0a5a') });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^split: /u);
  assert.match(result.stderr, /no space left on device/iu);
  assert.match(result.stderr, /\/parts\/pab/u);
  assert.deepEqual(await files(backing), { paa: '00ff41' });
  await shell.dispose();
  return { stderr: result.stderr, files: await files(backing) };
});
evidence.passed = results.filter(result => result.status === 'pass').length;
evidence.failed = results.length - evidence.passed;
writeFileSync('runtime-results.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ passed: evidence.passed, failed: evidence.failed, failures: results.filter(result => result.status === 'fail') }, null, 2));
process.exitCode = evidence.failed ? 1 : 0;
