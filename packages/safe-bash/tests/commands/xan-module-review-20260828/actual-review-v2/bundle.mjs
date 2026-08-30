import assert from 'node:assert/strict';
import path from 'node:path';
import { createWriteStream, createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { ROOT, json, hash, identity, tree, verifyTree, durable } from './common.mjs';
const archive = path.join(ROOT, 'EVIDENCE.jsonl.gz');
if (process.argv[2] === 'verify') {
  const seal = await json(path.join(ROOT, 'EVIDENCE-SEAL.json')); assert.deepEqual(await identity(archive), seal.archive);
  const expected = seal.entries.filter(entry => !entry.directory); let count = 0; let total = 0;
  const stream = createReadStream(archive).pipe(createGunzip());
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    assert.ok(line.length <= 96 * 1024 * 1024); const record = JSON.parse(line); const entry = expected[count++];
    assert.equal(record.path, entry.path); const bytes = Buffer.from(record.base64, 'base64'); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); total += bytes.length; assert.ok(total <= 256 * 1024 * 1024);
  }
  assert.equal(count, expected.length); console.log(JSON.stringify({ verified: count, bytes: total, extraction: false, product: false }));
} else {
  const root = path.join(ROOT, 'evidence'); const entries = await tree(root); const gzip = createGzip({ level: 9 }); const output = createWriteStream(archive, { flags: 'wx' }); const completed = pipeline(gzip, output);
  let total = 0;
  for (const entry of entries.filter(entry => !entry.directory)) {
    assert.ok(entry.bytes <= 64 * 1024 * 1024); total += entry.bytes; assert.ok(total <= 256 * 1024 * 1024);
    const bytes = await readFile(path.join(root, entry.path)); assert.equal(hash(bytes), entry.sha256);
    if (!gzip.write(JSON.stringify({ path: entry.path, mode: entry.mode, base64: bytes.toString('base64') }) + '\n')) await once(gzip, 'drain');
  }
  gzip.end(); await completed; await verifyTree(root, entries);
  await durable(path.join(ROOT, 'EVIDENCE-SEAL.json'), { classification: 'ACTUAL_V2_FULL_RAW_BUNDLE_NOT_RESCORE', created: new Date().toISOString(), appendAware: true, entries, archive: await identity(archive), totalPayloadBytes: total });
  console.log(JSON.stringify({ files: entries.filter(entry => !entry.directory).length, bytes: total, archive: await identity(archive) }));
}
