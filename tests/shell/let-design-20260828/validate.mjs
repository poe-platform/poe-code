import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const scope = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = filename => JSON.parse(readFileSync(resolve(scope, filename)));
const manifest = json('MANIFEST-V2.json');
assert.equal(hash(readFileSync(resolve(scope, 'MANIFEST-V2.json'))), 'f47b59eee0c8072334788bed76bb969969a4a2e4ca5d1e21c6686c9df9483d10');
for (const binding of [...manifest.recipes, ...json('BINDINGS.json').tools]) {
  const filename = resolve(scope, binding.path);
  const stat = lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o777, binding.mode);
  const bytes = readFileSync(filename);
  assert.equal(bytes.length, binding.bytes);
  assert.equal(hash(bytes), binding.sha256, filename);
}
const old = json('MANIFEST.json');
const oldNative = old.recipes.find(row => row.path === 'native.mjs');
assert.equal(hash(readFileSync(resolve(scope, 'native-preparation-syntax-failure.data'))), oldNative.sha256);
assert.notEqual(hash(readFileSync(resolve(scope, 'native.mjs'))), oldNative.sha256);
const rows = readFileSync(resolve(scope, 'native-v1/rows.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const cases = json('CASES.json');
assert.deepEqual(rows.map(row => row.id), cases.map(row => row.id));
let total = 0;
for (const [index, row] of rows.entries()) {
  assert.equal(row.scriptSHA256, hash(cases[index].script));
  assert.deepEqual(row.closure, { closeEvent: true, pidAbsent: true, groupAbsent: true, natural: true });
  assert.equal(row.stopped, null);
  assert.equal(row.spawnError, null);
  assert.equal(row.signal, null);
  for (const stream of ['stdout', 'stderr']) {
    const raw = Buffer.from(row[`${stream}Base64`], 'base64');
    assert.equal(raw.toString(), row[stream]);
    assert.equal(raw.length, row[`${stream}Bytes`]);
    total += raw.length;
  }
  assert.equal(row.observedBytes, row.stdoutBytes + row.stderrBytes);
}
assert.equal(rows.length, 28);
assert.equal(total, 3558);
assert.equal(rows.find(row => row.id === 'N10').stdout, 'status=1;value=7\n');
assert.equal(rows.find(row => row.id === 'N17').stdout, 'status=0;value=8;other=8\n');
assert.equal(rows.find(row => row.id === 'N20').code, 1);
assert.equal(rows.filter(row => row.code === 0).length, 27);
assert.equal(json('native-v1/SUMMARY.json').failure, null);
assert.deepEqual(json('native-v1/SUMMARY.json').unexecuted, []);
assert.equal(json('native-v1/SUMMARY.json').postGuard, 'passed');
console.log(JSON.stringify({ artifactChecks: 'passed', nativeReruns: 0, productExecutions: 0, rows: rows.length, capturedBytes: total, initialSyntaxFailureBytesPreserved: true }));
