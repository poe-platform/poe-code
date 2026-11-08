import fs from 'node:fs';
import crypto from 'node:crypto';
const base = 'tests/compatibility/bash-pipestatus-typed-native-reference-20260829';
const own = `${base}/activation-v1`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function read(file, expected, maximum = 1048576) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error(`type/size:${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size || (expected && hash(bytes) !== expected)) throw Error(`hash:${file}`);
  return bytes;
}
const pin = read(`${base}/SOURCE-AUTH.json`);
console.log('SOURCE-AUTH', pin.toString());
for (const name of ['GO.template.json', 'REVIEW-ACCEPTANCE.template.json', 'APPROVAL-PROPOSAL.template.json', 'materialized/entry.mjs', 'materialized/PROTOCOL.json', 'materialized/TOOLS.json']) {
  const bytes = read(`${base}/${name}`);
  console.log(`---${name} SHA256=${hash(bytes)}---\n${bytes.toString()}`);
}
const bytes = read(`${base}/materialized/admission.mjs`, '1a164fdf354fe0be4bf95d6df33814501ef88e694b411b85a7c881711f9921a8');
console.log('---ADMISSION---\n' + bytes.toString());
const rows = read(`${own}/raw/review-tree.nul`, null, 33554432).toString().split('\0').filter(Boolean);
for (const row of rows) {
  const filename = row.split('\t')[1];
  if (filename?.includes('typed') && /\/(?:RECEIPT\.json|REPORT\.md)$/.test(filename)) {
    const content = read(filename);
    console.log('---REVIEW ' + row + ' SHA256=' + hash(content) + '---\n' + content.toString());
  }
}
