import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve('tests/compatibility/bash-ere-native-reference-20260829');
function read(relative, maximum = 262144) {
  const filename = path.join(root, relative);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error(`ADMISSION ${relative}`);
  const bytes = fs.readFileSync(filename);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return { relative, bytes: bytes.length, mode: stat.mode & 511, sha256, text: bytes.toString('utf8') };
}
const seal = read('PACKET-SEAL.json');
if (seal.sha256 !== '7ceac39234b1ce5e789bfb9d5452ec9cf7c718284c2ce78b8c5434dad64a42a1') throw Error('PACKET_SEAL');
for (const relative of ['PACKET-SEAL.json', 'PREEXEC-CONTROLS-PROPOSAL.json', 'TOOLS.json', 'PROTOCOL.json', 'draft/admission.mjs.data', 'draft/entry.mjs.data', 'draft/lifecycle.mjs.data', 'draft/state.mjs.data', 'draft/storage.mjs.data', 'APPROVAL-PROPOSAL.template.json']) {
  console.log(JSON.stringify(read(relative)));
}
