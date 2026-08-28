import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hash, save } from '../execution-prep-v1/artifacts.mjs';
for (const name of ['baseline-01', 'baseline-02']) {
  const original = readFileSync(new URL(name + '.json', import.meta.url));
  const compressed = gzipSync(original), encoded = Buffer.from(compressed.toString('base64') + '\n');
  assert.deepEqual(gunzipSync(Buffer.from(encoded.toString().trim(), 'base64')), original);
  writeFileSync(new URL(name + '.json.gz.base64', import.meta.url), encoded, { flag: 'wx' });
  save(fileURLToPath(new URL(name + '.seal.json', import.meta.url)), { originalPath: name + '.json', originalSha256: hash(original), originalBytes: original.length, compressedSha256: hash(compressed), encodedSha256: hash(encoded), exactByteRoundTrip: true });
}
