import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const own = 'tests/commands/node-worker-independent-20260828/';
const inputs = [
  'tests/commands/node-provider-experiments-20260828/PUBLIC-SOURCE.json.gz.base64',
  'tests/commands/node-design-20260828/worker-resource-quiescence-proposal-v1/SOURCES.json',
];
const bytes = inputs.map(path => {
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index++) assert(!lstatSync(parts.slice(0, index).join('/')).isSymbolicLink());
  assert(lstatSync(path).size < 2 * 1024 * 1024);
  return readFileSync(path);
});
assert.equal(createHash('sha256').update(bytes[0]).digest('hex'), '9723f42cc9f01e3dff7c3ad8705538f99cbdc1c507a2d0699a4575ecb4a227ec');
const archive = JSON.parse(gunzipSync(Buffer.from(bytes[0].toString(), 'base64'), { maxOutputLength: 8 * 1024 * 1024 }));
const bindings = JSON.parse(bytes[1]);
const groups = new Set(['S3', 'S5', 'S7', 'S8', 'S9', 'S10']);
let output = '';
for (const group of bindings.sourceGroups.filter(group => groups.has(group.id))) {
  for (const member of group.members) {
    const entry = archive.files.find(entry => entry.path === member.path);
    const source = Buffer.from(entry.base64, 'base64');
    assert.equal(createHash('sha256').update(source).digest('hex'), member.sha256);
    const lines = source.toString().split('\n');
    for (const [first, last] of member.inspectedLineRanges) {
      output += `\n=== ${group.id} ${member.path}:${first}-${last} ===\n`;
      output += lines.slice(first - 1, last).map((line, offset) => `${first + offset}: ${line}`).join('\n') + '\n';
    }
  }
}
assert(Buffer.byteLength(output) < 128 * 1024);
writeFileSync(`${own}remaining-excerpts.data`, output, { flag: 'wx' });
console.log(JSON.stringify({ role: 'source-only DATA excerpts; no imports of subject', groups: [...groups], bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex') }));
