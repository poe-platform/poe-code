import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = '/Users/kjopek/Workspace/safe-bash';
const own = `${root}/tests/shell/pipestatus-independent-20260829`;
const author = `${root}/tests/shell/pipestatus-author-20260829/corrected-v2`;
const deadline = fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 1200000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitHash = (type, bytes) => crypto.createHash('sha1').update(Buffer.from(`${type} ${bytes.length}\0`)).update(bytes).digest('hex');
const auth = []; let readBytes = 0;
function guard() { assert.ok(Date.now() <= deadline, 'phase deadline'); }
function readBytesPin(file, pin, maximum = 4194304) {
  guard(); const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= maximum);
  const bytes = fs.readFileSync(file); readBytes += bytes.length; assert.ok(readBytes <= 67108864);
  assert.equal(bytes.length, stat.size); assert.equal(bytes.length, pin.bytes); assert.equal(sha(bytes), pin.sha256);
  const after = fs.lstatSync(file); assert.equal(after.ino, stat.ino); assert.equal(after.mtimeMs, stat.mtimeMs);
  auth.push({ path: file, bytes: bytes.length, mode: stat.mode & 511, sha256: pin.sha256 }); return bytes;
}
function fixturePin(row) { assert.ok(Number.isSafeInteger(row.size)); assert.equal(Object.hasOwn(row, 'bytes'), false); return { bytes: row.size, sha256: row.sha256 }; }
function save(name, value) { guard(); const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n'); const descriptor = fs.openSync(`${own}/${name}`, 'wx', 0o600); try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } return sha(bytes); }
const seal = JSON.parse(readBytesPin(`${author}/SEAL.json`, { bytes: 215132, sha256: 'c590f60ab8f53c5988056087257e2ed8564ef0db5e256ca4a7d836fa88fce718' }));
assert.equal(seal.sources.length, 307);
const treeRoot = new Map();
for (const row of seal.sources) {
  assert.ok(!row.path.split('/').includes('AGENTS.md'));
  const bytes = readBytesPin(path.join(seal.candidate, row.path), row);
  assert.equal(gitHash('blob', bytes), row.blob); assert.equal(fs.lstatSync(path.join(seal.candidate, row.path)).mode & 511, parseInt(row.mode.slice(-3), 8));
  const parts = row.path.split('/'); let tree = treeRoot;
  for (const part of parts.slice(0, -1)) { if (!tree.has(part)) tree.set(part, new Map()); tree = tree.get(part); }
  assert.ok(!tree.has(parts.at(-1))); tree.set(parts.at(-1), row);
}
function treeHash(tree) {
  const entries = [...tree].map(([name, value]) => ({ name, value, directory: value instanceof Map }));
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.directory ? '/' : '')), Buffer.from(right.name + (right.directory ? '/' : ''))));
  return gitHash('tree', Buffer.concat(entries.flatMap(entry => [Buffer.from(`${entry.directory ? '40000' : entry.value.mode} ${entry.name}\0`), Buffer.from(entry.directory ? treeHash(entry.value) : entry.value.blob, 'hex')])));
}
assert.equal(treeHash(treeRoot), '74fec4d4e26d9c0b2d27613c15af7a88cb56f628');
const changed = seal.sources.filter(row => row.blob !== row.baseBlob);
const privateContracts = seal.sources.filter(row => /src\/(?:contracts\/|index\.ts)|shell\/(?:shell|parser|arithmetic)\.ts|arrays\/(?:bindings|ledger|state)\.ts/.test(row.path));
for (const row of privateContracts) assert.equal(row.blob, row.baseBlob, `unchanged:${row.path}`);
assert.equal(seal.pins.B35.included, false); assert.equal(seal.pins.EREtransport.revision, '46611a5b67ad7af276154421ac7f50dd536ec570'); assert.equal(seal.pins.EREtransport.alternate4abbIncluded, false);
assert.equal(seal.pins.EREtransport.files.length, 7); for (const row of seal.pins.EREtransport.files) assert.equal(row.blob, row.baseBlob);
for (const row of seal.fixtures) { const bytes = readBytesPin(row.path, fixturePin(row)); assert.equal(fs.lstatSync(row.path).mode & 511, row.mode); if (row.path.endsWith('/host-protocols.ts')) save('host-protocols.ts.data', bytes); }
const closure = JSON.parse(readBytesPin(`${author}/LOADED-CLOSURE.json`, { bytes: 1027, sha256: 'd470219838507995d4dd902d87340014a4ed4b161ef200d8c49ed4e339291b9e' }));
assert.equal(closure.length, 5); const closureNames = new Set(closure.map(row => row.path));
for (const row of closure) {
  assert.ok(!/(?:runtime|parser|worker)\.js$|regex-execution/.test(row.path));
  const bytes = readBytesPin(row.path, row);
  for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/gu)) { assert.ok(match[1].startsWith('.')); assert.ok(closureNames.has(path.resolve(path.dirname(row.path), match[1]))); }
}
const pack = JSON.parse(readBytesPin(`${author}/PACKAGE.json`, { bytes: 197547, sha256: '55bfb3ac054fc7525a2127487ce90e42dd51e3c281561739e7d50113b6aa546c' }));
assert.equal(pack.count, 1010); assert.equal(pack.members.length, 1010); assert.equal(pack.sha256, '6c60e2d766fa675b7972afdc0eb6f5304f99231abceff1daf5cb196b897346a5');
readBytesPin(pack.path, fixturePin(pack), 16777216);
const nativeRecords = [];
for (const [filename, prefix] of [['typed6-tree.nul', 'tests/compatibility/bash-pipestatus-typed-native-reference-20260829/'], ['native26-tree.nul', 'tests/compatibility/bash-function-pipestatus-native-reference-20260829/v2/']]) {
  const treeBytes = fs.readFileSync(`${own}/raw/${filename}`);
  for (const entry of treeBytes.toString().split('\0').filter(Boolean)) {
    const [meta, relative] = entry.split('\t'); const [mode, type, blob, size] = meta.trim().split(/ +/);
    if (!relative.startsWith(prefix) || !(/\/(?:COHORT|OBSERVATIONS)\.json$/.test(relative) || /\/captures\/P(?:02|16|17|18)\/stdout(?:\.data)?$/.test(relative))) continue;
    assert.equal(type, 'blob'); const file = path.join(root, relative); const stat = fs.lstatSync(file); assert.ok(stat.isFile() && stat.size <= 1048576); const bytes = fs.readFileSync(file); assert.equal(bytes.length, Number(size)); assert.equal(gitHash('blob', bytes), blob);
    nativeRecords.push({ path: relative, blob, bytes: bytes.length, sha256: sha(bytes), data: relative.endsWith('.json') ? JSON.parse(bytes) : bytes.toString() });
  }
}
save('NATIVE-SOURCE-RECORDS.json', nativeRecords);
const runner = readBytesPin(`${author}/runner.mjs`, fixturePin(seal.fixtures.find(row => row.path.endsWith('/runner.mjs')))).toString();
const begin = runner.indexOf('const groups = ['); const end = runner.indexOf('\nfor (const [id, body] of groups)', begin);
assert.ok(begin >= 0 && end > begin); const groupBytes = Buffer.from(runner.slice(begin, end)); assert.equal(sha(groupBytes), seal.groupBodySha256);
save('author-groups.mjs.data', groupBytes);
const dist = `${seal.candidate}/dist`; const load = relative => import(pathToFileURL(`${dist}/${relative}`).href);
const { pipelineStatusTarget, publishPipelineStatus } = await load('shell/pipestatus.js');
const { trackState, arrayStore, requireArrays } = await load('shell/arrays/state.js');
const { IndexedBinding, textToken } = await load('shell/arrays/bindings.js');
const { InvocationScope } = await load('shell/cleanup.js');
let openScopes = []; let closedScopes = 0;
function fixture(options = {}) {
  const controller = new AbortController(); const scope = options.scope ?? new InvocationScope(controller.signal); if (!options.scope) openScopes.push(scope);
  const budget = options.budget ?? { limits: { maxExpansionBytes: options.bytes ?? 65536, maxExpansionFields: options.fields ?? 1000 } };
  const state = trackState({ cwd: '/', variables: Object.create(null), exported: new Set(), functions: new Map(), positional: [], status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false }, budget, scope);
  return { state, scope, budget, controller, signal: controller.signal };
}
const publish = (value, statuses) => publishPipelineStatus(value.state, statuses, value.signal, value.scope);
const values = value => [...(arrayStore(value.state)?.get('PIPESTATUS')?.values ?? [])].map(([index, element]) => [index, element.text.value]);
async function rejectsIdentity(promise, reason) { let rejected = false; try { await promise; } catch (error) { rejected = true; assert.equal(error, reason); } assert.ok(rejected); }
const testModule = Buffer.from(`export default (context) => { const {assert,fixture,publish,values,pipelineStatusTarget,arrayStore,requireArrays,textToken,rejectsIdentity}=context;\n${groupBytes.toString()}\nreturn groups; };`);
save('test-module.mjs.data', testModule);
const { default: authorGroups } = await import('data:text/javascript;base64,' + testModule.toString('base64'));
const groups = authorGroups({ assert, fixture, publish, values, pipelineStatusTarget, arrayStore, requireArrays, textToken, rejectsIdentity }); assert.equal(groups.length, 24);
const novel = [
  ['N01', async () => { const value = fixture(); await publish(value, [7]); for (const status of [-1, 256, NaN, 1.5]) { await assert.rejects(publish(value, [1, status]), TypeError); assert.deepEqual(values(value), [[0, '7']]); } }],
  ['N02', async () => { const value = fixture(); await publish(value, [7, 8]); await publish(value, []); assert.equal(pipelineStatusTarget(value.state), 'indexed'); assert.deepEqual(values(value), []); }],
  ['N03', async () => { const value = fixture(); await publish(value, [7]); const pending = publish(value, [1]); value.state.cwd = '/changed'; await assert.rejects(pending, /stale/); assert.deepEqual(values(value), [[0, '7']]); }],
  ['N04', async () => { const value = fixture(); await publish(value, [7]); const pending = publish(value, [1]); value.state.locals.push(new Map()); await assert.rejects(pending, /stale/); assert.deepEqual(values(value), [[0, '7']]); }],
  ['N05', async () => { const value = fixture(); await publish(value, [7]); const pending = publish(value, [1]); value.state.exported.add('OTHER'); await assert.rejects(pending, /stale/); assert.deepEqual(values(value), [[0, '7']]); }],
  ['N06', async () => { const value = fixture(); await publish(value, [7]); const pending = publish(value, [1, 2]); const closing = value.scope.close(); await assert.rejects(pending); await closing; }],
  ['N07', async () => { const value = fixture(); await publish(value, [7]); const pending = publish(value, [1]); value.state.cwd = '/changed'; value.controller.abort(0); await rejectsIdentity(pending, 0); assert.deepEqual(values(value), [[0, '7']]); }],
  ['N08', async () => { const value = fixture(); await publish(value, [7]); value.state.readonlyVariables = new Set(['PIPESTATUS']); const pending = publish(value, [1]); value.state.variables.OTHER = ''; await assert.rejects(pending, /stale/); assert.deepEqual(values(value), [[0, '7']]); assert.ok(value.state.readonlyVariables.has('PIPESTATUS')); }],
  ['N09', async () => { const value = fixture(); await publish(value, [7]); const ledger = requireArrays(value.state).owner.ledger; const before = ledger.snapshot().used[6]; await assert.rejects(publish(value, [1, 2, 256])); assert.ok(ledger.snapshot().used[6] > before); await value.scope.close(); assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]); }],
  ['N10', async () => { const value = fixture(); await publish(value, [7]); const outcomes = await Promise.allSettled([publish(value, [1]), publish(value, [2])]); assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1); const winner = outcomes.findIndex(row => row.status === 'fulfilled') + 1; assert.deepEqual(values(value), [[0, String(winner)]]); }],
  ['N11', async () => { for (const kind of ['scalar', 'readonly']) { const value = fixture(); if (kind === 'scalar') value.state.variables.PIPESTATUS = ''; else value.state.readonlyVariables = new Set(['PIPESTATUS']); value.controller.abort(false); await rejectsIdentity(publish(value, [0]), false); assert.equal(arrayStore(value.state), undefined); } }],
  ['N12', async () => { const parent = fixture(); await publish(parent, [7]); const childScope = parent.scope.child(); const child = fixture({ budget: parent.budget, scope: childScope }); const ledger = requireArrays(parent.state).owner.ledger; const before = ledger.snapshot().used[6]; await publish(child, [1]); await childScope.close(); assert.ok(ledger.snapshot().used[6] > before); await publish(parent, [2]); assert.deepEqual(values(parent), [[0, '2']]); }],
];
const results = [];
for (const [id, body] of [...groups, ...novel]) {
  guard(); openScopes = []; let timer; let safety = false;
  try { await Promise.race([body(), new Promise((_, reject) => { timer = setTimeout(() => { safety = true; reject(Error('PURE_CASE_DEADLINE')); }, 10000); })]); results.push({ id, status: 'PASS' }); }
  catch (error) { results.push({ id, status: 'FAIL', name: error?.name, message: error?.message }); if (safety) throw error; }
  finally { clearTimeout(timer); for (const scope of openScopes) { await scope.close(); closedScopes++; } }
}
for (const row of closure) readBytesPin(row.path, row);
save('AUTH-v2.json', auth);
save('SOURCE-ADMISSION-v2.json', { sourceCount: 307, derivedTree: treeHash(treeRoot), changed, unchangedPrivateContracts: privateContracts, pins: seal.pins, closure, groupBodySha256: sha(groupBytes), package: { path: pack.path, bytes: pack.size, sha256: pack.sha256, members: pack.count, manualOnly: true, installedOrMoved: false }, nativeRecords: nativeRecords.map(({ data, ...rest }) => rest) });
const result = { at: new Date().toISOString(), deadline, author: results.slice(0, 24), novel: results.slice(24), passed: results.filter(row => row.status === 'PASS').length, total: 36, closedScopes, sourceCount: 307, derivedTree: seal.projectionTree, productPublicExec: 0, Workers: 0, native: 0, compiler: 0, correctedReviewerPinRole: 'fixtures.size only; source/closure.bytes strict', originalReviewerSchemaRefusalPreserved: true };
const resultSha256 = save('PURE-RESULTS-v2.json', result); console.log(JSON.stringify({ ...result, resultSha256 }, null, 2));
if (result.passed !== 36) process.exitCode = 1;
