import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const owned = process.argv[2];
const author = 'tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v7';
assert.equal(owned, 'tests/compatibility/bash-ere-core-writer-independent-20260829');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= 16 * 1048576, filename);
  return fs.readFileSync(filename);
};
const rows = fs.readdirSync(author).sort().map(name => {
  const filename = path.join(author, name);
  const stat = fs.lstatSync(filename);
  return stat.isFile() ? { name, size: stat.size, sha256: digest(read(filename)) } : { name, directory: true };
});
const bound = JSON.parse(read(path.join(author, 'WORKING-BOUND.json')));
const binding = JSON.parse(read(path.join(author, 'BINDING-RECIPE.json')));
const layouts = binding.layouts.map(layout => {
  const raw = read(layout.manifest.path);
  assert.equal(digest(raw), layout.manifest.sha256);
  const manifest = JSON.parse(raw);
  const bytes = manifest.rows.reduce((sum, row) => {
    assert(Number.isSafeInteger(row.size) && row.size >= 0);
    return sum + row.size;
  }, 0);
  assert.equal(bytes, layout.bytes);
  return { name: layout.name, files: manifest.rows.length, bytes, cells: layout.cells };
});
const staticBytes = layouts.reduce((sum, layout) => sum + layout.bytes, 0);
assert.equal(bound.components.retainedAndFreshLayoutCopies, staticBytes * 2 + 1048576);
assert.equal(bound.components.uniqueCellEvents, 210 * 262144);
assert.equal(bound.components.uniqueCellPipesIncludingFinalAudits, 210 * 262144);
assert.equal(Object.values(bound.components).reduce((sum, bytes) => sum + bytes, 0), 332129069);
assert.equal(bound.logicalMaximum, 332129069);
assert.equal(bound.captureMaximum, 131072000);
assert.equal(bound.components.onePublicationCopyOfAllCaptures, bound.captureMaximum);
const snapshot = Object.freeze({ phase: 'SOURCE_DATA_ONLY', at: new Date().toISOString(), rows, layouts, staticBytes, bound, binding, products: 0, workers: 0 });
const output = JSON.stringify(snapshot, null, 2) + '\n';
assert(Buffer.byteLength(output) < 1048576);
fs.writeFileSync(path.join(owned, 'AUDIT.json'), output, { flag: 'wx' });
console.log(JSON.stringify({ phase: snapshot.phase, layouts, staticBytes, logicalMaximum: bound.logicalMaximum, captureMaximum: bound.captureMaximum }));
