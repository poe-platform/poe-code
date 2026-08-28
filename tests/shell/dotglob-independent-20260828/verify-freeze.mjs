import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url)), repository = resolve(own, '../../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = name => JSON.parse(readFileSync(join(own, name)));
const bindings = json('BINDINGS.json'), seal = json('SEAL.json');
assert.deepEqual(readdirSync(own).sort(), [...Object.keys(seal), 'SEAL.json'].sort());
for (const [name, digest] of Object.entries(seal)) {
  const path = join(own, name); assert.ok(lstatSync(path).isFile()); assert.equal(lstatSync(path).isSymbolicLink(), false);
  assert.equal(hash(readFileSync(path)), digest, name); assert.ok(!name.includes('AGENTS'));
}
for (const entry of [...bindings.evidence, ...bindings.inspected]) {
  assert.match(entry.revision, /^[a-f0-9]{40}$/u);
  const bytes = execFileSync('/usr/bin/git', ['show', `${entry.revision}:${entry.path}`], { cwd: repository, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256, entry.path);
}
assert.equal(bindings.productExecutions, 0); assert.equal(bindings.nativeExecutions, 0);
assert.match(bindings.futureBinding.status, /^HELD/u); assert.deepEqual(bindings.futureBinding.productionAllowlist, ['src/shell/runtime.ts', 'src/shell/shell.ts']);
assert.equal(bindings.pendingDecision.id, 'GAP-TOKEN');
const commands = json('command-cases.json'), globs = json('glob-cases.json'), states = json('state-cases.json'), procedures = json('procedures.json'), fixtures = json('glob-fixtures.json');
for (const [rows, count] of [[commands, 102], [globs, 72], [states, 14], [procedures, 26]]) { assert.equal(rows.length, count); assert.equal(new Set(rows.map(row => row.id)).size, count); }
for (const row of commands) {
  assert.ok(['off', 'on'].includes(row.initial)); assert.ok(['off', 'on'].includes(row.postState)); assert.ok([0, 1, 2].includes(row.exitCode));
  assert.ok(row.args.every(value => typeof value === 'string' && !value.includes('\0'))); assert.ok(row.args.length <= 8);
  assert.equal(typeof row.stdout, 'string'); assert.equal(typeof row.stderr, 'string');
}
const plain = state => 'dotglob' + ' '.repeat(13) + '\t' + state + '\n';
assert.equal(Buffer.byteLength(plain('off')), 25); assert.equal(Buffer.byteLength(plain('on')), 24); assert.equal(Buffer.byteLength('shopt -u dotglob\n'), 17);
for (const state of ['off', 'on']) {
  const row = commands.find(row => row.initial === state && row.args.length === 0); assert.equal(row.stdout, plain(state)); assert.equal(row.exitCode, 0);
  const named = commands.find(row => row.initial === state && JSON.stringify(row.args) === '["dotglob"]'); assert.equal(named.stdout, plain(state)); assert.equal(named.exitCode, state === 'on' ? 0 : 1);
}
const unsupported = json('unsupported-names.json'); assert.equal(unsupported.names.length, 58); assert.equal(new Set(unsupported.names).size, 58);
assert.equal(unsupported.names.includes('dotglob'), false); assert.ok(unsupported.names.includes('expand_aliases')); assert.ok(unsupported.names.includes('globskipdots')); assert.equal(unsupported.modes.length, 6);
assert.deepEqual(unsupported.initialStates, ['off', 'on']); assert.equal(unsupported.expected.exitCode, 1);
const nativeEntry = bindings.evidence.find(row => row.path.endsWith('/EXACT-NATIVE-TUPLES.json'));
const native = JSON.parse(execFileSync('/usr/bin/git', ['show', `${nativeEntry.revision}:${nativeEntry.path}`], { cwd: repository, maxBuffer: 4 * 1024 * 1024 }));
assert.equal(native.summary.nativeCalls, 24); assert.equal(native.tuples.length, 72); assert.equal(native.summary.passCount, null);
const statuses = { 0: 0, 1: 0, 2: 0 }; for (const row of native.tuples) statuses[row.status]++;
assert.deepEqual(statuses, { 0: 43, 1: 27, 2: 2 });
assert.deepEqual(unsupported.names, native.tuples.find(row => row.id === '01-default:0').stdout.trimEnd().split('\n').map(line => line.split(/\s/u)[0]).filter(name => name !== 'dotglob'));
for (const row of globs) {
  assert.ok(Object.hasOwn(fixtures, row.fixture)); assert.ok(['off', 'on'].includes(row.state)); assert.ok(Array.isArray(row.expectedArgs));
  assert.ok(Buffer.byteLength(row.word) < 256); assert.ok(row.expectedArgs.length <= 128);
}
for (const state of ['off', 'on']) {
  const star = globs.find(row => row.fixture === 'basic' && row.word === '*' && row.state === state);
  assert.equal(star.expectedArgs.reduce((sum, value) => sum + Buffer.byteLength(value), 0), state === 'off' ? 14 : 31);
  assert.deepEqual(globs.find(row => row.fixture === 'dot-entries' && row.word === '.*' && row.state === state).expectedArgs, ['..keep', '.hidden']);
  assert.deepEqual(globs.find(row => row.fixture === 'dot-entries' && row.word === '.?' && row.state === state).expectedArgs, ['.?']);
  assert.deepEqual(globs.find(row => row.fixture === 'basic' && row.word === '.' && row.state === state).expectedArgs, ['.']);
  assert.deepEqual(globs.find(row => row.fixture === 'basic' && row.word === '..' && row.state === state).expectedArgs, ['..']);
}
for (const row of states) { assert.ok(Buffer.byteLength(row.script) <= 16384); assert.equal(row.exitCode, 0); assert.equal(row.stderr, ''); }
assert.ok(procedures.every(row => row.kind.includes('no execution')));
assert.ok(readFileSync(join(own, 'PROTOCOL.md'), 'utf8').includes('all-PASS then nonzero child exit'));
process.stdout.write(JSON.stringify({ verdict: 'precode data/provenance checks only', commandTuples: 102, unsupportedNameModeStateRows: 696, globVectors: 72, stateScripts: 14, syntheticProcedures: 26, futureBase: 'HELD for accepted STACK', byteDecision: 'GAP-TOKEN', inheritedNativeObservations: 72, inheritedNativePassCount: null, productExecutions: 0, nativeExecutions: 0, builds: 0, typeChecks: 0 }) + '\n');
