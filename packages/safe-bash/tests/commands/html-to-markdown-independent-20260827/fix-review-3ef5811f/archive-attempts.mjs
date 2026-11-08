import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hash, read, save } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), archivePath = join(own, 'SETUP-ATTEMPTS.json.gz.base64'), manifestPath = join(own, 'SETUP-ATTEMPTS.json');
if (process.argv[2] === 'verify') {
  const metadata = read(manifestPath), compressed = Buffer.from(readFileSync(archivePath, 'utf8'), 'base64'); assert.equal(hash(compressed), metadata.compressedSHA256);
  const files = JSON.parse(gunzipSync(compressed)); assert.deepEqual(Object.keys(files).sort(), Object.keys(metadata.files).sort());
  for (const [path, encoded] of Object.entries(files)) assert.equal(hash(Buffer.from(encoded, 'base64')), metadata.files[path]);
  console.log(JSON.stringify({ files: Object.keys(files).length, verified: true }));
} else {
  assert(!existsSync(archivePath)); const files = {}, digests = {};
  function visit(path, prefix) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && ['tools', 'node_modules'].includes(entry.name)) continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(join(path, entry.name), relative + '/');
      else { assert(entry.isFile()); const bytes = readFileSync(join(path, entry.name)); files[relative] = bytes.toString('base64'); digests[relative] = hash(bytes); }
    }
  }
  for (const name of ['run01', 'run02', 'run03', 'run04']) visit(join(own, name), name + '/');
  const compressed = gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 }); writeFileSync(archivePath, compressed.toString('base64') + '\n');
  save(manifestPath, { scope: 'Failed setup attempts only, no product executions. Materialized inputs, available pre-run attestations, original driver versions and all captured subprocess output retained. Copied development tools excluded; authenticated inventories exist where admission reached PRE-RUN.', compressedSHA256: hash(compressed), files: digests });
  console.log(JSON.stringify({ files: Object.keys(files).length, compressedSHA256: hash(compressed) }));
}
