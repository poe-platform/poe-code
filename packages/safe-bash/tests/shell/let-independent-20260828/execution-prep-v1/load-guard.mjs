import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, readAdmission } from './support.mjs';

const manifest = readAdmission(process.env.LET_MANIFEST, process.env.LET_MANIFEST_SHA256);
const allowed = new Map();
for (const [name, digest] of Object.entries(manifest.files)) allowed.set(join(manifest.packageRoot, name), digest);
for (const [name, digest] of Object.entries(manifest.harnessFiles)) allowed.set(join(manifest.harnessRoot, name), digest);
const loaded = new Set();
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) return nextLoad(url, context);
    assert.ok(url.startsWith('file:'), 'only node: and authenticated file: module loads');
    const path = fileURLToPath(url);
    assert.equal(realpathSync(path), path, 'no symlink module alias');
    const expected = allowed.get(path); assert.ok(expected, `unbound module ${path}`);
    assert.equal(hash(readFileSync(path)), expected, `changed module ${path}`);
    const result = nextLoad(url, context);
    assert.ok(result.source !== null && result.source !== undefined, `missing actual module source ${path}`);
    assert.equal(hash(Buffer.from(result.source)), expected, `transformed or mismatched source ${path}`);
    if (!loaded.has(path)) { loaded.add(path); process.stdout.write(JSON.stringify({ load: { path, sha256: expected } }) + '\n'); }
    return result;
  },
});
process.stdout.write(JSON.stringify({ admission: { node: process.execPath, version: process.version, manifestSha256: process.env.LET_MANIFEST_SHA256, runtimeSha256: manifest.files['dist/shell/runtime.js'] } }) + '\n');
