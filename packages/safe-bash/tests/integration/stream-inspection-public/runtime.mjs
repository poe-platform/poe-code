import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection, createServer } from 'node:net';
import * as root from 'virtual-bash';
import * as subpath from 'virtual-bash/commands/stream-inspection';
import * as network from 'virtual-bash/commands/network';

const { Shell, MemoryFileSystem, createAgentCommands, agentCommands, createBytePipe, collectBytes, pipeBytes, toByteSource, ShellLimitError, CommandRegistry } = root;
const frozen = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
const results = [];
const evidence = { node: process.version, execPath: process.execPath, cwd: process.cwd(), imports: {}, results };
const deadline = async (promise, milliseconds = 8000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('HARNESS_DEADLINE')), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
async function check(name, action) {
  const started = Date.now();
  try { await deadline(action()); results.push({ name, status: 'pass', milliseconds: Date.now() - started }); }
  catch (error) { results.push({ name, status: 'fail', milliseconds: Date.now() - started, nameOfError: error.name, message: error.message, stack: error.stack }); }
  writeFileSync('runtime-results.json', JSON.stringify(evidence, null, 2) + '\n');
}
function shellFor(fs = new MemoryFileSystem(), options = {}) {
  return new Shell({ fs, env: { LC_ALL: 'C' }, limits: { pipeHighWaterMark: 8 }, ...options }).use(agentCommands());
}
async function* reused(bytes) {
  const buffer = new Uint8Array(65537);
  let offset = 0;
  for (let index = 0; offset < bytes.length; index++) {
    const size = Math.min([1, 7, 2, 65537][index % 4], bytes.length - offset);
    buffer.set(bytes.subarray(offset, offset + size));
    yield buffer.subarray(0, size);
    buffer.fill(238);
    offset += size;
  }
}
function dataFor(test) {
  const input = Uint8Array.from(test.input ?? Array.from({ length: test.repeat }, () => test.unit).flat());
  const expected = test.expected ?? Array.from({ length: Math.ceil(input.length / test.width) }, (_, index) => [
    ...(index > 0 ? [10] : []), ...input.subarray(index * test.width, (index + 1) * test.width),
  ]).flat();
  return { input, expected: Uint8Array.from(expected) };
}

await check('offline effective TCP listen/connect denial', async () => {
  const listening = await new Promise(resolve => {
    const server = createServer();
    server.once('error', error => resolve(error.code));
    server.listen(0, '127.0.0.1', () => server.close(() => resolve('UNEXPECTED_LISTEN')));
  });
  assert.equal(listening, 'EPERM');
  const connecting = await new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 9 });
    socket.once('error', error => resolve(error.code));
    socket.once('connect', () => { socket.destroy(); resolve('UNEXPECTED_CONNECT'); });
  });
  assert.equal(connecting, 'EPERM');
  evidence.network = { listening, connecting };
});
await check('root/subpath exports and explicit optional availability', async () => {
  for (const name of ['streamInspectionCommands', 'createStreamInspectionCommands']) {
    assert.equal(typeof root[name], 'function');
    assert.equal(root[name], subpath[name]);
  }
  for (const name of ['safeJsCommands', 'createSafeJsCommands', 'networkCommands', 'createNetworkCommands']) assert.equal(typeof root[name], 'function', name);
  assert.equal(network.networkCommands, root.networkCommands);
  for (const name of ['virtual-bash', 'virtual-bash/commands/stream-inspection', 'virtual-bash/commands/network']) evidence.imports[name] = import.meta.resolve(name);
});
await check('default registry measured unique60 optional absent', async () => {
  const names = createAgentCommands().map(command => command.name).sort();
  evidence.defaultNames = names;
  evidence.defaultCount = names.length;
  assert.equal(names.length, 60);
  assert.equal(new Set(names).size, 60);
  for (const name of ['tac', 'expand', 'fold', 'strings']) assert.equal(names.filter(value => value === name).length, 1);
  for (const name of ['curl', 'safejs', 'safe-js']) assert.equal(names.includes(name), false);
  const shell = shellFor();
  await shell.exec('');
  assert.deepEqual(shell.commands.list().map(command => command.name).sort(), names);
  for (const name of ['curl', 'safejs']) assert.equal((await shell.exec(name)).exitCode, 127);
});

