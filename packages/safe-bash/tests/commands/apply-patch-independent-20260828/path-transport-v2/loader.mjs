import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export function installLoader(product, entries, worker, workerEntry) {
  const allowed = new Map(Object.entries(entries).filter(([name, entry]) => entry.kind === 'file' && name.endsWith('.js')).map(([name, entry]) => [pathToFileURL(path.join(product, name)).href, { ...entry, relative: name }]));
  const workerURL = pathToFileURL(worker).href;
  allowed.set(workerURL, { ...workerEntry, relative: 'worker.mjs' });
  const loads = [];
  const productBuiltins = new Set(['node:async_hooks', 'node:buffer', 'node:crypto', 'node:events', 'node:fs', 'node:fs/promises', 'node:http', 'node:https', 'node:net', 'node:path', 'node:perf_hooks', 'node:stream', 'node:stream/promises', 'node:stream/web', 'node:timers', 'node:timers/promises', 'node:url', 'node:util', 'node:worker_threads', 'node:zlib']);
  const workerBuiltins = new Set(['node:assert/strict', 'node:fs', 'node:path', 'node:url', 'node:timers/promises', 'node:crypto']);
  const deny = detail => { throw new Error(`AP_ACTUAL_LOADER_DENIED:${detail}`); };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) {
        const permitted = context.parentURL === workerURL ? workerBuiltins : productBuiltins;
        if (!permitted.has(specifier)) deny(specifier);
        return nextResolve(specifier, context);
      }
      if (!specifier.startsWith('.') && !specifier.startsWith('file:') && !(specifier === 'virtual-bash' && context.parentURL === workerURL)) deny(specifier);
      const resolved = nextResolve(specifier, context);
      if (!allowed.has(resolved.url)) deny(resolved.url);
      const filename = fileURLToPath(resolved.url);
      assert.equal(realpathSync(filename), filename);
      assert.ok(lstatSync(filename).isFile());
      return resolved;
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) return nextLoad(url, context);
      const entry = allowed.get(url);
      if (!entry) deny(url);
      const filename = fileURLToPath(url);
      assert.equal(lstatSync(filename).mode & 0o777, entry.mode, `load mode ${url}`);
      const loaded = nextLoad(url, context);
      const bytes = typeof loaded.source === 'string' ? Buffer.from(loaded.source) : Buffer.from(loaded.source);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      assert.equal(bytes.length, entry.bytes, `load bytes ${url}`);
      assert.equal(sha256, entry.sha256, `load hash ${url}`);
      assert.ok(loads.length < 1200);
      loads.push({ url, relative: entry.relative, bytes: bytes.length, sha256, mode: entry.mode, format: loaded.format });
      return loaded;
    },
  });
  for (const name of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen']) Object.defineProperty(process, name, { value() { deny(`ambient:${name}`); }, writable: false, configurable: false });
  for (const name of ['fetch', 'WebSocket']) Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
  return loads;
}
