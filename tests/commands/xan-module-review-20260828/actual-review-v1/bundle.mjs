import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { ROOT, tree, identity, verifyTree } from './artifacts.mjs';
import { durable } from './a01.mjs';

const [action, name] = process.argv.slice(2);
assert.ok(['a01', 'admission'].includes(name));
const rawRoot = path.join(ROOT, name === 'a01' ? 'a01-evidence' : 'evidence');
const prefix = name === 'a01' ? 'A01' : 'ADMISSION';
const archive = path.join(ROOT, `${prefix}-EVIDENCE.jsonl.gz`);
const sealPath = path.join(ROOT, `${prefix}-EVIDENCE-SEAL.json`);
if (action === 'capture') {
  const entries = await tree(rawRoot); const compressor = createGzip({ level: 9 });
  const completion = pipeline(compressor, createWriteStream(archive, { flags: 'wx', mode: 0o644 }));
  const write = async value => { if (!compressor.write(`${JSON.stringify(value)}\n`)) await once(compressor, 'drain'); };
  try {
    for (const entry of entries) {
      if (entry.directory) await write({ type: 'directory', path: entry.path });
      else {
        await write({ type: 'file', ...entry }); let offset = 0;
        for await (const chunk of createReadStream(path.join(rawRoot, entry.path), { highWaterMark: 65536 })) {
          assert.ok(offset + chunk.length <= entry.bytes); await write({ type: 'chunk', offset, base64: chunk.toString('base64') }); offset += chunk.length;
        }
        assert.equal(offset, entry.bytes); await write({ type: 'end' });
      }
    }
    await write({ type: 'complete', entries: entries.length }); compressor.end(); await completion;
  } catch (error) { compressor.destroy(error); await completion.catch(() => {}); throw error; }
  await verifyTree(rawRoot, entries);
  await durable(sealPath, { schema: 'xan-owned-streamed-evidence-v1', classification: name === 'a01' ? 'SYNTHETIC_CONTROLS_ONLY' : 'ADMISSION_HOLD_NO_PRODUCT',
    captured: new Date().toISOString(), root: path.basename(rawRoot), appendAware: true, entries,
    archive: { path: path.basename(archive), ...await identity(archive) }, transportChunkBytes: 65536, maximumRecordBytes: 131072,
    originalRawRetainedLocally: true, committedTransport: 'streamed JSONL gzip; no extraction needed to verify; no AGENTS copies' });
  console.log(JSON.stringify({ capture: name, seal: await identity(sealPath), archive: await identity(archive), entries: entries.length }));
} else if (action === 'verify') {
  const seal = JSON.parse(await readFile(sealPath, 'utf8'));
  assert.deepEqual(await identity(archive), { bytes: seal.archive.bytes, sha256: seal.archive.sha256, mode: seal.archive.mode });
  const expected = new Map(seal.entries.map(entry => [entry.path, entry]));
  let pending = ''; let active; let hash; let offset = 0; let completed = false; let delivered = 0;
  const bound = seal.entries.filter(entry => !entry.directory).reduce((sum, entry) => sum + Math.ceil(entry.bytes / 3) * 4 + Math.ceil(entry.bytes / 65536) * 160 + 2048, 2048);
  async function record(value) {
    assert.equal(completed, false);
    if (value.type === 'directory') { assert.equal(active, undefined); assert.equal(expected.get(value.path)?.directory, true); expected.delete(value.path); }
    else if (value.type === 'file') {
      assert.equal(active, undefined); const { type, ...entry } = value; assert.deepEqual(entry, expected.get(value.path)); assert.ok(!entry.directory);
      active = entry; hash = createHash('sha256'); offset = 0;
    } else if (value.type === 'chunk') {
      assert.ok(active); assert.equal(value.offset, offset); const bytes = Buffer.from(value.base64, 'base64'); assert.ok(bytes.length <= 65536);
      assert.equal(bytes.toString('base64'), value.base64); offset += bytes.length; assert.ok(offset <= active.bytes); hash.update(bytes);
    } else if (value.type === 'end') {
      assert.ok(active); assert.equal(offset, active.bytes); assert.equal(hash.digest('hex'), active.sha256); expected.delete(active.path); active = undefined;
    } else if (value.type === 'complete') { assert.equal(active, undefined); assert.equal(expected.size, 0); assert.equal(value.entries, seal.entries.length); completed = true; }
    else throw new Error('Unknown evidence record');
  }
  for await (const chunk of createReadStream(archive).pipe(createGunzip())) {
    delivered += chunk.length; assert.ok(delivered <= bound); pending += chunk.toString('utf8');
    let separator;
    while ((separator = pending.indexOf('\n')) >= 0) {
      assert.ok(separator <= 131072); const line = pending.slice(0, separator); pending = pending.slice(separator + 1); await record(JSON.parse(line));
    }
    assert.ok(pending.length <= 131072);
  }
  assert.equal(pending.length, 0); assert.equal(completed, true);
  console.log(JSON.stringify({ verified: name, entries: seal.entries.length, delivered, extraction: false, product: 0 }));
} else throw new Error('Expected capture|verify a01|admission');
