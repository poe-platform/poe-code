import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const own = '/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/corrected-v2';
const work = '/private/tmp/safe-bash-pipestatus-corrected';
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

await (async () => {

const repo = '/Users/kjopek/Workspace/safe-bash';
const own = '/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/corrected-v2';
const work = '/private/tmp/safe-bash-pipestatus-corrected';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename, maximum = 4 * 1024 * 1024) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > maximum) throw new Error(`regular/size admission ${filename}`);
  const content = fs.readFileSync(filename);
  if (content.length !== stat.size) throw new Error('read size changed');
  return content;
}
function streamBinding(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('binding admission');
  const digest = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536);
  const descriptor = fs.openSync(filename, 'r'); let total = 0;
  try { for (;;) { const count = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (!count) break; total += count; digest.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(descriptor); }
  if (total !== stat.size) throw new Error('binding size drift');
  return { path: filename, size: total, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
const save = (name, value) => fs.writeFileSync(path.join(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sealBytes = read(path.join(own, 'SEAL.json'));
const seal = JSON.parse(sealBytes);
for (const row of seal.sources) {
  const content = read(path.join(seal.candidate, row.path));
  if (content.length !== row.bytes || hash(content) !== row.sha256) throw new Error('original candidate drift');
}
for (const row of seal.tools) {
  const actual = streamBinding(row.path);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error('tool drift');
}
const files = [];
function collect(directory, relative) {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name); const next = relative + '/' + name;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) collect(absolute, next);
    else {
      if (!stat.isFile()) throw new Error('nonregular build member');
      if (name.startsWith('pipestatus-proof-types.') || name.startsWith('pipestatus-host-proof.')) continue;
      files.push({ relative: next, absolute, content: read(absolute), mode: stat.mode & 0o777 });
    }
  }
}
collect(path.join(seal.candidate, 'dist'), 'package/dist');
for (const name of ['README.md', 'package.json']) files.push({ relative: 'package/' + name, absolute: path.join(seal.candidate, name), content: read(path.join(seal.candidate, name)), mode: 0o644 });
files.sort((left, right) => Buffer.compare(Buffer.from(left.relative), Buffer.from(right.relative)));
if (files.reduce((total, row) => total + row.content.length, 0) > 32 * 1024 * 1024) throw new Error('package decoded bound');
const pieces = [];
for (const row of files) {
  const header = Buffer.alloc(512);
  const encoded = Buffer.from(row.relative);
  if (encoded.length > 100) {
    const split = row.relative.lastIndexOf('/');
    const prefix = Buffer.from(row.relative.slice(0, split)); const suffix = Buffer.from(row.relative.slice(split + 1));
    if (prefix.length > 155 || suffix.length > 100) throw new Error('ustar pathname capacity');
    suffix.copy(header, 0); prefix.copy(header, 345);
  } else encoded.copy(header);
  const octal = (offset, length, value) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
  octal(100, 8, row.mode); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, row.content.length); octal(136, 12, 0);
  header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257, 'ascii'); header.write('00', 263, 'ascii');
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  pieces.push(header, row.content, Buffer.alloc((512 - row.content.length % 512) % 512));
}
pieces.push(Buffer.alloc(1024));
const tar = Buffer.concat(pieces);
const compressed = zlib.gzipSync(tar);
if (compressed.length > 16 * 1024 * 1024) throw new Error('compressed package bound');
const packagePath = path.join(own, 'corrected-build-artifact.tgz');
fs.writeFileSync(packagePath, compressed, { flag: 'wx' });
const packageBinding = streamBinding(packagePath);
save('PACKAGE.json', { ...packageBinding, kind: 'manual USTAR/gzip original strict-build artifact projection; NOT npm-produced/installed acceptance', originalSeal: hash(sealBytes), members: files.map(row => ({ path: row.relative, size: row.content.length, mode: row.mode, sha256: hash(row.content) })), count: files.length, tarBytes: tar.length, compressedAdmittedBeforeAnyFutureInflation: true, noInflationPerformed: true, validationOnlyDeclarationsExcluded: true, correctedG18SourceIncluded: true });
const corrected = streamBinding(path.join(seal.candidate, 'src/shell/pipestatus.ts'));
const original = seal.sources.find(row => row.path === 'src/shell/pipestatus.ts');
save('SOURCE-SUCCESSOR.json', { originalSourceSeal: hash(sealBytes), unchangedRuntime: streamBinding(path.join(seal.candidate, 'src/shell/runtime.ts')), originalHelper: original, correctedHelper: corrected, strictBuildOfCorrection: 'see BUILD.json', pureCorrectionReplay: 'see PURE-RESULTS.json', expectedSourceCount: 307 });
const oldMatrix = path.join(repo, 'tests/compatibility/bash-surface-next-gaps-design-20260829/PROOF-MATRIX.json');
const oldBytes = read(oldMatrix);
JSON.parse(oldBytes);
fs.writeFileSync(path.join(own, 'legacy-32.data.json'), oldBytes, { flag: 'wx' });
save('LEGACY-BINDING.json', streamBinding(oldMatrix));
const result = JSON.parse(read(path.join(own, 'PURE-RESULTS.json')));
const build = JSON.parse(read(path.join(own, 'BUILD.json')));
const roles = read(path.join(work, 'roles.log')).toString('utf8').trimEnd().split('\n');
let scratchBytes = 0; let scratchFiles = 0;
function census(root) {
  for (const name of fs.readdirSync(root)) {
    const filename = path.join(root, name); const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) census(filename);
    else { if (!stat.isFile()) throw new Error('owned scratch nonregular'); scratchBytes += stat.size; scratchFiles++; }
  }
}
census(work);
if (scratchBytes > 256 * 1024 * 1024 || roles.length > 36) throw new Error('phase resource stop');
save('PUBLICATION.json', { date: '2026-08-29', build, pure: { passed: result.passed, count: result.count, failed: result.groups.filter(row => row.status !== 'PASS') }, rolesObservedThroughThisSnapshot: roles, knownStartsThroughSnapshot: roles.length, scratchBytes, scratchFiles, peakKnownProcesses: 3, topology: 'controller shell -> Node helper -> synchronous Git or compiler; tests sequential with zero process starts', finalAdministrativeRolesNotYetIncluded: 'subsequent explicit Git/documentation/publication roles must be appended separately', sourceCount: seal.count, package: { sha256: packageBinding.sha256, bytes: packageBinding.size, members: files.length }, workers: 0, shellExecutions: 0, nativeExecutions: 0, compiledCorrection: true });
console.log(JSON.stringify({ sourceCount: seal.count, packageMembers: files.length, packageSha256: packageBinding.sha256, passed: result.passed, failed: result.count - result.passed, scratchBytes, knownStarts: roles.length, correctedSourceUncompiled: false }));

})();
