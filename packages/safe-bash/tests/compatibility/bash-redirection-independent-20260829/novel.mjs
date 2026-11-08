import assert from 'node:assert/strict';
import * as api from 'virtual-bash';
import { parseShell } from 'virtual-bash/shell';
const rows = [], shells = new Set(), releases = new Set();
const wait = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(memory = new api.MemoryFileSystem()) {
  const counters = { entered: 0, cleaned: 0, args: [] };
  const shell = new api.Shell({ fs: memory, cwd: '/' }).use(api.agentCommands()); shells.add(shell);
  shell.commands.register({ name: 'emit', async execute(context) {
    counters.entered++; counters.args.push([...context.args]); context.registerCleanup(() => { counters.cleaned++; });
    await context.stdout.write(Buffer.from('O')); await context.stderr.write(Buffer.from('E')); return { exitCode: 0 };
  } });
  return { memory, shell, counters };
}
async function record(id, body) {
  const row = { id, pass: false }; const timer = setTimeout(() => process.exit(78), 30000);
  try { await body(); row.pass = true; } catch (error) { row.error = String(error.stack ?? error); }
  finally {
    for (const release of releases) release(); releases.clear();
    const outcomes = await Promise.allSettled([...shells].map(shell => shell.dispose()));
    row.created = shells.size; row.disposed = outcomes.filter(value => value.status === 'fulfilled').length;
    row.cleanupFailure = row.created !== row.disposed; shells.clear(); clearTimeout(timer);
  }
  rows.push(row); console.log(JSON.stringify(row)); if (row.cleanupFailure) process.exit(78);
}
function streams(result, stdout = '', stderr = '', exitCode = 0) {
  assert.equal(result.exitCode, exitCode); assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(stdout)); assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(stderr));
}
async function files(memory, expected) {
  assert.deepEqual((await memory.readdir('/')).map(row => [row.name, row.type]).sort(), Object.keys(expected).sort().map(name => [name, 'file']));
  for (const [name, value] of Object.entries(expected)) assert.deepEqual(Buffer.from(await memory.readFile('/' + name)), Buffer.from(value));
}
await record('N01-escaped-operators', async () => { const { shell, memory } = setup(); streams(await shell.exec("printf '%s\\n' \\|\\& \\&\\>"), '|&\n&>\n'); await files(memory, {}); });
await record('N02-adjacent-number-is-argument', async () => { const { shell, memory, counters } = setup(); streams(await shell.exec('emit 2&>out')); assert.deepEqual(counters.args, [['2']]); await files(memory, { out: 'OE' }); });
await record('N03-missing-target-no-effects', async () => {
  for (const script of ['emit &>', 'emit |&']) { const { shell, memory, counters } = setup(); const result = await shell.exec(script); assert.equal(result.exitCode, 2); assert.equal(result.stdout, ''); assert.notEqual(result.stderr, ''); assert.equal(counters.entered, 0); await files(memory, {}); }
});
await record('N04-unsupported-operators-pre-effect', async () => {
  for (const script of ['emit &>>out', 'emit &']) { const { shell, memory, counters } = setup(); const result = await shell.exec(script); assert.equal(result.exitCode, 2); assert.equal(counters.entered, 0); await files(memory, {}); }
});
await record('N05-unused-open-effects-order', async () => { const { shell, memory, counters } = setup(); streams(await shell.exec('emit &>first 1>second 2>third |& cat')); await files(memory, { first: '', second: 'OE', third: '' }); assert.equal(counters.cleaned, 1); });
await record('N06-reused-function-ast', async () => {
  const { shell, memory, counters } = setup(); const source = 'f(){ emit 2>unused |& cat; }; f; f';
  const parsed = parseShell(source), before = JSON.stringify(parsed); assert.equal((before.match(/"implicitPipeline":true/g) ?? []).length, 1);
  streams(await shell.exec(source), 'OEOE'); assert.equal(JSON.stringify(parsed), before); assert.equal(counters.entered, 2); assert.equal(counters.cleaned, 2); await files(memory, { unused: '' });
  const display = await shell.exec('type f'); assert.equal(display.exitCode, 0); assert.equal((display.stdout.match(/\|&/g) ?? []).length, 1); assert.doesNotMatch(display.stdout, /2>&\s*1/);
});
await record('N07-array-quote-provenance', async () => { const { shell, memory } = setup(); streams(await shell.exec('a=(\'x y\' \'|&\'); printf \'<%s>\' "${a[@]}" &>out; cat out'), '<x y><|&>'); await files(memory, { out: '<x y><|&>' }); });
await record('N08-compound-loop-pipeline', async () => { const { shell, memory, counters } = setup(); streams(await shell.exec('(for value in 1 2; do emit; done) 2>unused |& cat'), 'OEOE'); await files(memory, { unused: '' }); assert.equal(counters.cleaned, 2); });
await record('N09-file-write-backpressure', async () => {
  const memory = new api.MemoryFileSystem(), gate = wait(), entered = wait(); releases.add(gate.resolve);
  const original = memory.writeFile.bind(memory); let opens = 0, writes = 0;
  memory.writeFile = async (filename, data, options) => { if (filename === '/out') { if (!data.length) opens++; else { writes++; entered.resolve(); await gate.promise; } } return original(filename, data, options); };
  const { shell, counters } = setup(memory); let settled = false; const execution = shell.exec('emit &>out').then(value => { settled = true; return value; });
  await entered.promise; await turn(); assert.equal(settled, false); gate.resolve(); streams(await execution); assert.equal(opens, 1); assert.equal(writes, 2); assert.equal(counters.cleaned, 1); await files(memory, { out: 'OE' });
});
await record('N10-falsy-abort-reason', async () => {
  const memory = new api.MemoryFileSystem(), gate = wait(), entered = wait(), controller = new AbortController(); releases.add(gate.resolve);
  const original = memory.writeFile.bind(memory); memory.writeFile = async (filename, data, options) => { if (data.length) { entered.resolve(); await gate.promise; } return original(filename, data, options); };
  const { shell, counters } = setup(memory); const observed = shell.exec('emit &>out', { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  await entered.promise; controller.abort(false); gate.resolve(); const outcome = await observed; assert.ok(Object.hasOwn(outcome, 'error')); assert.equal(outcome.error, false); assert.equal(counters.cleaned, 1);
});
await record('N11-later-open-failure', async () => { const { shell, memory, counters } = setup(); const result = await shell.exec('emit &>first &>/absent/out'); assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.notEqual(result.stderr, ''); assert.equal(counters.entered, 0); await files(memory, { first: '' }); });
await record('N12-operator-in-quoted-target', async () => { const { shell, memory } = setup(); streams(await shell.exec("emit &>'a|&b'; cat 'a|&b'"), 'OE'); await files(memory, { 'a|&b': 'OE' }); });
const pass = rows.filter(row => row.pass).length; console.log(JSON.stringify({ summary: { cases: rows.length, pass, fail: rows.length - pass } })); process.exitCode = pass === rows.length && rows.length === 12 ? 0 : 1;
