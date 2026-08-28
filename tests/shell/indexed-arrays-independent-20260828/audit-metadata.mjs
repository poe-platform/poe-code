import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const original = '2cb939883a91b495bed7dadb8973cd1939b16e6a';
const addendum = 'abe53e03b654cd576dfa5f8f7a6cf435edc2b4d0';
const prefix = 'tests/shell/indexed-arrays-design-20260828/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const committed = (revision, path) => execFileSync('/usr/bin/git', ['show', `${revision}:${path}`], { cwd: repository, maxBuffer: 1024 * 1024 });
const manifestBytes = committed(addendum, prefix + 'native-preseal-v1/MANIFEST.json');
assert.equal(hash(manifestBytes), 'f731d304306b02d11df41b386d4528405ad307ca33098d25f1bc2a0193c0764f');
assert.deepEqual(readFileSync(resolve(repository, prefix + 'native-preseal-v1/MANIFEST.json')), manifestBytes);
const manifest = JSON.parse(manifestBytes);
const documents = [];
for (const entry of [...manifest.documents, ...manifest.preservedOriginals]) {
  const bytes = committed(addendum, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.deepEqual(readFileSync(resolve(repository, entry.path)), bytes, 'live design matches named committed bytes');
  if (manifest.preservedOriginals.includes(entry)) assert.deepEqual(bytes, committed(original, entry.path), 'original design preserved');
  documents.push({ path: entry.path, revision: addendum, bytes: bytes.length, sha256: hash(bytes), preservedOriginal: manifest.preservedOriginals.includes(entry) });
}
const binding = JSON.parse(committed(addendum, prefix + 'addendum-v1/SOURCE-BINDING.json'));
assert.equal(binding.acceptedComposition.base, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
assert.equal(binding.acceptedComposition.cd, '4641075df5355a91c83bf5b2cc3a88dfaf1f5153');
assert.equal(binding.acceptedComposition.let, 'c26892c3a1a419311c9cf46a6c2976e696e00624');
const sources = [];
for (const entry of binding.sources) {
  assert.match(entry.revision, /^[a-f0-9]{40}$/u);
  assert.equal(entry.revision, entry.path === 'src/shell/runtime.ts' ? binding.acceptedComposition.let : binding.acceptedComposition.base);
  const bytes = committed(entry.revision, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
  assert.equal(bytes.length, entry.bytes, entry.path);
  sources.push({ path: entry.path, revision: entry.revision, bytes: bytes.length, sha256: hash(bytes), role: 'authenticated source bytes, not executed or imported' });
}
const packet = JSON.parse(committed(addendum, prefix + 'native-preseal-v1/ROWS.json'));
assert.equal(packet.rows.length, 16);
assert.deepEqual(packet.rows.map(row => row.id), Array.from({ length: 16 }, (_, index) => `N${String(index + 1).padStart(2, '0')}`));
const rows = [];
for (const row of packet.rows) {
  const expected = manifest.rows.find(entry => entry.id === row.id);
  assert.ok(expected);
  assert.equal(row.nativeexpected, null);
  assert.equal(expected.nativeexpected, null);
  assert.equal(Buffer.byteLength(row.script), expected.scriptBytes);
  assert.equal(hash(Buffer.from(row.script)), expected.scriptSha256);
  assert.ok(expected.scriptBytes <= manifest.limits.perScriptBytes);
  assert.equal(row.nestedChildContextsUpperBound, expected.nestedChildContextsUpperBound);
  rows.push({ ...expected, result: 'unexecuted question; no native expectation or observation' });
}
const totalScriptBytes = rows.reduce((sum, row) => sum + row.scriptBytes, 0);
const nestedContexts = rows.reduce((sum, row) => sum + row.nestedChildContextsUpperBound, 0);
assert.equal(totalScriptBytes, 1783);
assert.ok(totalScriptBytes <= manifest.limits.totalScriptBytes);
assert.equal(nestedContexts, 2);
assert.equal(rows.length + nestedContexts, 18);
assert.equal(manifest.execution, 'NOT_AUTHORIZED');
const nativeFiles = [];
for (const name of ['binary', 'manual']) {
  const expected = manifest.nativeIdentity[name];
  try {
    const stat = lstatSync(expected.path);
    const bytes = readFileSync(expected.path);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(stat.mode & 0o777, expected.mode);
    assert.equal(hash(bytes), expected.sha256);
    nativeFiles.push({ role: name, path: expected.path, realpath: realpathSync(expected.path), bytes: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes), action: 'read/hash only; not invoked' });
  } catch (error) {
    nativeFiles.push({ role: name, path: expected.path, admission: 'blocked for a future run until identity is restored', error: String(error) });
  }
}
const caps = (bytes, fields) => ({ livePayload: bytes, liveMetadata: 128n * fields, allocatedBytes: 8n * bytes + 512n * fields, allocatedSlots: 8n * fields, work: 32n * bytes + 256n * fields });
const arithmeticOnly = Object.fromEntries(Object.entries({ example: caps(1024n, 16n), defaults: caps(16777216n, 10000n), zero: caps(0n, 0n) }).map(([name, value]) => [name, Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, String(amount)]))]));
const allocationTable = [
  { event: 'old', payload: 1 + 3 + 5, metadata: 64 + 64 + 2 * 64 + 3 * 32, sparseSlots: 2, cumulativeBytes: 361, cumulativeSlots: 2 },
  { event: 'append', payload: 16, metadata: 704, sparseSlots: 5, cumulativeBytes: 720, cumulativeSlots: 5 },
  { event: 'saved-local', payload: 16, metadata: 1024, sparseSlots: 7, cumulativeBytes: 1040, cumulativeSlots: 7 },
  { event: 'index-vector', payload: 16, metadata: 1184, sparseSlots: 7, cumulativeBytes: 1200, cumulativeSlots: 10 },
  { event: 'join', payload: 33, metadata: 1312, sparseSlots: 7, cumulativeBytes: 1345, cumulativeSlots: 11 },
  { event: 'index-release', payload: 33, metadata: 1152, sparseSlots: 7, cumulativeBytes: 1345, cumulativeSlots: 11 },
  { event: 'failed-stage-release', payload: 26, metadata: 800, sparseSlots: 4, cumulativeBytes: 1345, cumulativeSlots: 11 },
  { event: 'output-release', payload: 9, metadata: 672, sparseSlots: 4, cumulativeBytes: 1345, cumulativeSlots: 11 },
  { event: 'saved-local-release', payload: 9, metadata: 352, sparseSlots: 2, cumulativeBytes: 1345, cumulativeSlots: 11 },
];
assert.deepEqual([allocationTable[0].payload, allocationTable[0].metadata], [9, 352]);
assert.equal(704, 352 + 64 + 64 + 3 * 64 + 32);
assert.equal(1024, 704 + 64 + 64 + 64 + 2 * 64);
assert.equal(1184, 1024 + 64 + 3 * 32);
assert.equal(1312, 1184 + 64 + 32 + 32);
assert.equal(1345, 1200 + 128 + 17);
assert.equal(800, 1152 - (64 + 64 + 3 * 64 + 32));
assert.equal(672, 800 - 128);
assert.equal(352, 672 - (64 + 64 + 64 + 2 * 64));
console.log(JSON.stringify({
  kind: 'independent-indexed-array-static-design-review-v1', date: '2026-08-28', original, addendum,
  manifest: { path: prefix + 'native-preseal-v1/MANIFEST.json', sha256: hash(manifestBytes) },
  qualification: 'Only immutable Git reads, local file metadata/hash reads, JSON checks and bounded numeric arithmetic. No product/native oracle/parser/arithmetic engine/runtime imports, syntax checks, builds or tests.',
  documents, sources, rows, totalScriptBytes, nestedContexts, nativeFiles, arithmeticOnly,
  allocationTable: { qualification: 'static proposal arithmetic, not implementation or resource measurement; excludes work/cleanup simulation and two-vector sorting peak as author states', rows: allocationTable },
  executions: { native: 0, product: 0, productImports: 0, nativeSyntaxChecks: 0, builds: 0, parser: 0, arithmeticEngine: 0, tests: 0 },
  policyBoundary: 'new independent public Shell.exec is fresh; internal descendants/invoke share one invocation ledger; no cross-exec/RSS/hard-preemption claim',
}, null, 2));
