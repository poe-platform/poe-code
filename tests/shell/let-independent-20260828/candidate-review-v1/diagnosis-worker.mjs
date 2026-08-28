import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capture, deferred, failure, loadProduct, readAdmission, turn } from '../execution-prep-v1/support.mjs';

const manifest = readAdmission(process.argv[2], process.argv[3]);
const { api, runtime } = await loadProduct(manifest, specifier => import.meta.resolve(specifier));
const rows = JSON.parse(readFileSync(join(manifest.harnessRoot, 'cases.json')));
const observations = [];
const make = () => new api.Shell({ fs: new api.MemoryFileSystem(), env: { LC_ALL: 'C', TZ: 'UTC' } }).use(api.agentCommands());
async function record(id, execute) {
  const observation = { id, pass: false, settled: false, disposed: false, details: [] };
  try { await execute(observation.details); observation.pass = true; }
  catch (error) { observation.failure = failure(error); }
  observation.settled = true; observation.disposed = true;
  observations.push(observation); process.stdout.write(JSON.stringify({ observation }) + '\n');
}
await record('D01', async details => {
  const shell = make(), positions = [], original = runtime.Runtime.prototype.builtin;
  runtime.Runtime.prototype.builtin = function (...args) {
    if (args[0].command === 'getopts') positions.push({ positional: [...args[1].positional], depth: args[1].functionDepth });
    return original.apply(this, args);
  };
  try {
    const script = rows.find(row => row.id === 'P39').script.replace("let 'OPTIND=1'", 'OPTIND=1');
    details.push({ script, result: await shell.exec(script), positions });
  } finally { runtime.Runtime.prototype.builtin = original; await shell.dispose(); }
});
await record('D02', async details => {
  const shell = make(), commands = [], original = runtime.Runtime.prototype.builtin;
  runtime.Runtime.prototype.builtin = function (...args) { commands.push(args[0].command); return original.apply(this, args); };
  try { details.push({ result: await shell.exec(rows.find(row => row.id === 'P58').script), commands }); }
  finally { runtime.Runtime.prototype.builtin = original; await shell.dispose(); }
});
await record('D03', async details => {
  for (const command of manifest.layout === 'absent-reversion' ? [':'] : [':', 'let']) {
    const shell = make(), entered = deferred(), release = deferred(), events = [];
    let child, root, childSettled = false, rootSettled = false, cleanups = 0;
    shell.use((context, next) => {
      if (context.command === command) context.registerCleanup(async () => {
        cleanups++; events.push('cleanup-enter'); entered.resolve(); await release.promise; events.push('cleanup-done');
      });
      return next();
    });
    shell.register({ name: 'relay', execute(context) {
      events.push('invoke');
      child = capture(context.invoke(command, command === 'let' ? ['1'] : [])).then(value => { childSettled = true; events.push('child-settled'); return value; });
      events.push('handler-return'); return { exitCode: 0 };
    } });
    try {
      root = capture(shell.exec('relay')).then(value => { rootSettled = true; events.push('root-settled'); return value; });
      await Promise.race([entered.promise, root.then(() => { throw Error('root settled before cleanup entry'); })]);
      await turn(); assert.equal(rootSettled, false); assert.equal(childSettled, false);
      events.push('release'); release.resolve();
      const childResult = await child, rootResult = await root;
      assert.equal(rootResult.kind, 'return'); assert.equal(rootResult.value.exitCode, 0); assert.equal(cleanups, 1);
      assert.ok(events.indexOf('cleanup-done') < events.indexOf('root-settled'));
      details.push({ command, events, cleanups, child: childResult.kind === 'throw' ? { kind: 'throw', error: failure(childResult.reason) } : childResult, root: rootResult });
    } finally { release.resolve(); await child; await root; await shell.dispose(); }
  }
});
const failed = observations.filter(row => !row.pass).map(row => row.id);
process.stdout.write(JSON.stringify({ summary: { cases: 3, pass: 3 - failed.length, failed } }) + '\n');
if (failed.length) process.exitCode = 1;
