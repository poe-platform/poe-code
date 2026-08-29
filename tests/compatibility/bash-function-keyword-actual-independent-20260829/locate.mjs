import * as fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const owned = process.argv[2];
assert.equal(owned, 'tests/compatibility/bash-function-keyword-actual-independent-20260829');
const author = 'tests/compatibility/bash-function-keyword-author-20260829/preexec-v4/actual-v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= 4 * 1048576, filename);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return bytes;
};
assert.equal(read(owned + '/EVIDENCE-DIFF.txt').length, 0);
const names = ['STOP.json', 'CAPTURE-MANIFEST.json', 'MATRIX.json', 'ADMIN-PREPUBLICATION.json', 'REPORT.md'];
const inputs = names.map(name => {
  const bytes = read(author + '/' + name);
  return { name, bytes: bytes.length, sha256: hash(bytes), content: name.endsWith('.json') ? JSON.parse(bytes) : bytes.toString() };
});
assert.equal(inputs[0].sha256, 'cb024e8206bac5a540fff7bd03a1f30e1e6b3fa79ca5cda3c8bfbc87e32c82cb');
const snapshot = { at: new Date().toISOString(), author, inputs };
fs.writeFileSync(owned + '/AUTHOR-INPUTS.json', JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
for (const input of inputs) {
  const content = input.content;
  console.log(JSON.stringify({ name: input.name, bytes: input.bytes, sha256: input.sha256, keys: typeof content === 'object' ? Object.keys(content) : [], preview: input.name === 'CAPTURE-MANIFEST.json' || input.name === 'MATRIX.json' ? Object.fromEntries(Object.entries(content).map(([key, value]) => [key, Array.isArray(value) ? { length: value.length, first: value.slice(0, 3), last: value.slice(-2) } : value])) : content }));
}
