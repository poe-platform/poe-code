import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { hash, read } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url));
const manifest = read(join(own, 'MANIFEST.json'));
const compressed = Buffer.from(readFileSync(join(own, 'EVIDENCE.json.gz.base64'), 'utf8'), 'base64');
assert.equal(hash(compressed), manifest.compressedSHA256);
const files = JSON.parse(gunzipSync(compressed));
assert.deepEqual(Object.keys(files).sort(), Object.keys(manifest.files).sort());
const bytes = path => Buffer.from(files[path], 'base64');
const data = path => JSON.parse(bytes(path));
for (const [path, digest] of Object.entries(manifest.files)) assert.equal(hash(bytes(path)), digest, path);
const state = data('state.json'), audit = data('FINAL-AUDIT.json');
assert.deepEqual(audit, read(join(own, 'FINAL-AUDIT.json')));
assert.equal(state.source, '9ae34a06662db27897043d77d6145700c109b22c');
assert.equal(state.freeze, 'c10642866846d83a8a1f61e9712a30aab0ed0cd7');
assert.equal(hash(bytes('supplied-package.tgz')), 'aed5586e0e11880d3734fb788f124ccc55cae905b57d01a24bc754da107c325d');
for (const [name, digest] of Object.entries(state.scriptsBefore)) assert.equal(hash(readFileSync(join(own, name))), digest, name);
for (const [path, digest] of Object.entries(state.sourceBefore)) assert.equal(hash(bytes('authenticated-source/' + path)), digest);
for (const [path, digest] of Object.entries(state.legacyBefore)) assert.equal(hash(bytes('unchanged-legacy/' + path)), digest);
let productLoads = 0, harnessLoads = 0, natural = 0, intentionalKills = 0, pass = 0, fail = 0;
const receipts = Object.keys(files).filter(path => path.endsWith('.receipt.json'));
for (const path of receipts) {
  const row = data(path), prefix = path.slice(0, -'.receipt.json'.length), pre = data(prefix + '.pre.json');
  assert.equal(hash(bytes(prefix + '.pre.json')), row.preSHA256);
  assert.equal(hash(bytes(prefix + '.stdout')), row.stdoutSHA256);
  assert.equal(hash(bytes(prefix + '.stderr')), row.stderrSHA256);
  assert.equal(pre.supervisorSHA256, state.scriptsBefore['common.mjs']);
  assert.equal(pre.executableSHA256, pre.executable === state.pandoc ? state.toolchain.pandoc.sha256 : state.toolchain.node.sha256);
  assert.equal(row.processGroupGone, true);
  if (row.killed) { assert.equal(row.id, 'busy-loop'); assert.equal(row.outcome, 'EXPECTED_SUPERVISOR_KILL'); intentionalKills++; }
  else { assert.equal(row.signal, null); natural++; }
  if (row.outcome === 'PASS') pass++;
  if (row.outcome === 'FAIL') fail++;
  for (const load of row.loads) {
    const loaded = fileURLToPath(load.url);
    if (loaded.startsWith(state.isolated + '/dist/')) { assert.equal(load.sha256, state.isolatedBefore[loaded.slice(state.isolated.length + 1)]); productLoads++; }
    else if (loaded.startsWith(state.installed + '/dist/')) { assert.equal(load.sha256, state.installedBefore[loaded.slice(state.installed.length + 1)]); productLoads++; }
    else { assert(loaded.startsWith(state.consumer + '/')); const input = pre.inputs.harness ?? pre.inputs; const harness = loaded.slice(0, loaded.lastIndexOf('/') + 1); assert.equal(load.sha256, input[loaded.slice(harness.length)]); harnessLoads++; }
  }
}
assert.deepEqual({ total: receipts.length, pass, fail, intentionalKills }, audit.receipts);
assert.equal(productLoads, audit.productLoads); assert.equal(harnessLoads, audit.harnessLoads);
const main = data('RESULTS.json'), neighbors = data('followup/RESULTS.json'), holdouts = data('holdouts/RESULTS.json');
assert.equal(main.astRows.filter(row => row.outcome === 'PASS').length, 64);
assert.equal(neighbors.ast.filter(row => row.outcome === 'PASS').length, 20);
assert.equal(holdouts.ast.filter(row => row.outcome === 'PASS').length, 22);
assert.deepEqual(holdouts.ast.filter(row => row.outcome === 'FAIL').map(row => row.id), ['link-between-em', 'link-between-em']);
assert.equal(audit.inFlight.length + audit.directScan.length + audit.normalization.length, 22);
for (const row of [...audit.inFlight, ...audit.directScan, ...audit.normalization]) { assert.equal(row.reasonIdentity, true); assert(row.settlementMs < 1000); }
console.log(JSON.stringify({ authenticatedFiles: Object.keys(files).length, compressedSHA256: hash(compressed), receipts: receipts.length, pass, fail, natural, intentionalKills, forcedProductKills: 0, productLoads, harnessLoads, exactReasonAborts: 22 }));
