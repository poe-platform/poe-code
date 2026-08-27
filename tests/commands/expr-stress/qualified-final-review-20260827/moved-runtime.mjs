import assert from 'node:assert/strict';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import threads from 'node:worker_threads';
import { owned } from './prepare.mjs';
const { installed } = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const base = pathToFileURL(realpathSync(installed) + '/').href;
const imports = new Set(), workers = new Set(), workerFlags = [], checks = [];
const hooks = registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); if (context.parentURL?.startsWith(base)) { assert(result.url.startsWith(base) || result.url.startsWith('node:')); imports.add(result.url); } return result; } });
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  constructor(url, options) { assert(url.href.startsWith(base)); super(url, options); workers.add(this); workerFlags.push({ url: url.href, execArgv: options.execArgv, resourceLimits: options.resourceLimits }); this.on('exit', () => workers.delete(this)); }
};
syncBuiltinESMExports();
const { createExprCommand, exprCommands } = await import(`${base}dist/commands/expr/index.js`);
const { matchExpr } = await import(`${base}dist/commands/expr/bre-worker.js`);
const { exprMatchCeilings } = await import(`${base}dist/commands/regex-execution/protocol.js`);
const { Shell } = await import(`${base}dist/shell/shell.js`);
const { createMemoryFileSystem } = await import(`${base}dist/fs/memory/index.js`);
async function check(id, action) { await action(); checks.push(id); }
try {
  await check('physical-realpath-install', () => assert.equal(realpathSync(installed), installed));
  await check('no-installed-source', () => assert(!existsSync(join(installed, 'src'))));
  await check('no-runtime-dependencies', () => assert.deepEqual(JSON.parse(readFileSync(join(installed, 'package.json'))).dependencies ?? {}, {}));
  await check('main-thread-compiler-refuses-before-invalid-pattern', () => assert.throws(() => matchExpr({ kind: 'expr-match', pattern: Buffer.from('['), profile: 'byte', limits: exprMatchCeilings }, Buffer.from('')), /worker/));
  for (const [index, reason] of [0, false, '', null, Object.assign(new Error('aborted'), { code: 'ENOENT' }), Symbol('aborted')].entries()) await check(`postcandidate-preabort-no-acquisition-${index}`, async () => {
    const controller = new AbortController(); controller.abort(reason); const events = [];
    let caught;
    try { await createExprCommand().execute({ command: 'expr', args: ['a', ':', '['], cwd: '/', env: { LC_ALL: 'en_US.UTF-8' }, signal: controller.signal,
      get stdin() { throw Error('stdin acquired'); }, get fs() { throw Error('fs acquired'); },
      registerCleanup() { events.push('register'); }, stdout: { async write() { events.push('stdout'); } }, stderr: { async write() { events.push('stderr'); } } }); }
    catch (error) { caught = error; }
    assert.equal(caught, reason); assert(!events.includes('stdout')); assert(!events.includes('stderr')); assert.equal(workerFlags.length, 0);
  });
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: 'en_US.UTF-8' } }).use(exprCommands());
  try {
    await check('moved-shell-named-scalar-and-worker', async () => { const result = await shell.exec("expr length 'é😀'; expr 'éé' : '\\(é\\)\\1'"); assert.equal(result.stdout, '2\né\n'); assert.equal(result.stderr, ''); assert.equal(result.exitCode, 0); });
    await check('owned-workers-settled-before-exec', () => assert.equal(workers.size, 0));
  } finally { await shell.dispose(); }
  await check('dispose-settled-workers', () => assert.equal(workers.size, 0));
  console.log(JSON.stringify({ passed: checks.length, checks, nodeFlags: process.execArgv, workerFlags, imports: [...imports].sort(), activeWorkers: workers.size, qualification: 'POSTCANDIDATE moved physical-module runtime checks. Six corrected preabort controls do not assert registration before nonexistent acquisition; initial six supplement assumption failures preserved separately. Not root/subpath expr availability or opaque-host cleanup proof.' }));
} finally { await Promise.all([...workers].map(worker => worker.terminate())); threads.Worker = NativeWorker; syncBuiltinESMExports(); hooks.deregister(); }
