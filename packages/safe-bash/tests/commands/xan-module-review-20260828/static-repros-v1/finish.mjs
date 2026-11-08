import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { open } from 'node:fs/promises';
import { ROOT, identity, tree, verifyTree, durable, json, checkInputs, hash } from './common.mjs';
const seal = await json(path.join(ROOT, 'PRE-SEAL.json'));
await checkInputs(seal.inputs); await checkInputs(seal.binding.inputs);
for (const root of seal.binding.roots) await verifyTree(root.root, root.entries);
const evidence = path.join(ROOT, 'attempt-1'); const entries = await tree(evidence);
let total = 0; const lines = [];
for (const entry of entries.filter(item => !item.directory)) {
  assert.ok(entry.bytes <= 3000000); total += entry.bytes; assert.ok(total <= 50000000);
  const bytes = await readFile(path.join(evidence, entry.path)); assert.equal(hash(bytes), entry.sha256);
  lines.push(JSON.stringify({ path: entry.path, base64: bytes.toString('base64') }));
}
const raw = gzipSync(Buffer.from(lines.join('\n') + '\n'), { level: 9 });
const filename = path.join(ROOT, 'RAW.jsonl.gz'); const file = await open(filename, 'wx');
try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
await verifyTree(evidence, entries);
await durable(path.join(ROOT, 'EVIDENCE-SEAL.json'), { at: new Date().toISOString(), entries, totalPayloadBytes: total, archive: await identity(filename),
  appendAware: true, postIntegrity: 'all authenticated reused source/tools/moved/build entries and new entries checked; recipe/helper identities checked', beforeReport: true });
console.log(JSON.stringify({ files: entries.filter(item => !item.directory).length, total, archive: await identity(filename) }));
