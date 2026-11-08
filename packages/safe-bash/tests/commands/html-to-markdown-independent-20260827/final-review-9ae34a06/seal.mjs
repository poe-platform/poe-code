import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hash, inventory, read, save } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), name = process.argv[2] ?? 'run01', capture = join(own, name);
const archivePath = join(own, name + '.json.gz.base64'), manifestPath = join(own, name + '.MANIFEST.json');
if (process.argv[3] === 'verify') {
  const metadata = read(manifestPath), compressed = Buffer.from(readFileSync(archivePath, 'utf8'), 'base64');
  assert.equal(hash(compressed), metadata.compressedSHA256);
  const files = JSON.parse(gunzipSync(compressed)); assert.deepEqual(Object.keys(files).sort(), Object.keys(metadata.files).sort());
  for (const [path, encoded] of Object.entries(files)) assert.equal(hash(Buffer.from(encoded, 'base64')), metadata.files[path]);
  console.log(JSON.stringify({ authenticatedFiles: Object.keys(files).length, compressedSHA256: hash(compressed) }));
} else {
  assert(!existsSync(archivePath));
  const results = read(join(capture, 'RESULTS.json')), state = read(join(capture, 'state.json'));
  assert(results.inventoriesUnchangedIncludingNewEntries);
  const files = {}, digests = {};
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (prefix === '' && entry.name === 'work') continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), relative + '/');
      else { assert(entry.isFile()); const bytes = readFileSync(join(directory, entry.name)); files[relative] = bytes.toString('base64'); digests[relative] = hash(bytes); }
    }
  }
  visit(capture);
  for (const [path, digest] of Object.entries(state.sourceBefore)) {
    const relative = 'authenticated-source/' + path, bytes = readFileSync(join(state.isolated, path));
    assert.equal(hash(bytes), digest); files[relative] = bytes.toString('base64'); digests[relative] = digest;
  }
  for (const [path, digest] of Object.entries(state.legacyBefore)) { const bytes = readFileSync(join(state.legacy, path)); files['unchanged-legacy/' + path] = bytes.toString('base64'); digests['unchanged-legacy/' + path] = digest; }
  const compressed = gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 });
  writeFileSync(archivePath, compressed.toString('base64') + '\n');
  save(manifestPath, { scope: 'Lossless raw capture, unchanged old drivers/repros, immutable source inputs, real npm tarball. Tool binaries authenticated by pre/post inventories, not vendored. Absolute paths are historical receipts, not replay dependencies.', source: state.source, freeze: state.freeze, packSHA256: state.packSHA256, compressedSHA256: hash(compressed), files: digests });
  save(join(own, 'SUMMARY.json'), { source: state.source, freeze: state.freeze, packSHA256: state.packSHA256, receipts: results.rows.length, productKills: results.rows.filter(row => row.killed && row.outcome !== 'EXPECTED_SUPERVISOR_KILL').length, intentionalKills: results.rows.filter(row => row.outcome === 'EXPECTED_SUPERVISOR_KILL').length, phases: Object.fromEntries([...new Set(results.rows.map(row => row.layout + '/' + row.phase))].map(key => { const cohort = results.rows.filter(row => row.layout + '/' + row.phase === key); return [key, { total: cohort.length, pass: cohort.filter(row => row.outcome === 'PASS').length, fail: cohort.filter(row => row.outcome === 'FAIL').length }]; })), ast: results.astRows.map(({ layout, id, origin, outcome, error }) => ({ layout, id, origin, outcome, error })) });
  console.log(JSON.stringify({ files: Object.keys(files).length, compressedSHA256: hash(compressed), packSHA256: state.packSHA256 }));
}
