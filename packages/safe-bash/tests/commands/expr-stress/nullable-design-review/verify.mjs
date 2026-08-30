import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => {
  let bytes;
  try { bytes = await readFile(join(root, path)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; bytes = gunzipSync(await readFile(join(root, path + '.gz'))); }
  return JSON.parse(bytes.toString());
};
async function inventory(directory = root, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (path === 'manifest.json') continue;
    if (entry.isDirectory()) result.push(...await inventory(join(directory, entry.name), path + '/'));
    else {
      assert(entry.isFile(), `unexpected non-regular entry ${path}`);
      const bytes = await readFile(join(directory, entry.name));
      result.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}
const current = await inventory();
if (process.argv.length === 3 && process.argv[2] === '--seal-new') {
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ candidate: '27a7793526830768484885afba5832bf8bb248b5', classification: 'Evidence-only opt-in diagnostics; no canonical TypeScript inputs or product changes', files: current }, null, 2) + '\n', { flag: 'wx' });
} else assert.equal(process.argv.length, 2, 'usage: node verify.mjs [--seal-new]');
const manifest = await json('manifest.json');
assert.deepEqual(current, manifest.files, 'exact evidence inventory/bytes mismatch, including new entries');
const packing = await json('PACKING.json');
const previousSeal = await json('PREPACK-MANIFEST.json');
for (const mapping of packing.mappings) {
  const archived = await readFile(join(root, mapping.archived));
  const original = gunzipSync(archived);
  assert.equal(digest(archived), mapping.archiveSha256);
  assert.equal(archived.length, mapping.archiveBytes);
  assert.equal(digest(original), mapping.originalSha256);
  assert.equal(original.length, mapping.originalBytes);
  assert.equal(previousSeal.files.find(entry => entry.path === mapping.original).sha256, mapping.originalSha256);
}
assert(!current.some(entry => entry.path.endsWith('.test.ts') || entry.path.endsWith('.c') || entry.path.endsWith('.ts')));
const originals = await readFile(join(root, 'capture-final/original-eight.json'));
const historical = await readFile(join(root, '../extension-review/after-abort-fix/replay/supplement-27a77935/nullable-separate-cohort.json'));
assert.deepEqual(originals, historical);
const cohort = JSON.parse(originals);
assert.equal(cohort.candidate, manifest.candidate);
assert.equal(cohort.rows.length, 8);
assert.deepEqual(cohort.rows.filter(row => !row.comparison.semantic).map(row => row.id), ['empty', 'a', 'aa', 'aaa', 'mandatory-empty']);
assert.equal(cohort.rows.filter(row => row.comparison.strict).length, 3);
for (const capture of ['capture-third', 'capture-final']) {
  const cases = await json(`${capture}/cases.json`);
  assert.equal(cases.length, capture === 'capture-final' ? 24 : 22);
  assert.deepEqual(cases.filter(row => row.original).map(row => row.argv), cohort.rows.map(row => row.argv));
  const native = await json(`${capture}/native.json`);
  for (const row of cohort.rows) {
    const observed = native.find(item => item.id === row.id).tuple;
    for (const key of ['status', 'signal', 'failure', 'stdoutBase64', 'stderrBase64']) assert.deepEqual(observed[key], row.expected[key]);
  }
  for (const row of native) {
    assert.equal(row.registers.stdout, row.trace.stdout);
    assert.equal(row.registers.timedOut || row.trace.timedOut || row.tuple.timedOut, false);
  }
  const candidate = await json(`${capture}/candidate.json`);
  for (const row of cohort.rows.filter(row => !row.comparison.semantic)) assert.equal(candidate.outputs.find(item => item.id === row.id).error.category, 'unsupported');
  const frame = await json(`${capture}/repeatFrames.json`);
  assert.equal(frame.outputs.length, cases.length + 4);
  assert.equal(frame.outputs.filter(row => row.id.startsWith('limit-') && row.error?.category === 'limit').length, 4);
  const get = id => frame.outputs.find(row => row.id === id).result;
  assert.deepEqual(get('empty').capture, { start: 0, end: 0 });
  assert.deepEqual(get('a').overall, { start: 0, end: 0 });
  assert.deepEqual(get('aaa').overall, { start: 0, end: 3 });
  assert.deepEqual(get('aaa').capture, { start: 1, end: 2 });
  assert.deepEqual(get('mandatory-empty').capture, { start: 0, end: 0 });
  for (const row of cohort.rows.filter(row => row.comparison.strict)) {
    const span = get(row.id).capture;
    const text = Buffer.from(row.argv[1]).subarray(span.start, span.end).toString() + '\n';
    assert.equal(Buffer.from(text).toString('base64'), row.expected.stdoutBase64);
  }
  const provenance = await json(`${capture}/provenance.json`);
  assert.deepEqual(provenance.before, provenance.after);
  assert.deepEqual(provenance.environment, { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', TZ: 'UTC' });
}
const final = await json('capture-final/provenance.json');
for (const [path, expected] of Object.entries(final.driverHashes)) assert.equal(digest(await readFile(join(root, path))), expected, `driver drift ${path}`);
for (const capture of ['capture-first', 'capture-second', 'capture-third', 'capture-final']) {
  const cleanup = await json(`${capture}/cleanup.json`);
  assert.equal(cleanup.activeChildren, 0); assert.equal(cleanup.activeWorkers, 0); assert.equal(cleanup.exists, false);
}
assert((await json('capture-first/failure.json')).message.includes('ENOENT'));
assert((await json('capture-second/failure.json')).message.includes('Please include config.h first'));
console.log(JSON.stringify({ verifiedFiles: current.length, exactOriginalRows: 8, originalFailures: 5, originalControls: 3, finalLocalRows: 24, prototypeLimitProbes: 4, classification: 'read-only evidence verification, not product acceptance', manifestSha256: digest(await readFile(join(root, 'manifest.json'))) }));
