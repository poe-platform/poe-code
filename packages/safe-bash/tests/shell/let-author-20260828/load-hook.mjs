import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import assert from 'node:assert/strict';

const manifestBytes = readFileSync(process.env.LET_BINDING);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(manifestBytes), process.env.LET_BINDING_SHA256);
const manifest = JSON.parse(manifestBytes);
const root = realpathSync(manifest.root);
const receipt = process.env.LET_LOAD_RECEIPT;
writeFileSync(receipt, '', { flag: 'wx' });
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) return nextLoad(url, context);
    if (!url.startsWith('file:')) throw new Error(`UNBOUND_MODULE:${url}`);
    const filename = fileURLToPath(url);
    const name = relative(root, filename);
    const expected = manifest.files[name] ?? manifest.harness[filename];
    if (!expected || realpathSync(filename) !== filename || !lstatSync(filename).isFile()) throw new Error(`UNBOUND_MODULE:${url}`);
    assert.equal(hash(readFileSync(filename)), expected, `MODULE_HASH:${name}`);
    const loaded = nextLoad(url, context);
    if (loaded.source != null) assert.equal(hash(typeof loaded.source === 'string' ? Buffer.from(loaded.source) : loaded.source), expected, `LOADED_BYTES:${name}`);
    appendFileSync(receipt, JSON.stringify({ url, sha256: expected, loaded: true }) + '\n');
    return loaded;
  },
});
for (const [name, expected] of Object.entries(manifest.files)) {
  const filename = resolve(root, name);
  assert.equal(hash(readFileSync(filename)), expected, `PRE:${name}`);
}
