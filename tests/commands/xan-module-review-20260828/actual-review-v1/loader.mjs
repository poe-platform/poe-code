import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export function installLoader(root, entries, builtinMap, trustedFixtures = []) {
  const allowed = new Map(entries.filter(entry => !entry.directory).map(entry => [pathToFileURL(path.join(root, entry.path)).href, entry]));
  for (const fixture of trustedFixtures) allowed.set(pathToFileURL(fixture.filename).href, fixture);
  const loads = [];
  const deny = detail => { throw new Error(`ACTUAL_LOADER_DENIED:${detail}`); };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) {
        const parent = context.parentURL?.startsWith(pathToFileURL(root + '/').href) ? fileURLToPath(context.parentURL).slice(root.length + 1) : '';
        if (!builtinMap[parent]?.includes(specifier)) deny(specifier);
        return nextResolve(specifier, context);
      }
      if (!specifier.startsWith('.') && !specifier.startsWith('file:')) deny(specifier);
      const resolved = nextResolve(specifier, context);
      if (!allowed.has(resolved.url)) deny(resolved.url);
      const filename = fileURLToPath(resolved.url);
      assert.ok(!lstatSync(filename).isSymbolicLink()); assert.equal(realpathSync(filename), filename);
      return resolved;
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) return nextLoad(url, context);
      const entry = allowed.get(url); if (!entry) deny(url);
      const loaded = nextLoad(url, context);
      const bytes = typeof loaded.source === 'string' ? Buffer.from(loaded.source) : Buffer.from(loaded.source);
      const hash = createHash('sha256').update(bytes).digest('hex');
      assert.equal(bytes.length, entry.bytes, `actual nextLoad bytes ${url}`); assert.equal(hash, entry.sha256, `actual nextLoad hash ${url}`);
      assert.ok(loads.length < 1200); loads.push({ url, bytes: bytes.length, sha256: hash, format: loaded.format });
      return loaded;
    },
  });
  for (const name of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen']) Object.defineProperty(process, name, { value() { deny(`ambient:${name}`); }, writable: false, configurable: false });
  for (const name of ['fetch', 'WebSocket']) Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
  return loads;
}
