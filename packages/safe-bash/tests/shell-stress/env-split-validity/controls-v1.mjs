import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = realpathSync(process.env.CONSUMER_PACKAGE_ROOT);
const loaded = {}; const forbidden = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { forbidden.push(name); throw new Error('Product host process forbidden'); };
globalThis.fetch = async () => { forbidden.push('fetch'); throw new Error('Product network forbidden'); };
syncBuiltinESMExports();
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const path = realpathSync(fileURLToPath(url));
    assert.ok(path.startsWith(resolve(packageRoot, 'dist') + '/') && path.endsWith('.js'));
    loaded[relative(packageRoot, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return nextLoad(url, context);
} });
const resolved = { root: import.meta.resolve('virtual-bash'), contracts: import.meta.resolve('virtual-bash/contracts') };
assert.equal(resolved.root, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
assert.equal(resolved.contracts, pathToFileURL(resolve(packageRoot, 'dist/contracts/index.js')).href);
const { Shell, MemoryFileSystem, agentCommands } = await import('virtual-bash');
await import('virtual-bash/contracts');
const policies = [
  { name: 'omitted-default-merge', options: undefined, expected: { KEEP: 'value', PWD: '/packed' } },
  { name: 'explicit-false-merge', options: { replaceEnv: false, env: { EXTRA: 'added' } }, expected: { KEEP: 'value', EXTRA: 'added', PWD: '/packed' } },
  { name: 'explicit-true-supplied', options: { replaceEnv: true, env: { ONLY: 'replacement' } }, expected: { ONLY: 'replacement' } },
  { name: 'explicit-true-omitted-empty', options: { replaceEnv: true }, expected: {} },
];
const variants = [{ name: 'implicit', origin: true }, { name: 'empty-explicit', hex: '', origin: false }, { name: 'binary-explicit', hex: '0041ff0a', origin: false }];
const observations = [];
for (const policy of policies) for (const variant of variants) {
  const calls = []; const captures = []; let disposed = false;
  const fs = new MemoryFileSystem(); await fs.mkdir('/packed');
  const shell = new Shell({ fs, cwd: '/packed', env: { PUBLIC: 'parent-public' } }).use(agentCommands()).use({
    name: 'explicit-replacement-controls-v1',
    setup(host) {
      host.use(async (context, next) => { calls.push({ command: context.command, args: [...context.args], env: { ...context.env }, origin: context.stdinIsDefault }); return next(); });
      host.commands.register({ name: 'entry', execute: context => context.invoke('env', ['-S', '-i KEEP=value forward input']) });
      host.commands.register({ name: 'forward', execute: context => context.invoke('sink', [], policy.options) });
      host.commands.register({ name: 'sink', execute: async context => {
        const chunks = [];
        for await (const bytes of context.stdin) { chunks.push(Buffer.from(bytes)); await context.stdout.write(bytes); }
        captures.push({ env: { ...context.env }, origin: context.stdinIsDefault, hex: Buffer.concat(chunks).toString('hex'), cwd: context.cwd });
        return { exitCode: 0 };
      } });
    },
    dispose() { disposed = true; },
  });
  let result;
  try {
    result = await shell.exec('entry | cat', variant.hex === undefined ? {} : { stdin: Buffer.from(variant.hex, 'hex') });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
    assert.equal(Buffer.from(result.stdoutBytes).toString('hex'), variant.hex ?? '');
    assert.deepEqual(captures, [{ env: policy.expected, origin: variant.origin, hex: variant.hex ?? '', cwd: '/packed' }]);
    for (const name of ['entry', 'env', 'forward', 'sink', 'cat']) assert.equal(calls.filter(call => call.command === name).length, 1);
    assert.deepEqual(calls.find(call => call.command === 'forward').env, { KEEP: 'value' });
    for (const name of ['forward', 'sink']) assert.equal(calls.find(call => call.command === name).origin, variant.origin);
    assert.equal(Object.hasOwn(captures[0].env, 'PUBLIC'), false);
    if (policy.options?.replaceEnv) { assert.equal(Object.hasOwn(captures[0].env, 'KEEP'), false); assert.equal(Object.hasOwn(captures[0].env, 'PWD'), false); }
    assert.deepEqual(await fs.readdir('/packed'), []);
  } finally { await shell.dispose(); }
  assert.equal(disposed, true);
  observations.push({ policy: policy.name, variant: variant.name, passed: true, calls, captures, disposed, tuple: { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex'), effects: {} } });
}
assert.deepEqual(forbidden, []);
console.log(JSON.stringify({ resolved, loaded, forbidden, observations }));
