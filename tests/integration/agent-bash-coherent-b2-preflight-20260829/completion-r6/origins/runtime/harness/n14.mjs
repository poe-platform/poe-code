import assert from 'node:assert/strict';
import * as api from 'virtual-bash';
const rows = [], shells = new Set(), releases = new Set();
const capture = promise => promise.then(value => ({ kind: 'return', value }), reason => ({ kind: 'throw', reason }));
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function create() { const shell = new api.Shell({ fs: new api.MemoryFileSystem(), cwd: '/' }).use(api.agentCommands()); shells.add(shell); return shell; }
async function record(id, action) {
  if (process.env.N14_CASE && process.env.N14_CASE !== id) return;
  const row = { id, role: 'EXACT_OWNED_PROMISE_PRODUCT_PROFILE_NOT_NATIVE', pass: false };
  const timer = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exit(78); }, 30000);
  try { await action(row); row.pass = true; } catch (error) { row.error = String(error?.stack ?? error); }
  finally {
    for (const release of releases) release(); releases.clear();
    const results = await Promise.allSettled([...shells].map(shell => shell.dispose()));
    row.created = shells.size; row.disposed = results.filter(result => result.status === 'fulfilled').length;
    row.cleanupFailure = row.created !== row.disposed; shells.clear(); clearTimeout(timer);
  }
  rows.push(row); console.log(JSON.stringify(row)); if (row.cleanupFailure) process.exit(78);
}
async function forward(row, reason, { mode = 'exact', cleanupFailure = false, caller = false, observe = false, nested = false } = {}) {
  const shell = create(), gate = deferred(), entered = deferred(), controller = new AbortController();
  let writes = 0, settled = false, publicObserved;
  const events = []; row.events = events;
  const event = value => { events.push(value); console.error(JSON.stringify({ protocol: row.id, event: value })); };
  const release = () => { event('release'); gate.resolve(); }; releases.add(release);
  if (nested) shell.commands.register({ name: 'relay', execute(context) { return context.invoke('f', []); } });
  shell.commands.register({ name: 'guard', execute(context) {
    context.registerCleanup(async () => { event('cleanup-enter'); entered.resolve(); await gate.promise; event('cleanup-finished'); if (cleanupFailure) throw false; });
    event('registered'); const promise = context.invoke(nested ? 'relay' : 'f', []);
    if (observe) void promise.then(() => { publicObserved = { kind: 'return' }; }, error => { publicObserved = { kind: 'throw', reason: error }; event('invoke-rejected'); });
    if (mode === 'consume') return promise.catch(() => ({ exitCode: 0 }));
    if (mode === 'transform') return promise.catch(error => { throw error; });
    if (mode === 'async') return (async () => await promise)();
    return promise;
  } });
  const pending = capture(shell.exec('f(){ printf "%s" "${absent:?required}"; }; guard', {
    signal: controller.signal, stderr: { async write() { writes++; event('diagnostic'); throw reason; } },
  })).then(outcome => { settled = true; event('settled'); return outcome; });
  try { await entered.promise; await turn(); assert.equal(settled, false); if (caller) { controller.abort(false); event('caller-abort'); } }
  finally { release(); releases.delete(release); }
  const outcome = await pending;
  row.outcome = { kind: outcome.kind, reasonType: typeof outcome.reason, exitCode: outcome.value?.exitCode }; row.writes = writes;
  assert.ok(events.indexOf('cleanup-finished') < events.indexOf('settled'));
  if (caller) { assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, false); assert.equal(writes, 1); }
  else if (mode === 'consume') { assert.equal(outcome.kind, 'return'); assert.equal(outcome.value.exitCode, 0); assert.equal(writes, 1); }
  else if (mode === 'transform' || mode === 'async') {
    assert.equal(outcome.kind, 'return'); assert.equal(outcome.value.exitCode, 1); assert.equal(writes, 2);
    row.qualification = 'TRANSFORMED_PROMISE_OUTSIDE_EXACT_FORWARDING_RULE';
  } else { assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 1); }
  if (observe) { assert.equal(publicObserved?.kind, 'throw'); assert.equal(publicObserved.reason, reason); }
}
await record('N01', row => forward(row, 0));
await record('N02', row => forward(row, false));
await record('N03', row => forward(row, undefined));
await record('N04', row => forward(row, 0, { observe: true }));
await record('N05', async row => {
  const shell = create(); let writes = 0;
  shell.commands.register({ name: 'ordinary', execute() { throw 0; } });
  const outcome = await capture(shell.exec('ordinary', { stderr: { async write() { writes++; throw 0; } } }));
  assert.equal(outcome.kind, 'return'); assert.equal(outcome.value.exitCode, 1); assert.equal(writes, 1); row.writes = writes;
});
await record('N06', row => forward(row, 0, { mode: 'consume' }));
await record('N07', row => forward(row, 0, { mode: 'transform' }));
await record('N08', row => forward(row, 0, { mode: 'async' }));
await record('N09', row => forward(row, 0, { cleanupFailure: true, caller: true }));
await record('N10', row => forward(row, 0, { cleanupFailure: true }));
await record('N11', row => forward(row, new api.ShellLimitError('maxOutputBytes', 0)));
await record('N12', row => forward(row, 0, { nested: true }));
console.log(JSON.stringify({ summary: { cases: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length } }));
process.exitCode = rows.some(row => !row.pass) ? 1 : 0;
