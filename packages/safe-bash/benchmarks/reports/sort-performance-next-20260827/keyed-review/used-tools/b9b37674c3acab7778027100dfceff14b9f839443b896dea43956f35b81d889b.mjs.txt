import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = JSON.parse(readFileSync(root + '/module-manifest.json'));
const loaded = new Map();
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    assert.ok(result.url.startsWith('node:') || result.url.startsWith(new URL('.', import.meta.url).href), result.url);
    return result;
  },
  load(url, context, next) {
    if (!url.startsWith('node:')) {
      const path = realpathSync(fileURLToPath(url));
      const relative = path.slice(root.length + 1);
      assert.ok(path.startsWith(root + '/'));
      const entry = manifest.find(file => file.path === relative);
      assert.ok(entry, relative);
      assert.equal(sha(path), entry.sha256);
      loaded.set(relative, entry.sha256);
    }
    return next(url, context);
  },
});
process.on('exit', () => {
  const modules = [...loaded].map(([path, before]) => { const after = sha(root + '/' + path); assert.equal(after, before); return { path, before, after }; });
  for (const entry of manifest) assert.equal(sha(root + '/' + entry.path), entry.sha256);
  const productPaths = [];
  const walk = path => { for (const entry of readdirSync(path, { withFileTypes: true })) { const child = path + '/' + entry.name; if (entry.isDirectory()) walk(child); else productPaths.push(child.slice(root.length + 1)); } };
  walk(root + '/node_modules/virtual-bash');
  assert.deepEqual(productPaths.sort(), manifest.filter(file => file.path.startsWith('node_modules/virtual-bash/')).map(file => file.path).sort());
  writeFileSync(root + '/loaded-proof.json', JSON.stringify({ modules, productNewEntryDetection: true, allManifestBeforeAfterEqual: true }, null, 2) + '\n');
});
await import('./public-worker.mjs');
