import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { hash, inventory, read } from '../../html-to-markdown-independent-20260827/fix-review-3ef5811f/common.mjs';

const own = dirname(fileURLToPath(import.meta.url));
const summary = read(join(own, 'SUMMARY.json')), manifest = read(join(own, 'MANIFEST.json'));
const compressed = Buffer.from(readFileSync(join(own, 'EVIDENCE.json.gz.base64'), 'utf8'), 'base64');
assert.equal(hash(compressed), manifest.compressedSHA256);
assert.equal(hash(compressed), summary.evidenceCompressedSHA256);
const archive = JSON.parse(gunzipSync(compressed));
assert.deepEqual(Object.keys(archive).sort(), Object.keys(manifest.files).sort());
for (const [path, entry] of Object.entries(manifest.files)) {
  const bytes = Buffer.from(archive[path], 'base64');
  assert.equal(bytes.length, entry.bytes, path); assert.equal(hash(bytes), entry.sha256, path);
}
const data = path => JSON.parse(Buffer.from(archive[path], 'base64'));
const fixed = data('fixed-01/RESULT.json'), baseline = data('baseline-04/RESULT.json');
assert.equal(fixed.revision, summary.candidate);
assert.equal(fixed.htmlTree, summary.candidateHtmlTree);
assert.equal(fixed.rows.length, summary.allFixedReceipts);
assert.deepEqual(fixed.counts, summary.fixedCounts);
assert.deepEqual(baseline.counts, summary.baselineCounts);
assert.equal(manifest.files['fixed-01/package.tgz'].sha256, fixed.packageSHA256);
let productLoads = 0;
for (const row of fixed.rows) {
  const prefix = 'fixed-01/' + row.phase + '/' + row.id;
  const receipt = data(prefix + '.receipt.json');
  const { phase, ...recorded } = row;
  assert.deepEqual(receipt, recorded);
  assert.equal(receipt.outcome, 'PASS'); assert.equal(receipt.killed, false);
  assert.equal(receipt.signal, null); assert.equal(receipt.processGroupGone, true);
  assert.equal(receipt.preSHA256, manifest.files[prefix + '.pre.json'].sha256);
  assert.equal(receipt.stdoutSHA256, manifest.files[prefix + '.stdout'].sha256);
  assert.equal(receipt.stderrSHA256, manifest.files[prefix + '.stderr'].sha256);
  for (const load of receipt.loads) {
    const path = fileURLToPath(load.url);
    if (path.includes('/dist/')) {
      productLoads++;
      if (path.startsWith(fixed.output + '/')) assert.equal(load.sha256, fixed.emittedBefore[path.slice(fixed.output.length + 1)]);
      else { assert(path.startsWith(fixed.moved + '/')); assert.equal(load.sha256, fixed.movedBefore[path.slice(fixed.moved.length + 1)]); }
    } else {
      const prefix = fixed.capture + '/'; assert(path.startsWith(prefix));
      assert.equal(load.sha256, manifest.files['fixed-01/' + path.slice(prefix.length)].sha256);
    }
  }
}
assert.equal(productLoads, summary.productLoadRecords);
for (const [name, count] of [['author154', 154], ['new52', 52]]) {
  const tap = Buffer.from(archive['fixed-01/validation/' + name + '.stdout'], 'base64').toString();
  assert.match(tap, new RegExp('# tests ' + count + '\\n'));
  assert.match(tap, new RegExp('# pass ' + count + '\\n')); assert.match(tap, /# fail 0\n/u);
}
for (const row of summary.aborts) { assert.equal(row.reasonIdentity, true); assert(row.settlementMs < 1000); }
const original = data('baseline-04/CASES.json'), current = data('fixed-01/CASES.json');
assert.deepEqual(original, current);
const nested = data('baseline-04/nested-supplement/RESULT.json');
assert.equal(nested.rows.length, 6); assert(nested.rows.every(row => row.actual.outcome === 'FAIL'));
for (const label of ['baseline-01', 'baseline-02', 'baseline-03']) assert.equal(typeof data(label + '/RESULT.json').error, 'string');
if (process.argv.includes('--live-retained')) {
  assert.deepEqual(inventory(fixed.source), fixed.sourceAfter);
  assert.deepEqual(inventory(fixed.moved), fixed.movedBefore);
  const relocated = read(join(own, 'RELOCATION.json'));
  assert.deepEqual(inventory(join(relocated.to, 'baseline-04/candidate')), baseline.sourceAfter);
}
console.log(JSON.stringify({ verified: true, candidate: fixed.revision, evidenceFiles: Object.keys(archive).length, fixedReceipts: fixed.rows.length, productLoads, exactReasonAborts: summary.aborts.length, regularFileMembershipRechecked: process.argv.includes('--live-retained') }));
