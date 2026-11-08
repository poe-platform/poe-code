import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capture, deferred, failure, loadProduct, readAdmission, turn } from '../execution-prep-v1/support.mjs';

const manifest = readAdmission(process.argv[2], process.argv[3]);
const { api } = await loadProduct(manifest, specifier => import.meta.resolve(specifier));
const original = JSON.parse(readFileSync(join(manifest.harnessRoot, 'cases.json')));
const observations = [];
const make = () => new api.Shell({ fs: new api.MemoryFileSystem(), env: { LC_ALL: 'C', TZ: 'UTC' } }).use(api.agentCommands());
async function row(id, execute) {
  const observation = { id, pass: false, settled: false, disposed: false, details: [] };
  try { await execute(observation.details); observation.pass = true; }
  catch (error) { observation.failure = failure(error); }
  observation.settled = true; observation.disposed = true; observations.push(observation);
  process.stdout.write(JSON.stringify({ observation }) + '\n');
}
await row('P39-v2', async details => {
  const frozen = original.find(row => row.id === 'P39');
  assert.equal(frozen.reference, 'existing local cursor restoration');
  assert.equal(frozen.script.split('; work;').length, 2);
  const script = frozen.script.replace('; work;', '; work "$@";'), shell = make();
  try {
    const result = await shell.exec(script);
    details.push({ originalId: frozen.id, script, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
    assert.equal(result.stdout, frozen.stdout); assert.equal(result.stderr, frozen.stderr); assert.equal(result.exitCode, frozen.exitCode);
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from('a\nb\n'));
  } finally { await shell.dispose(); }
});
await row('U01-default-unset', async details => {
  const shell = make(), script = 'let absent';
  try {
    const result = await shell.exec(script); details.push({ script, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
    assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); assert.equal(result.exitCode, 1);
    assert.equal(result.stdoutBytes.length, 0); assert.equal(result.stderrBytes.length, 0);
  } finally { await shell.dispose(); }
});
await row('S26-v2', async details => {
  const unhandled = [], listener = reason => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    for (const command of [':', 'let']) {
      const shell = make(), entered = deferred(), release = deferred(), events = [];
      let child, root, childSettled = false, rootSettled = false, cleanupCount = 0;
      shell.use((context, next) => {
        if (context.command === command) context.registerCleanup(async () => {
          cleanupCount++; events.push('cleanup-enter'); entered.resolve(); await release.promise; events.push('cleanup-done');
        });
        return next();
      });
      shell.register({ name: 'relay', execute(context) {
        events.push('invoke');
        child = capture(context.invoke(command, command === 'let' ? ['1'] : [])).then(outcome => { childSettled = true; events.push('child-settled'); return outcome; });
        events.push('handler-return'); return { exitCode: 0 };
      } });
      try {
        root = capture(shell.exec('relay')).then(outcome => { rootSettled = true; events.push('root-settled'); return outcome; });
        await Promise.race([entered.promise, root.then(() => { throw Error('root settled before cleanup entry'); })]);
        await turn(); assert.equal(rootSettled, false); assert.equal(childSettled, false); assert.equal(cleanupCount, 1);
        events.push('release'); release.resolve();
        const childResult = await child, rootResult = await root;
        details.push({ command, cleanupCount, events, child: childResult.kind === 'throw' ? { kind: 'throw', error: failure(childResult.reason) } : childResult, root: rootResult });
        assert.equal(childResult.kind, 'throw'); assert.ok(childResult.reason instanceof Error);
        assert.equal(childResult.reason.name, 'Error'); assert.equal(childResult.reason.message, 'Invocation is closed');
        assert.equal(rootResult.kind, 'return'); assert.equal(rootResult.value.exitCode, 0); assert.equal(rootResult.value.stdout, ''); assert.equal(rootResult.value.stderr, '');
        assert.equal(cleanupCount, 1);
        assert.deepEqual(events, ['invoke', 'handler-return', 'cleanup-enter', 'release', 'cleanup-done', 'child-settled', 'root-settled']);
      } finally { release.resolve(); await child; await root; await shell.dispose(); }
    }
    await turn(); assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', listener); }
});
const failed = observations.filter(row => !row.pass).map(row => row.id);
process.stdout.write(JSON.stringify({ summary: { cases: 3, pass: 3 - failed.length, failed } }) + '\n');
if (failed.length) process.exitCode = 1;
