import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeCases, hostCases, baseEnv, selectedKeys } from './cases.mjs';

const fixture = [...nativeCases, ...hostCases].find(row => row.id === process.argv[2]);
assert.ok(fixture, 'Frozen fixture required');
const packageRoot = realpathSync(process.env.CONSUMER_PACKAGE_ROOT);
const loaded = {}; const forbidden = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { forbidden.push(name); throw new Error('Native product process forbidden'); };
globalThis.fetch = async () => { forbidden.push('fetch'); throw new Error('Product network disabled'); };
syncBuiltinESMExports();
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const path = realpathSync(fileURLToPath(url.split('?')[0]));
    assert.ok(path.startsWith(resolve(packageRoot, 'dist') + '/') && path.endsWith('.js'), 'Product import must be installed packed JavaScript: ' + path);
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
const observations = [];
for (const variant of fixture.variants ?? [null]) {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/packed'); await fs.writeFile('/packed/phase', Buffer.from('seed')); await fs.chmod('/packed/phase', 0o644);
  if (fixture.header) { await fs.writeFile('/packed/script', Buffer.from(`#!/usr/bin/env ${fixture.header}\n${fixture.body}`)); await fs.chmod('/packed/script', 0o755); }
  const calls = []; const ticks = []; const sinks = []; let waiterCalls = 0; let disposed = false;
  const controller = new AbortController();
  const reason = new contracts.FsError('ENOENT', { path: '/packed-cancel' });
  const plugin = { name: 'independent-packed-env-consumer', setup(host) {
    host.use(async (context, next) => { calls.push({ command: context.command, args: [...context.args], env: { ...context.env }, cwd: context.cwd, stdinIsDefault: context.stdinIsDefault }); return next(); });
    host.commands.register({ name: 'record', execute: async context => {
      const fields = [String(context.args.length), ...context.args];
      for (const key of selectedKeys) fields.push(Object.hasOwn(context.env, key) ? 'x' : '', context.env[key] ?? '');
      await context.stdout.write(Buffer.from(fields.join('\0') + '\0')); return { exitCode: 0 };
    } });
    host.commands.register({ name: 'sink', execute: async context => {
      const chunks = []; for await (const bytes of context.stdin) { chunks.push(Buffer.from(bytes)); await context.stdout.write(bytes); }
      sinks.push({ hex: Buffer.concat(chunks).toString('hex'), env: { ...context.env }, origin: context.stdinIsDefault, cwd: context.cwd }); return { exitCode: 0 };
    } });
    host.commands.register({ name: 'tick', execute: async context => { ticks.push(context.args[0]); return { exitCode: 0 }; } });
    host.commands.register({ name: 'waiter', execute: async () => {
      waiterCalls++; setTimeout(() => controller.abort(reason), 5);
      return new Promise((accept, reject) => setTimeout(() => reject(new Error('Late rejection must be observed')), 20));
    } });
    host.commands.register({ name: 'forward', execute: async context => {
      if (context.args[0] === 'input') return context.invoke('sink', []);
      if (context.args[0] === 'cancel') return context.invoke('waiter', []);
      assert.equal(context.args[0], 'budget'); await context.invoke('tick', ['first']); return context.invoke('tick', ['forbidden']);
    } });
    host.commands.register({ name: 'entry', execute: context => context.invoke('env', fixture.args ?? ['-S', fixture.split]) });
  }, dispose() { disposed = true; } };
  const shell = new Shell({ fs, cwd: '/packed', env: { ...baseEnv, PATH: '/packed/bin' } }).use(agentCommands()).use(plugin);
  let result; let caught; let tuple; let passed;
  try {
    const setup = await shell.exec('SECRET=parent-local'); assert.equal(setup.exitCode, 0);
    const options = fixture.kind === 'budget' ? { limits: { maxCommands: fixture.maxCommands } } : fixture.kind === 'cancel' ? { signal: controller.signal } : variant?.hex != null ? { stdin: Buffer.from(variant.hex, 'hex') } : {};
    try { result = await shell.exec(fixture.header ? fixture.source : fixture.command ?? 'entry', options); } catch (error) { caught = error; }
    if (fixture.kind === 'cancel') await new Promise(accept => setTimeout(accept, 40));
    const effects = {};
    for (const entry of (await fs.readdir('/packed')).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'script') continue;
      const path = '/packed/' + entry.name; const stat = await fs.lstat(path);
      effects[entry.name] = stat.type === 'file' ? { hex: Buffer.from(await fs.readFile(path)).toString('hex'), mode: stat.mode & 0o777 } : { type: stat.type };
    }
    tuple = result ? { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex'), effects } : null;
    if (fixture.kind === 'input') {
      assert.equal(caught, undefined); assert.equal(tuple.status, 0); assert.equal(tuple.stderrHex, ''); assert.equal(tuple.stdoutHex, variant.hex ?? '');
      assert.deepEqual(sinks, [{ hex: variant.hex ?? '', env: fixture.exactEnv, origin: variant.defaultOrigin, cwd: '/packed' }]);
      for (const command of ['env', 'forward', 'sink', 'cat']) assert.equal(calls.filter(call => call.command === command).length, 1);
      for (const command of ['forward', 'sink']) assert.equal(calls.find(call => call.command === command).stdinIsDefault, variant.defaultOrigin);
      passed = true;
    } else if (fixture.kind === 'budget') {
      assert.ok(caught instanceof ShellLimitError); assert.equal(caught.limit, fixture.expectedLimit); assert.deepEqual(ticks, fixture.expectedTicks); passed = true;
    } else if (fixture.kind === 'cancel') {
      assert.equal(caught, reason); assert.equal(waiterCalls, fixture.expectedWaiterCalls); assert.deepEqual(ticks, []); passed = true;
    } else {
      assert.equal(caught, undefined);
      if (!fixture.header) assert.deepEqual(calls.find(call => call.command === 'env').args, fixture.args);
      if (fixture.id === 'unsupported-dollar-stops-before-dispatch') assert.equal(calls.some(call => call.command === 'record'), false);
    }
    const parent = await shell.exec('printf "%s|%s" "$SECRET" "$PUBLIC"');
    assert.equal(parent.exitCode, 0); assert.equal(parent.stdout, 'parent-local|parent-public'); assert.equal(parent.stderr, '');
    assert.equal(forbidden.length, 0); assert.ok(shell.commands.has('cat'));
  } catch (error) { passed = false; caught = error; }
  finally { await shell.dispose(); }
  observations.push({ variant: variant?.name ?? null, tuple, passed, error: caught ? { name: caught.name, message: caught.message, code: caught.code, limit: caught.limit } : null, sameReason: caught === reason, calls, ticks, sinks, waiterCalls, disposed });
}
console.log(JSON.stringify({ id: fixture.id, resolved, loaded, observations, forbidden }));
