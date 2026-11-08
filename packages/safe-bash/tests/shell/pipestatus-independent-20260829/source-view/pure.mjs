import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const own = '/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829';
const work = '/private/tmp/safe-bash-pipestatus-author-fresh';
const seal = JSON.parse(fs.readFileSync(path.join(own, 'SEAL.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = filename => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= 4 * 1024 * 1024);
  const content = fs.readFileSync(filename);
  assert.equal(content.length, stat.size);
  return content;
};
for (const row of seal.sources) assert.equal(hash(read(path.join(seal.candidate, row.path))), row.sha256, row.path);
for (const row of seal.fixtures) assert.equal(hash(read(row.path)), row.sha256, row.path);
const compilerOut = fs.openSync(path.join(own, 'BUILD.stdout'), 'wx');
const compilerErr = fs.openSync(path.join(own, 'BUILD.stderr'), 'wx');
fs.appendFileSync(path.join(work, 'roles.log'), 'pure-child strict-TypeScript-compiler\n');
let compiler;
try {
  compiler = spawnSync(seal.compiler.executable, seal.compiler.args, {
    cwd: seal.candidate, env: { PATH: '/usr/bin:/bin', HOME: work, TMPDIR: work, LANG: 'C', LC_ALL: 'C' },
    stdio: ['ignore', compilerOut, compilerErr], timeout: seal.compiler.timeoutMs,
  });
} finally { fs.closeSync(compilerOut); fs.closeSync(compilerErr); }
fs.writeFileSync(path.join(own, 'BUILD.json'), JSON.stringify({ status: compiler.status, signal: compiler.signal, error: compiler.error?.message, pid: compiler.pid, executable: seal.compiler.executable, args: seal.compiler.args, synchronousChildReturned: true }, null, 2) + '\n', { flag: 'wx' });
if (compiler.error || compiler.signal) throw new Error('compiler retirement/deadline safety stop');
if (compiler.status !== 0) { console.error('Strict build failed; no pure imports executed.'); process.exit(1); }
assert(fs.statSync(path.join(own, 'BUILD.stdout')).size + fs.statSync(path.join(own, 'BUILD.stderr')).size <= 1024 * 1024);
const dist = path.join(seal.candidate, 'dist');
const closure = new Map();
function visit(filename) {
  if (closure.has(filename)) return;
  assert(filename.startsWith(dist + '/'));
  assert(!/(?:runtime|parser|worker)\.js$|regex-execution/u.test(filename), filename);
  const content = read(filename);
  closure.set(filename, { path: filename, bytes: content.length, sha256: hash(content) });
  for (const match of content.toString('utf8').matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/gu)) {
    assert(match[1].startsWith('.'), match[1]);
    visit(path.resolve(path.dirname(filename), match[1]));
  }
}
for (const relative of ['shell/pipestatus.js', 'shell/arrays/state.js', 'shell/arrays/bindings.js', 'shell/cleanup.js']) visit(path.join(dist, relative));
fs.writeFileSync(path.join(own, 'LOADED-CLOSURE.json'), JSON.stringify([...closure.values()], null, 2) + '\n', { flag: 'wx' });
const load = relative => import(pathToFileURL(path.join(dist, relative)).href);
const { pipelineStatusTarget, publishPipelineStatus } = await load('shell/pipestatus.js');
const { trackState, arrayStore, requireArrays } = await load('shell/arrays/state.js');
const { IndexedBinding, textToken } = await load('shell/arrays/bindings.js');
const { InvocationScope } = await load('shell/cleanup.js');
const results = [];
let openScopes = [];
function fixture(options = {}) {
  const controller = new AbortController();
  const scope = options.scope ?? new InvocationScope(controller.signal);
  if (!options.scope) openScopes.push(scope);
  const budget = options.budget ?? { limits: { maxExpansionBytes: options.bytes ?? 65536, maxExpansionFields: options.fields ?? 1000 } };
  const state = trackState({ cwd: '/', variables: Object.create(null), exported: new Set(), functions: new Map(), positional: [], status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false }, budget, scope);
  return { state, scope, budget, controller, signal: controller.signal };
}
const publish = (value, statuses) => publishPipelineStatus(value.state, statuses, value.signal, value.scope);
const values = value => [...(arrayStore(value.state)?.get('PIPESTATUS')?.values ?? [])].map(([index, element]) => [index, element.text.value]);
async function rejectsIdentity(promise, reason) { let rejected = false; try { await promise; } catch (error) { rejected = true; assert.equal(error, reason); } assert(rejected); }
const groups = [
  ['G01', async () => { const value = fixture(); assert.equal(pipelineStatusTarget(value.state), 'absent'); assert.equal(arrayStore(value.state), undefined); }],
  ['G02', async () => { const value = fixture(); await publish(value, [0]); assert.deepEqual(values(value), [[0, '0']]); }],
  ['G03', async () => { const value = fixture(); await publish(value, [1, 0, 127]); await publish(value, [2]); assert.deepEqual(values(value), [[0, '2']]); }],
  ['G04', async () => { const value = fixture(); await publish(value, [1]); value.state.readonlyVariables = new Set(['PIPESTATUS']); await publish(value, [0, 2]); assert.deepEqual(values(value), [[0, '0'], [1, '2']]); assert(value.state.readonlyVariables.has('PIPESTATUS')); }],
  ['G05', async () => { const value = fixture(); value.state.variables.PIPESTATUS = 'seed'; await publish(value, [1]); assert.equal(value.state.variables.PIPESTATUS, 'seed'); assert.equal(arrayStore(value.state), undefined); }],
  ['G06', async () => { const value = fixture(); value.state.variables.PIPESTATUS = ''; await publish(value, [1]); assert.equal(pipelineStatusTarget(value.state), 'scalar'); assert.equal(value.state.variables.PIPESTATUS, ''); }],
  ['G07', async () => { const value = fixture(); value.state.readonlyVariables = new Set(['PIPESTATUS']); await publish(value, [0]); assert.equal(pipelineStatusTarget(value.state), 'readonly-absent'); assert.equal(arrayStore(value.state), undefined); }],
  ['G08', async () => { const value = fixture(); value.state.locals.push(new Map([['PIPESTATUS', { value: undefined, exported: false, readOnly: false }]])); await publish(value, [0]); assert.equal(pipelineStatusTarget(value.state), 'local-tombstone'); assert.equal(arrayStore(value.state), undefined); }],
  ['G09', async () => { const value = fixture(); Object.setPrototypeOf(value.state.variables, { PIPESTATUS: 'inherited' }); await publish(value, [1]); assert.deepEqual(values(value), [[0, '1']]); }],
  ['G10', async () => { const value = fixture(); value.state.exported.add('PIPESTATUS'); await publish(value, [0]); assert.equal(pipelineStatusTarget(value.state), 'exported-absent'); assert.equal(arrayStore(value.state), undefined); }],
  ['G11', async () => { const value = fixture(); await publish(value, [0]); const binding = arrayStore(value.state).get('PIPESTATUS'); binding.insert(2147483647, await textToken(binding.owner, '9', value.signal)); await publish(value, [1, 0]); assert.deepEqual(values(value), [[0, '1'], [1, '0']]); }],
  ['G12', async () => { const value = fixture(); await publish(value, [7]); const before = arrayStore(value.state).get('PIPESTATUS'); await assert.rejects(publish(value, [0, 256]), TypeError); assert.equal(arrayStore(value.state).get('PIPESTATUS'), before); assert.deepEqual(values(value), [[0, '7']]); }],
  ['G13', async () => { const value = fixture({ fields: 100 }); await publish(value, [7]); const before = arrayStore(value.state).get('PIPESTATUS'); await assert.rejects(publish(value, Array(100).fill(0)), /private .* limit exceeded/u); assert.equal(arrayStore(value.state).get('PIPESTATUS'), before); assert.deepEqual(values(value), [[0, '7']]); }],
  ['G14', async () => { const value = fixture({ bytes: 64 }); await publish(value, [7]); const before = arrayStore(value.state).get('PIPESTATUS'); await assert.rejects(publish(value, Array(50).fill(255)), /private .* limit exceeded/u); assert.equal(arrayStore(value.state).get('PIPESTATUS'), before); assert.deepEqual(values(value), [[0, '7']]); }],
  ['G15', async () => { const value = fixture({ bytes: 0, fields: 0 }); await assert.rejects(publish(value, [0]), /private .* limit exceeded/u); assert.equal(arrayStore(value.state), undefined); }],
  ['G16', async () => { const value = fixture(); value.controller.abort(false); await rejectsIdentity(publish(value, [0]), false); assert.equal(arrayStore(value.state), undefined); }],
  ['G17', async () => { const value = fixture(); value.controller.abort(undefined); await rejectsIdentity(publish(value, [0]), value.signal.reason); }],
  ['G18', async () => { const value = fixture(); await publish(value, [7]); const pending = publish(value, [1, 0]); value.state.variables.OTHER = 'concurrent'; await assert.rejects(pending, /stale/u); assert.deepEqual(values(value), [[0, '7']]); }],
  ['G19', async () => { const value = fixture(); await publish(value, [7]); const pending = publish(value, [1, 0]); value.controller.abort(null); await rejectsIdentity(pending, null); assert.deepEqual(values(value), [[0, '7']]); }],
  ['G20', async () => { const parent = fixture(); await publish(parent, [0]); const child = fixture({ budget: parent.budget, scope: parent.scope.child() }); await publish(child, [1]); assert.equal(requireArrays(parent.state).owner.ledger, requireArrays(child.state).owner.ledger); assert.deepEqual(values(parent), [[0, '0']]); }],
  ['G21', async () => { const first = fixture(); const second = fixture(); await publish(first, [0]); await publish(second, [1]); assert.notEqual(requireArrays(first.state).owner.ledger, requireArrays(second.state).owner.ledger); }],
  ['G22', async () => { const value = fixture(); value.scope.register(() => { throw false; }); await publish(value, [0]); await value.scope.close(); assert.deepEqual(value.scope.failures, [false]); }],
  ['G23', async () => { const value = fixture(); await publish(value, [0, 1]); const ledger = requireArrays(value.state).owner.ledger; const before = ledger.snapshot(); await value.scope.close(); const after = ledger.snapshot(); assert.deepEqual(after.used.slice(0, 4), [0, 0, 0, 0]); assert(after.used[4] >= before.used[4]); assert(after.used[6] >= before.used[6]); }],
  ['G24', async () => { const value = fixture(); await publish(value, [0]); const ledger = requireArrays(value.state).owner.ledger; let work = ledger.snapshot().used[6]; for (let index = 0; index < 8; index++) { await publish(value, [index]); const next = ledger.snapshot().used[6]; assert(next > work); work = next; } assert.deepEqual(values(value), [[0, '7']]); }],
];
for (const [id, body] of groups) {
  openScopes = [];
  let timer;
  try { await Promise.race([body(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CASE DEADLINE SAFETY STOP')), 30000); })]); results.push({ id, status: 'PASS' }); }
  catch (error) { results.push({ id, status: 'FAIL', name: error?.name, message: error?.message ?? String(error) }); if (String(error).includes('SAFETY STOP')) throw error; }
  finally { clearTimeout(timer); for (const scope of openScopes) await scope.close(); }
}
for (const row of closure.values()) assert.equal(hash(read(row.path)), row.sha256);
fs.writeFileSync(path.join(own, 'PURE-RESULTS.json'), JSON.stringify({ groups: results, count: results.length, passed: results.filter(row => row.status === 'PASS').length, scopeClosuresAwaited: true, workers: 0, shellExecutions: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(results));
process.exitCode = results.some(row => row.status !== 'PASS') ? 1 : 0;
