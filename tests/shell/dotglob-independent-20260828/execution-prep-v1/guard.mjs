import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { digestFile } from './admission.mjs';
import { hash } from './artifacts.mjs';

export function installGuard({ manifest, allowed }) {
  const loaded = new Set();
  registerHooks({ load(url, context, nextLoad) {
    if (url.startsWith('node:')) return nextLoad(url, context);
    assert.ok(url.startsWith('file:'), 'only bound file/node module loads');
    const path = fileURLToPath(url);
    const expected = allowed.get(path);
    assert.ok(expected, `unbound module ${path}`);
    digestFile(path, expected);
    const result = nextLoad(url, context);
    assert.ok(result.source !== null && result.source !== undefined, 'actual module source required');
    assert.equal(hash(Buffer.from(result.source)), expected, 'loaded source identity');
    if (!loaded.has(path)) {
      loaded.add(path);
      process.stdout.write(JSON.stringify({ load: { path, sha256: expected } }) + '\n');
    }
    return result;
  } });
  process.stdout.write(JSON.stringify({ admission: { kind: manifest.kind, node: process.execPath, version: process.version } }) + '\n');
}
