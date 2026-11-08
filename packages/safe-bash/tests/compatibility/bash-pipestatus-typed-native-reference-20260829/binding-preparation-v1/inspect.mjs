import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root = 'tests/compatibility/bash-pipestatus-typed-native-reference-20260829';
const own = `${root}/binding-preparation-v1`;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(file, limit = 131072) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error(`type/size:${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== info.size) throw new Error(`size:${file}`);
  return { bytes, sha256: sha(bytes), size: bytes.length, mode: info.mode & 0o777 };
}
const tree = read(`${own}/raw/source-tree.nul`);
const rows = tree.bytes.toString('utf8').split('\0').filter(Boolean).map(row => {
  const [meta, file] = row.split('\t');
  const [mode, kind, blob] = meta.split(' ');
  return { mode, kind, blob, file };
});
const selected = ['materialized/admission.mjs', 'materialized/PRESEAL.json', 'READY-SEAL.json', 'GO.template.json', 'REVIEW-ACCEPTANCE.template.json', 'APPROVAL-PROPOSAL.template.json', 'HANDOFF.md'];
const authenticated = [];
for (const name of selected) {
  const file = `${root}/${name}`;
  const row = rows.find(item => item.file === file);
  if (!row || row.kind !== 'blob') throw new Error(`membership:${name}`);
  const value = read(file);
  const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${value.size}\0`)).update(value.bytes).digest('hex');
  if (blob !== row.blob) throw new Error(`blob:${name}`);
  authenticated.push({ file, ...row, size: value.size, sha256: value.sha256, liveMode: value.mode });
  console.log(`--- ${name} ${value.sha256} ---`);
  const text = value.bytes.toString('utf8');
  console.log(text.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n'));
}
const review = read(`${own}/raw/review-commit.txt`);
console.log('--- review commit metadata ---');
console.log(review.bytes.toString('utf8'));
fs.writeFileSync(`${own}/INSPECTED-SOURCE.json`, JSON.stringify({ source: 'e10e371dc9c70583681add9c1747c85a710b1f59', treeSha256: tree.sha256, authenticated }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
