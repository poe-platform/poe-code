import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { hash, read, save } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url));
assert(!existsSync(join(own, 'RETIREMENT.json')));
for (const [archive, manifest] of [['run05.json.gz.base64', 'run05.MANIFEST.json'], ['SETUP-ATTEMPTS.json.gz.base64', 'SETUP-ATTEMPTS.json']]) {
  const metadata = read(join(own, manifest)), compressed = Buffer.from(readFileSync(join(own, archive), 'utf8'), 'base64');
  assert.equal(hash(compressed), metadata.compressedSHA256); const files = JSON.parse(gunzipSync(compressed));
  assert.deepEqual(Object.keys(files).sort(), Object.keys(metadata.files).sort());
  for (const [path, digest] of Object.entries(metadata.files)) assert.equal(hash(Buffer.from(files[path], 'base64')), digest);
}
const verification = read(join(own, 'VERIFIED.json')); assert(verification.allGroupsGoneAtReceipt);
const retired = [];
for (const name of ['run01', 'run02', 'run03', 'run04', 'run05']) {
  const path = join(own, name); assert.equal(realpathSync(path), path); assert(path.startsWith(own + '/'));
  rmSync(path, { recursive: true }); assert(!existsSync(path)); retired.push(name);
}
save(join(own, 'RETIREMENT.json'), { at: new Date().toISOString(), retired, archivesReverifiedBeforeRemovingOwnMaterialization: true, allGroupsGoneAtReceipt: true, scope: 'Only newly created review capture/materialization directories retired. Raw evidence remains losslessly archived; development-tool copies removed. Existing files, other owners, staging and native artifacts untouched.' });
console.log(JSON.stringify({ retired, evidencePreserved: true }));
