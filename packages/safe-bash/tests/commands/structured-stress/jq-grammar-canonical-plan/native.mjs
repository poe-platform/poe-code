import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { platform, release, arch } from 'node:os';
import { root, owned, stress, author, review, digest, read, json, artifact, tree, key } from './common.mjs';

const startedAt = new Date().toISOString();
const audit = json(`${review}/audit.json`);
const prior = json(`${review}/native-review.json`);
const additional = json(`${author}/additional-test-only-proposal.json`);
const originals = [...json(`${author}/canonical-before.json`).snapshots, ...additional.snapshots];
for (const snapshot of originals) assert.equal(digest(read(snapshot.path)), snapshot.sha256, snapshot.path);
const immutablePaths = [author, review, `${stress}/jq-grammar-independent`, `${stress}/jq-42-independent-review`, `${stress}/independent-increment`];
const immutableBefore = immutablePaths.map(tree);
const inputs = [...new Set([...originals.map(item => item.path), 'tests/commands/structured/helpers.ts', `${stress}/harness.ts`, `${stress}/raw-input-native.json`, `${stress}/join-native.json`])];
const canonicalBefore = Object.fromEntries(inputs.map(path => [path, digest(readFileSync(resolve(root, path)))]));
const rows = audit.rows.map(row => ({
  number: row.number, oldTestName: row.oldTestName, newTestName: row.proposedReviewedName,
  path: row.path, classification: row.classification, historicalBaseline: row.baseline,
  schedule: row.retainedSchedules,
  constituents: row.constituents.map(item => {
    const proofId = item.proofInputHex === item.actualInput.inputHex ? item.id : `${item.id}-actual-default-input`;
    const proof = prior.results.filter(result => result.id === proofId && key(result) === key(item.actualInput));
    assert.equal(proof.length, 1, item.id);
    assert.deepEqual(proof[0].actual, item.expected);
    return { id: item.id, ...item.actualInput, expected: item.expected, schedule: item.schedules,
      proof: { path: `${review}/native-review.json`, sha256: digest(read(`${review}/native-review.json`)), id: proof[0].id, route: proof[0].route },
      originalProofInputHex: item.proofInputHex, helperDefaultCorrected: item.proofInputHex !== item.actualInput.inputHex };
  }),
}));
for (const proposal of additional.proposal.slice(0, 3)) {
  const proof = proposal.nativeProof;
  rows.push({ number: rows.length + 1, oldTestName: proposal.oldTestName,
    newTestName: proposal.oldTestName === 'split rejects out-of-scope arity: split' ? 'split rejects undefined native arity: split' : proposal.oldTestName,
    path: proposal.oldTestPath, classification: 'additional-native-compiler-diagnostic',
    schedule: { executions: 1, ...(proof.id === 'canonical-split-zero' ? { timeoutMs: 3000, inputAcquisitionMustRemainFalse: true, inputKind: 'throwing iterator; native empty stdin is compiler-only control' } : { inputKind: 'literal input' }) },
    constituents: [{ id: proof.id, argv: proof.argv, inputHex: proof.inputHex, files: {}, expected: proof.expected,
      proof: { path: resolve(root, author, proof.artifact).slice(root.length + 1), sha256: proof.artifactSha256, id: proof.id, vectorSha256: proof.vectorSha256 } }],
  });
}
assert.equal(rows.length, 29);
assert.equal(rows.flatMap(row => row.constituents).filter(item => item.helperDefaultCorrected).length, 6);
for (const row of rows) for (const item of row.constituents) assert.equal(digest(read(item.proof.path)), item.proof.sha256);
const vectors = [];
for (const row of rows) for (const item of row.constituents) {
  const found = vectors.find(vector => key(vector) === key(item));
  if (found) { assert.deepEqual(found.expected, item.expected); found.ids.push(item.id); }
  else vectors.push({ ids: [item.id], argv: item.argv, inputHex: item.inputHex, files: item.files, expected: item.expected });
}
const executable = '/usr/bin/jq';
const executableSha256 = digest(readFileSync(executable));
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1' };
artifact('native-cwd/.keep', 'Isolated native-only cwd; no product execution.\n');
const cwd = resolve(root, owned, 'native-cwd');
const beforeCwd = tree(`${owned}/native-cwd`);
const filesBefore = tree(`${author}/native-files`);
const literalFileInventory = Object.entries(filesBefore.entries).filter(([, info]) => info.kind === 'file').map(([path, info]) => ({ path, ...info, hex: readFileSync(resolve(root, author, 'native-files', path)).toString('hex') }));
function invoke(argv, inputHex, workingDirectory = cwd) {
  const result = spawnSync(executable, argv, { cwd: workingDirectory, env: environment, shell: false, input: Buffer.from(inputHex, 'hex'), timeout: 5000, maxBuffer: 256 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { argv, inputHex, cwd: workingDirectory, status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
}
const version = invoke(['--version'], '');
const build = invoke(['--build-configuration'], '');
const results = [];
for (const vector of vectors) {
  const fileEntries = Object.entries(vector.files);
  if (fileEntries.length) {
    assert.deepEqual(fileEntries, [['unicode-start', 'f09f']]);
    const match = literalFileInventory.find(entry => entry.path === 'unicode-start' && entry.hex === 'f09f');
    if (!match) {
      results.push({ ...vector, executed: false, reason: 'Required literal unicode-start (f09f) absent in immutable author/native-files; no fd substitution or fixture creation.', exactByteCandidates: literalFileInventory.filter(entry => entry.hex === 'f09f').map(entry => entry.path) });
      continue;
    }
  }
  const first = invoke(vector.argv, vector.inputHex, fileEntries.length ? resolve(root, author, 'native-files') : cwd);
  const second = invoke(vector.argv, vector.inputHex, first.cwd);
  assert.deepEqual(first, second);
  const actual = { status: first.status, stdoutHex: first.stdoutHex, stderrHex: first.stderrHex };
  assert.deepEqual(actual, vector.expected, vector.ids.join(','));
  results.push({ ...vector, executed: true, first, second, matchesFrozen: true });
}
assert.deepEqual(tree(`${owned}/native-cwd`), beforeCwd);
assert.deepEqual(tree(`${author}/native-files`), filesBefore);
assert.deepEqual(immutablePaths.map(tree), immutableBefore);
assert.deepEqual(Object.fromEntries(inputs.map(path => [path, digest(readFileSync(resolve(root, path)))])), canonicalBefore);
assert.equal(digest(readFileSync(executable)), executableSha256);
artifact('inputs-before.json', { immutableBefore, canonicalBefore });
artifact('native-v3.json', { startedAt, endedAt: new Date().toISOString(), executable, executableSha256, environment,
  host: { platform: platform(), release: release(), arch: arch(), node: process.version }, version, build,
  captureSha256: digest(read(`${owned}/native.mjs`)), timeoutMs: 5000, maxBuffer: 256 * 1024,
  invocations: 2 + results.filter(result => result.executed).length * 2, results,
  beforeCwd, afterCwd: tree(`${owned}/native-cwd`), literalFileInventory, filesBefore, filesAfter: tree(`${author}/native-files`),
  provenance: ['freeze-files.mjs', 'artifacts.mjs'].map(path => ({ path: `${author}/${path}`, sha256: digest(read(`${author}/${path}`)) })),
  limits: 'No product imports, source certification, VFS effects, actual product chunks, cancellation, resource or shell guarantees. Two unavailable literal-file checks remain a blocker, not fd parity.' });
artifact('row-map-v3.json', { version: 3, applied: false, rows });
artifact('host-row-v3.json', { version: 3, applied: false, conditional: true,
  authority: 'Source reviewer must decide host JqError sink-identity contract; no native proof and no assumption that old assertion is stale.',
  row: { ...additional.proposal[3], newTestName: additional.proposal[3].oldTestName,
    schedule: { selectedJqErrorExecutions: 1, sharedLoopEpipeControlExecutions: 1, writes: 1, reads: 1, closed: true, proposedStderrWrites: 0 }, nativeProof: null } });
console.log(JSON.stringify({ rows: rows.length, constituents: rows.flatMap(row => row.constituents).length, uniqueInputs: vectors.length, invoked: results.filter(result => result.executed).length, unavailableLiteralFiles: results.filter(result => !result.executed).length }));
