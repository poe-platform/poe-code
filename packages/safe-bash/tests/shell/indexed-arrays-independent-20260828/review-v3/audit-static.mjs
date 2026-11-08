import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = resolve(directory, '../../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const committed = (revision, path) => execFileSync('/usr/bin/git', ['show', `${revision}:${path}`], {
  cwd: repository, maxBuffer: 1024 * 1024, timeout: 5000
});
const bindings = [
  { revision: 'c54db6863aa96c537778cf4dc85bd104a3155e90', path: 'tests/shell/indexed-arrays-design-20260828/addendum-v3/DECISIONS.md', bytes: 36965, sha256: '0f5f07b550d4f1695dfe5df42da5ff9a3cb6bc22f1b20fede04049989666e9b8' },
  { revision: 'c54db6863aa96c537778cf4dc85bd104a3155e90', path: 'tests/shell/indexed-arrays-design-20260828/addendum-v3/PEAK.json', bytes: 4974, sha256: '79e72a3a9900330470d60b8dc6c23d14bc6fd3fd2da45e56cfc0cded6bd85b74' },
  { revision: 'd4f3d9f91a8549ebdd3a222fbac04d379c6ce770', path: 'tests/shell/indexed-arrays-native-review-20260828/REPORT.md', bytes: 27289, sha256: 'fe6f5093e16bfbc819d8c0a60e3668310a074bf433d9160603eb766a178dcf06' },
  { revision: 'c26892c3a1a419311c9cf46a6c2976e696e00624', path: 'src/shell/runtime.ts', bytes: 139761, sha256: 'eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193' },
  { revision: '5137a74ec855a32d8a8860eb66b62eb44d11e290', path: 'src/shell/parser.ts', bytes: 36304, sha256: '10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e' },
  { revision: 'd2502aae3c8458e0ac92662f2af07e7f9fc3923a', path: 'src/shell/runtime.ts', bytes: 154603, sha256: '100361256ee71d7a263c92fa607de31ec1d3be9b1fb5c601b337c19e700ac4b3' }
];
const buffers = bindings.map(binding => {
  const bytes = committed(binding.revision, binding.path);
  assert.equal(bytes.length, binding.bytes, binding.path);
  assert.equal(digest(bytes), binding.sha256, binding.path);
  return bytes;
});
const sections = [
  { start: '    let value = part.name === "?"', end: '  async substring(', bytes: 1699, sha256: '47f4ca2164b96f2a87ff70aeda5a8a69b0a281f7d1198dc3855b33b85d80c59b' },
  { start: '  async substring(', end: '  async parameterPattern(', bytes: 2782, sha256: '15caea11bf9c2e157c6e3be4613179e01703055cf1e80c6004eff39a1cb90e0b' },
  { start: '  async parameterPattern(', end: '  async word(', bytes: 3755, sha256: '079daf660cd6bc1cb42fde9ea80d206a560d33c840aeaba71e4530b828056ea0' }
];
const slice = (buffer, section) => {
  const text = buffer.toString('utf8');
  const start = text.indexOf(section.start);
  const end = text.indexOf(section.end, start + section.start.length);
  assert.ok(start >= 0 && end > start, 'unique bounded source section');
  assert.equal(text.indexOf(section.start, start + section.start.length), -1);
  return Buffer.from(text.slice(start, end));
};
for (const section of sections) {
  const before = slice(buffers[3], section);
  const after = slice(buffers[5], section);
  assert.deepEqual(after, before);
  assert.equal(before.length, section.bytes);
  assert.equal(digest(before), section.sha256);
}

const peak = JSON.parse(buffers[1]);
const sum = values => values.reduce((total, value) => {
  assert.ok(Number.isSafeInteger(value) && value >= 0);
  return total + BigInt(value);
}, 0n);
const totals = {};
for (const field of ['objects', 'metadata', 'payload', 'mapSlots', 'vectorSlots']) {
  totals[field] = sum(peak.storage.map(row => row[field]));
  assert.equal(totals[field], BigInt(peak.expected[field]));
}
totals.strongEdges = sum(peak.strongEdges.map(row => row.count));
totals.cumulativeBytes = totals.metadata + totals.payload;
totals.cumulativeSlots = totals.mapSlots + totals.vectorSlots;
totals.forwardWork = sum(Object.values(peak.forwardWork));
totals.cleanupCredits = Object.values(peak.cleanup).reduce((total, row) => total + BigInt(row.count) * BigInt(row.unitsEach), 0n);
totals.cumulativeReservedWork = totals.forwardWork + totals.cleanupCredits;
for (const [field, value] of Object.entries(totals)) assert.equal(value, BigInt(peak.expected[field]), field);
assert.equal(totals.cumulativeReservedWork, 445n);
assert.equal(totals.cumulativeBytes, 2610n);
const bytesCap = BigInt(peak.inputs.B);
const fieldsCap = BigInt(peak.inputs.F);
const derived = { wrappers: fieldsCap, mapSlots: fieldsCap, payload: bytesCap, metadata: 128n * fieldsCap,
  cumulativeBytes: 8n * bytesCap + 512n * fieldsCap, cumulativeSlots: 8n * fieldsCap, work: 32n * bytesCap + 256n * fieldsCap };
for (const [field, value] of Object.entries(derived)) assert.equal(value, BigInt(peak.caps[field]), field);
assert.ok(BigInt(peak.expected.wrappers) <= derived.wrappers);
for (const field of ['mapSlots', 'payload', 'metadata', 'cumulativeBytes', 'cumulativeSlots']) assert.ok(totals[field] <= derived[field]);
assert.ok(totals.cumulativeReservedWork <= derived.work);

const read = name => readFileSync(resolve(directory, name));
const vectors = JSON.parse(read('VECTORS.json'));
const controls = JSON.parse(read('CONTROLS.json'));
assert.equal(vectors.splice.length, 17);
assert.equal(vectors.zeroView.length, 16);
assert.equal(controls.controls.length, 22);
for (const [prefix, rows] of [['S', vectors.splice], ['O', vectors.zeroView], ['M', controls.controls]]) {
  rows.forEach((row, index) => assert.equal(row.id, `${prefix}${String(index + 1).padStart(2, '0')}`));
  for (const row of rows) assert.ok(Buffer.byteLength(JSON.stringify(row)) <= controls.bounds.maxLiteralBytes);
}
const ownFiles = ['README.md', 'DECISIONS.md', 'VECTORS.json', 'CONTROLS.json', 'audit-static.mjs'];
const ownBindings = ownFiles.map(path => {
  const bytes = read(path);
  return { path, bytes: bytes.length, sha256: digest(bytes) };
});
console.log(JSON.stringify({
  schema: 'indexed-array-v3-static-review-result', date: '2026-08-28',
  node: { version: process.version, executable: process.execPath },
  result: 'static authentication, source-section comparison and declared arithmetic agree',
  bindings, sections, ownBindings,
  arithmetic: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, String(value)])),
  proposedUnexecuted: { spliceVectors: 17, zeroViewVectors: 16, mechanicalObligations: 22 },
  productExecutions: 0, nativeExecutions: 0, packageExecutions: 0, mutantKills: 0,
  qualification: 'No behavioral execution, ledger proof, universal peak, RSS, full-package or native parity acceptance'
}, null, 2));
