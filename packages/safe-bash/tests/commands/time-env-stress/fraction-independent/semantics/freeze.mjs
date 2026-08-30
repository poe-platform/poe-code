import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cases } from './cases.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const here = new URL('./', import.meta.url);
const data = JSON.stringify(cases, null, 2) + '\n';
writeFileSync(new URL('cases.frozen.json', here), data, { flag: 'wx' });
writeFileSync(new URL('FREEZE.json', here), JSON.stringify({
  frozenAt: new Date().toISOString(), identity: cases.identity, commit: cases.commit,
  productRows: cases.product.length, sourceProofRows: cases.proof.length,
  files: Object.fromEntries(['cases.mjs', 'cases.frozen.json', 'freeze.mjs'].map(name => [name, hash(readFileSync(new URL(name, here)))])),
  otherReviewerCasesRead: false, productRunOccurred: false,
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ product: cases.product.length, proof: cases.proof.length, sha256: hash(data) }));
