import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtureRoot = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
const packageRoot = realpathSync(fixtureRoot + '/node_modules/virtual-bash');
const fixtureURL = pathToFileURL(fixtureRoot + '/').href;
const packageURL = pathToFileURL(packageRoot + '/').href;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(fixtureRoot + '/manifest.json'));
for (const file of manifest) assert.equal(hash(readFileSync(fixtureRoot + '/' + file.path)), file.sha256);
const loaded = new Map();
let nativeCalls = 0;
childProcess.spawnSync = () => { nativeCalls++; throw new Error('fresh native probes forbidden in pinned replay'); };
syncBuiltinESMExports();
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    assert.ok(result.url.startsWith('node:') || result.url.startsWith(fixtureURL), result.url);
    return result;
  },
  load(url, context, next) {
    if (!url.startsWith('node:')) {
      const path = realpathSync(fileURLToPath(url));
      assert.ok(path.startsWith(fixtureRoot + '/'));
      const relative = path.slice(fixtureRoot.length + 1);
      const expected = manifest.find(file => file.path === relative);
      assert.ok(expected, relative);
      const before = hash(readFileSync(path));
      assert.equal(before, expected.sha256);
      loaded.set(relative, { path: relative, before, product: url.startsWith(packageURL) });
    }
    return next(url, context);
  },
});
process.on('exit', () => {
  const modules = [...loaded.values()].map(file => {
    const after = hash(readFileSync(fixtureRoot + '/' + file.path));
    assert.equal(after, file.before);
    return { ...file, after };
  });
  for (const file of manifest) assert.equal(hash(readFileSync(fixtureRoot + '/' + file.path)), file.sha256);
  assert.equal(nativeCalls, 0);
  writeFileSync(fixtureRoot + '/proof.json', JSON.stringify({ modules, sourceAndPackageBeforeAfterEqual: true, nativeCalls, packageRoot }, null, 2) + '\n');
});
await import('./regressions.mjs');
await import('./borrowed.mjs');
await import('./io.mjs');
await import('./hidden.mjs');