for (const test of frozen.cases) await check(test.id, async () => {
  const { input, expected } = dataFor(test);
  const fs = new MemoryFileSystem();
  const shell = shellFor(fs);
  if (test.id === 'vfs-redirection-readback') await fs.writeFile('/input.bin', input);
  if (test.id === 'binary-producer-consumer') {
    shell.register({ name: 'producer', async execute(context) { await pipeBytes(reused(input), context.stdout, context.signal); return { exitCode: 0 }; } });
    shell.register({ name: 'consumer', async execute(context) { await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 }; } });
  }
  const result = await shell.exec(test.script, { stdin: reused(input) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stderrBytes, new Uint8Array());
  assert.deepEqual(result.stdoutBytes, expected);
  if (test.id === 'vfs-redirection-readback') {
    assert.deepEqual(await fs.readFile('/output.bin'), input);
    assert.deepEqual(await fs.readFile('/result.txt'), expected);
  }
});
await check('explicit RealFS root binary redirection readback', async () => {
  const directory = join(process.cwd(), 'real-vfs-root');
  mkdirSync(directory);
  const fs = new root.RealFileSystem({ root: directory });
  const test = frozen.cases.find(item => item.id === 'vfs-redirection-readback');
  const { input, expected } = dataFor(test);
  await fs.writeFile('/input.bin', input);
  const result = await shellFor(fs).exec(test.script);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, expected);
  assert.deepEqual(await fs.readFile('/output.bin'), input);
  assert.deepEqual(readFileSync(join(directory, 'result.txt')), Buffer.from(expected));
});
await check('public plugin collision preflight and replacement', async () => {
  for (const factory of [root.streamInspectionCommands, subpath.streamInspectionCommands]) {
    const original = { name: 'fold', execute: () => ({ exitCode: 23 }) };
    const registry = new CommandRegistry([original]);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: registry }).use(factory());
    await assert.rejects(shell.exec(''), /already registered/u);
    assert.deepEqual(registry.list().map(command => command.name), ['fold']);
    const replacement = new Shell({ fs: new MemoryFileSystem(), commands: registry }).use(factory({ replace: true }));
    assert.equal((await replacement.exec('fold', { stdin: 'AB' })).stdout, 'AB');
    assert.equal(registry.list().length, 4);
  }
});
await check('BytePipe awaited writes own reused buffer and backpressure', async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  const bytes = Uint8Array.from([255, 0, 65]);
  await pipe.writable.write(bytes);
  bytes.fill(9);
  let completed = false;
  const second = pipe.writable.write(Uint8Array.from([66])).then(() => { completed = true; });
  await delay(20);
  assert.equal(completed, false);
  const collected = collectBytes(pipe.readable, { maxBytes: 4 });
  await second;
  await pipe.close();
  assert.deepEqual(await collected, Uint8Array.from([255, 0, 65, 66]));
});
await check('BytePipe blocked write cancellation preserves reason', async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1, signal: controller.signal });
  await pipe.writable.write(Uint8Array.from([1]));
  const reason = new Error('independent-pipe-cancel');
  const blocked = pipe.writable.write(Uint8Array.from([2]));
  const rejected = assert.rejects(blocked, error => error === reason);
  controller.abort(reason);
  await rejected;
  await pipe.abort(reason);
});
await check('default pipeline delayed sink owns 128KiB reused chunks', async () => {
  const shell = shellFor();
  const bytes = new Uint8Array(131073);
  bytes.fill(65);
  bytes[0] = 255; bytes[65536] = 0; bytes[131072] = 10;
  const retained = [];
  let active = 0;
  let maximum = 0;
  const result = await shell.exec('tac | tac', { stdin: reused(bytes), stdout: { async write(chunk) {
    active++; maximum = Math.max(maximum, active);
    const before = new Uint8Array(chunk);
    await delay(2);
    assert.deepEqual(chunk, before);
    retained.push(chunk);
    active--;
  } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(maximum, 1);
  assert.deepEqual(Buffer.concat(retained), Buffer.from(bytes));
  assert.deepEqual(result.stdoutBytes, bytes);
});
await check('actual Shell mid-write cancellation preserves reason', async () => {
  const controller = new AbortController();
  const reason = new Error('independent-shell-cancel');
  let started;
  let release;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const operation = shellFor().exec('expand | fold -b -w 4', { stdin: 'ABCDEFGH\n', signal: controller.signal, stdout: { async write() { started(); await blocked; } } });
  const rejected = assert.rejects(operation, error => error === reason);
  await entered;
  controller.abort(reason);
  release();
  await rejected;
});
await check('shared output budget exact positive boundary', async () => {
  const result = await shellFor().exec('tac; tac', { stdin: 'AB', limits: { maxOutputBytes: 2 } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'AB');
});
await check('shared stdout stderr output budget rejects exact limit', async () => {
  const shell = shellFor();
  shell.register({ name: 'dual', async execute(context) {
    await context.stdout.write(Uint8Array.from([1, 2]));
    await context.stderr.write(Uint8Array.from([3, 4]));
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec('dual', { limits: { maxOutputBytes: 3 } }), error => error instanceof ShellLimitError && error.limit === 'maxOutputBytes');
});
for (const maximum of [2, 3]) await check(`actual invoke shared command budget ${maximum}`, async () => {
  const shell = shellFor();
  let calls = 0;
  shell.use(async (context, next) => { if (context.command === 'strings') calls++; return next(); });
  shell.register({ name: 'nested', async execute(context) {
    const first = await context.invoke('strings', ['-n', '3'], { stdin: toByteSource('ABC\0') });
    assert.equal(first.exitCode, 0);
    return context.invoke('strings', ['-n', '3'], { stdin: toByteSource('DEF\0') });
  } });
  if (maximum === 2) {
    await assert.rejects(shell.exec('nested', { limits: { maxCommands: maximum } }), error => error instanceof ShellLimitError && error.limit === 'maxCommands');
    assert.equal(calls, 1);
  } else {
    const result = await shell.exec('nested', { limits: { maxCommands: maximum } });
    assert.equal(result.stdout, 'ABC\nDEF\n');
    assert.equal(result.exitCode, 0);
    assert.equal(calls, 2);
  }
});
for (const kind of ['maxInputBytes', 'maxOutputBytes']) for (const maximum of [2, 3]) await check(`public family ${kind} ${maximum} boundary`, async () => {
  const shell = shellFor().use(subpath.streamInspectionCommands({ replace: true, limits: { [kind]: maximum } }));
  const result = await shell.exec('tac', { stdin: 'ABC' });
  if (maximum === 3) {
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'ABC');
  } else {
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit exceeded/u);
    assert.equal(result.stdout, '');
  }
});
await check('resolver rejects external source and nonexported subpath', async () => {
  await assert.rejects(import(process.env.PUBLIC_DENIED_SOURCE), /SOURCE_FALLBACK_DENIED/u);
  await assert.rejects(import('virtual-bash/src/index.ts'), error => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
});
evidence.passed = results.filter(result => result.status === 'pass').length;
evidence.failed = results.filter(result => result.status === 'fail').length;
writeFileSync('runtime-results.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = evidence.failed ? 1 : 0;
