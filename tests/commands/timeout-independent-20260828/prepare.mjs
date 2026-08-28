import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactRationalDuration, materialize, maximumMilliseconds, unitMilliseconds } from './oracle.mjs';
import { families } from './families.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), repository = resolve(scope, '../../..');
const prefix = relative(repository, scope), packet = 'tests/commands/timeout-design-independent-20260827/command-freeze-packet-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('/usr/bin/git', ['--no-replace-objects', '--no-optional-locks', '-C', repository, ...args], { timeout: 15000, maxBuffer: 16 * 1024 ** 2 });
const references = [];
function bind(commit, path, expected) {
  assert.ok(!path.split('/').includes('AGENTS.md'));
  const bytes = git('show', `${commit}:${path}`), sha256 = hash(bytes);
  if (expected) assert.equal(sha256, expected, path);
  const target = join(repository, path); assert.ok(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink());
  assert.equal(hash(fs.readFileSync(target)), sha256, path);
  const row = { commit, path, bytes: bytes.length, sha256 }; references.push(row); return row;
}
function artifact(name, value) {
  assert.equal(fs.existsSync(join(scope, name)), false);
  const content = JSON.stringify(value, null, 2);
  execFileSync('apply_patch', [`*** Begin Patch\n*** Add File: ${prefix}/${name}\n${content.split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`], { cwd: repository });
}
const packetCommit = '257bf6d7fe51b03c224fbca7e91519e692bfadd3';
const clarificationCommit = 'a0c6adaecad2665ea65eedb7b07dc6ade5f209c0';
for (const name of ['README.md', 'api.json', 'profile.json', 'diagnostics.data', 'freeze-delta.json', 'identity.json']) bind(packetCommit, `${packet}/${name}`, name === 'README.md' ? 'e050a86f9e1ee14f5f842d49ef99cd11b4b9decfcd1223d429b287c82444ecef' : undefined);
for (const name of ['README.md', 'parser-bound.json', 'identity.json']) bind(clarificationCommit, `${packet}/parser-bound-clarification-v1/${name}`);
const identity = JSON.parse(fs.readFileSync(join(repository, packet, 'identity.json')));
for (const [path, row] of Object.entries(identity.priorDesign.files)) bind(identity.priorDesign.commit, path, row.sha256);
for (const [name, row] of Object.entries(identity.approvedPrecodeProfile.files)) bind(identity.approvedPrecodeProfile.commit, `${identity.approvedPrecodeProfile.directory}/${name}`, row.sha256);
const stageCommit = git('rev-parse', '7ca45f2d').toString().trim();
for (const name of ['REPORT.md', 'REVIEW.json']) bind(stageCommit, `tests/shell/cancellation-stage2-independent-20260827/review-fd1/${name}`);
const sourceDeclarations = ['src/contracts/command.ts', 'src/shell/types.ts'].map(path => ({ commit: 'fd1daa123298568546d9ea4e95f8c81dde9c52ff', path, sha256: hash(git('show', `fd1daa123298568546d9ea4e95f8c81dde9c52ff:${path}`)), scope: 'declaration inspection only, not whole-fd1 product acceptance' }));
const api = JSON.parse(fs.readFileSync(join(repository, packet, 'api.json')));
assert.equal(api.newExports.length, 6); assert.equal(api.runtimeInvokerSelection.presentUndefined, 'malformed present hook; invoke-unavailable status 125; no fallback');
const diagnostics = fs.readFileSync(join(repository, packet, 'diagnostics.data'), 'utf8').trim().split('\n').filter(line => !line.startsWith('#')).map(line => {
  const [label, status, stream, count, base64] = line.split('\t'), bytes = Buffer.from(base64, 'base64'); assert.equal(bytes.length, Number(count));
  return { label, status: Number(status), stream, bytes: bytes.length, sha256: hash(bytes), source: `${packet}/diagnostics.data` };
});
assert.equal(diagnostics.length, 14);
const vectors = [];
function vector(group, input, expected) {
  const text = materialize(input), result = exactRationalDuration(text);
  if (expected) assert.deepEqual(result, expected);
  vectors.push({ id: `D${String(vectors.length + 1).padStart(3, '0')}`, group, input, codeUnits: text.length, utf8Bytes: Buffer.byteLength(text), sha256: hash(text), expected: result, route: ['--', '<materialized input>', 'fixture-status', '7'] });
}
for (const input of ['', '.', '.s', 's', '1..0', '1ss', '1S', ' 1', '1 ', '\t1', '1\n', '-1', '+1', '1e0', '0x1p0d', 'NaN', 'Infinity', '1,5', '١', '１', '1\u0000', '999999999999999999999999999x', '999999999999999999999999999.1.2d']) vector('grammar', input, { kind: 'invalid-duration' });
for (const input of ['0', '000', '0.', '.0', '0.000d', '1', '1s', '1m', '1h', '1d', '.001s', '.5m', '.5h', '.5d', '1.0001', '.00001m', '.0000001d', '1.00000000001m', '.999999999999999999999d', '1.999999999999999999999d']) vector(input.startsWith('1.9') || input.startsWith('.99') ? 'carry' : 'ordinary', input);
for (const input of ['9007199254740.990s', '9007199254740.991s', '9007199254740.9910s', '9007199254740.9911s', '9007199254741s']) vector('maximum', input);
for (const unit of ['m', 'h', 'd']) {
  const scale = 10n ** 18n, below = maximumMilliseconds * scale / unitMilliseconds[unit];
  for (const value of [below, below + 1n]) {
    const digits = value.toString().padStart(19, '0'), input = `${digits.slice(0, -18)}.${digits.slice(-18)}${unit}`;
    vector('maximum', input, value === below ? { kind: 'milliseconds', value: maximumMilliseconds.toString() } : { kind: 'duration-overflow' });
  }
}
for (const count of [0, 1, 31, 4096, 65536]) {
  vector('long', { prefix: '', repeat: '0', count, suffix: '0d' }, { kind: 'milliseconds', value: '0' });
  vector('long', { prefix: '.', repeat: '0', count: count + (count === 65536 ? 0 : 3), suffix: '1s' }, { kind: 'milliseconds', value: '1' });
  vector('long', { prefix: '', repeat: '0', count, suffix: '1.001s' }, { kind: 'milliseconds', value: '1001' });
}
vector('long', { prefix: '', repeat: '9', count: 65536, suffix: 'x' }, { kind: 'invalid-duration' });
artifact('NUMERIC.json', { schema: 'timeout-independent-numeric-freeze/1', chronology: 'before declared timeout implementation', devOracleOnly: true, productIntegerAlgorithmNotImplemented: true, productTokenCap: null, vectorCount: vectors.length, vectors });
const matrix = JSON.parse(fs.readFileSync(join(repository, identity.approvedPrecodeProfile.directory, 'freeze-matrix.json')));
assert.equal(matrix.nativeRows.length, 12); assert.equal(matrix.virtualRows.length, 33);
function executable(path, expected) {
  const actual = resolve(repository, path), stat = fs.lstatSync(actual); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const digest = hash(fs.readFileSync(actual)); if (expected) assert.equal(digest, expected);
  return { path: actual, realpath: fs.realpathSync(actual), mode: stat.mode & 0o777, bytes: stat.size, sha256: digest, executed: false };
}
const oracle = executable(identity.gnuOracle.binary.path, '36fc11afeb227c7ea50054de958b80de954088139f1d5ef4c03df95ef811a55e');
const shell = executable('/bin/sh');
const nativeRows = matrix.nativeRows.map(row => ({ id: row.id, reference: `${identity.approvedPrecodeProfile.directory}/freeze-matrix.json#${row.id}`, argv: row.argv, cwd: join(scope, 'native-execution-01', row.id), raw: Object.fromEntries(['stdout.data', 'stderr.data', 'status.json', 'timing.json', 'cleanup.json'].map(name => [name, join(scope, 'native-execution-01', row.id, name)])), sourceSupportedExpectation: row.sourceSupportedExpectation ?? null, classification: row.classification ?? row.class, execution: 'HELD-NOT-RUN', outputOracleQualification: ['N01', 'N02'].includes(row.id) ? 'prior actual stdout not available here; capture and classify separately, never synthesize' : 'source-supported status only; full raw output required, no uncaptured exact native output invented' }));
artifact('NATIVE.json', { schema: 'timeout-independent-native-prospective/1', status: 'HELD-future-explicit-capture-authorization', productProfileIdentityIsNotGNU: true, oracle, shell, environment: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', PATH: '/usr/bin:/bin' }, rows: nativeRows, fixtureNoexec: { pathWithinN06: 'fixture-noexec', mode: 0o644, utf8: 'timeout independent non-executable fixture\n', sha256: hash('timeout independent non-executable fixture\n') }, cleanup: { registerBeforeLaunch: true, eachChildExitAndPipeCloseRequired: true, naturalResourceClosureRequired: true, outerWatchdogMilliseconds: 10000, watchdogIsFailureNotTimeoutPass: true, forcedCleanupReportedSeparately: true, processGroupOwnershipBoundBeforeLaunch: true }, remaining: ['sealed native supervisor and exact runtime/tool/helper load bindings', 'root explicit execution authorization'], nativeRowsExecuted: 0, parityClaim: false });
artifact('BINDINGS.json', { schema: 'timeout-independent-precode-binding/1', at: new Date().toISOString(), packetCommit, clarificationCommit, references, sourceDeclarations, diagnostics, stage2: { acceptedByRoot: true, reviewCommit: stageCommit, scopedSyntheticNotWholeFd1: true, actualSafeJsFollowup: 'pending in root handoff; not verified by this freeze' }, duCheckpoint: '83645ad032238edb6d0887ae445c3b8c9d7c7f2a', tools: [executable(process.execPath), executable('/usr/bin/git')], originalRows: { virtual: 33, native: 12, modified: 0 }, independentFamilies: families.length, implementationCandidate: null, productExecuted: 0, nativeExecuted: 0, authorImplementationRelease: 'root required after freeze', semanticClarificationsRequired: [], futureExecutionBindings: ['exact candidate and selected module/source paths', 'accepted actual Shell reconstruction and supervisor/compiler/loads', 'native supervisor release separately'] });
console.log(JSON.stringify({ references: references.length, families: families.length, numericVectors: vectors.length, diagnostics: diagnostics.length, nativeRows: nativeRows.length, productExecuted: 0, nativeExecuted: 0 }));
