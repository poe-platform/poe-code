import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, relative } from 'node:path';
import { nativeCases, hostCases } from './cases.mjs';

const fixture = [...nativeCases, ...hostCases].find(row => row.id === process.argv[2]);
assert.ok(fixture, 'Frozen consumer case required');
const packageRoot = realpathSync(process.env.CONSUMER_PACKAGE_ROOT);
const emitted = resolve(packageRoot, 'dist') + '/';
const loaded = {};
const forbiddenHostCalls = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { forbiddenHostCalls.push(name); throw new Error('Native child processes forbidden in product consumer'); };
globalThis.fetch = async () => { forbiddenHostCalls.push('fetch'); throw new Error('Network is not enabled'); };
syncBuiltinESMExports();
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const path = realpathSync(fileURLToPath(url.split('?')[0]));
    assert.ok(path.startsWith(emitted), `Product import outside compiled snapshot: ${path}`);
    assert.ok(path.endsWith('.js'), `Non-JavaScript product import: ${path}`);
    loaded[relative(packageRoot, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return nextLoad(url, context);
} });
const resolved = { root: import.meta.resolve('virtual-bash'), contracts: import.meta.resolve('virtual-bash/contracts') };
assert.equal(resolved.root, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
assert.equal(resolved.contracts, pathToFileURL(resolve(packageRoot, 'dist/contracts/index.js')).href);
const api = await import('virtual-bash');
const contracts = await import('virtual-bash/contracts');
assert.equal(api.FsError, contracts.FsError);
const { Shell, MemoryFileSystem, agentCommands, ShellLimitError } = api;
const fs = new MemoryFileSystem();
await fs.mkdir('/consumer');
for (const [name, file] of Object.entries(fixture.files ?? {})) {
  await fs.writeFile('/consumer/' + name, Buffer.from(file.text));
  await fs.chmod('/consumer/' + name, file.mode);
}
const calls = [];
const ticks = [];
const invocations = [];
const controller = new AbortController();
const reason = new contracts.FsError('ENOENT', { path: '/consumer-cancel' });
let waiterCalls = 0;
let disposed = false;
const plugin = {
  name: 'independent-public-consumer',
  setup(host) {
    host.use(async (context, next) => { calls.push({ command: context.command, args: [...context.args], cwd: context.cwd, stdinIsDefault: context.stdinIsDefault }); return next(); });
    host.commands.register({ name: 'tick', execute: async context => { ticks.push([...context.args]); return { exitCode: 0 }; } });
    host.commands.register({ name: 'waiter', execute: async () => {
      waiterCalls++;
      setTimeout(() => controller.abort(reason), 5);
      return new Promise((accept, reject) => { setTimeout(() => reject(new Error('Observed late rejection')), 20); });
    } });
    host.commands.register({ name: 'consumer-entry', execute: async context => {
      const command = fixture.role ?? 'bash';
      const args = [...(fixture.options ?? ['-e']), '-c', fixture.source, fixture.name, ...fixture.args];
      invocations.push({ command, args });
      assert.equal(typeof context.invoke, 'function');
      return context.invoke(command, args);
    } });
  },
  dispose() { disposed = true; },
};
const shell = new Shell({ fs, cwd: '/consumer', env: { PATH: '/consumer/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } }).use(agentCommands()).use(plugin);
let observation;
try {
  if (!fixture.kind) {
    const result = await shell.exec('consumer-entry');
    const entries = {};
    for (const entry of (await fs.readdir('/consumer')).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = '/consumer/' + entry.name;
      const stat = await fs.lstat(path);
      assert.equal(stat.type, 'file');
      entries[entry.name] = { hex: Buffer.from(await fs.readFile(path)).toString('hex'), mode: stat.mode & 0o777 };
    }
    observation = { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex'), entries };
  } else {
    let error;
    try { await shell.exec('consumer-entry; tick outer-forbidden', fixture.kind === 'budget' ? { limits: { maxCommands: fixture.maxCommands } } : { signal: controller.signal }); } catch (caught) { error = caught; }
    if (fixture.kind === 'cancel') await new Promise(accept => setTimeout(accept, 40));
    observation = { passed: false, ticks, waiterCalls, error: error ? { name: error.name, message: error.message, limit: error.limit, code: error.code } : null, sameReason: error === reason, typedLimit: error instanceof ShellLimitError };
    if (fixture.kind === 'budget') {
      assert.ok(error instanceof ShellLimitError);
      assert.equal(error.limit, fixture.expectedLimit);
      assert.deepEqual(ticks, fixture.expectedCalls);
    } else {
      assert.equal(error, reason);
      assert.equal(waiterCalls, fixture.expectedWaiterCalls);
      assert.equal(ticks.length, fixture.expectedTickCalls);
    }
    observation.passed = true;
  }
  assert.equal(forbiddenHostCalls.length, 0);
  assert.ok(shell.commands.has('cat'));
  assert.equal(invocations.length, 1);
  assert.deepEqual(calls.find(row => row.command === (fixture.role ?? 'bash'))?.args, invocations[0].args);
} catch (error) {
  observation = { ...observation, passed: false, failure: { name: error.name, message: error.message, actual: error.actual, expected: error.expected } };
} finally { await shell.dispose(); }
console.log(JSON.stringify({ id: fixture.id, observation, resolved, loaded, invocations, calls, ticks, waiterCalls, disposed, forbiddenHostCalls }));
