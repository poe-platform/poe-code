import { decode } from './manifest.mjs';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export function installLoader(job) {
  const allowed = new Map();
  const harnessURLs = new Set();
  for (const graph of job.graphs) for (const [name, entry] of Object.entries(graph.manifest)) {
    if (entry.kind === 'file' && name.endsWith('.js')) allowed.set(pathToFileURL(path.join(graph.product, name)).href, { ...entry, relative: name, graph: graph.id });
  }
  for (const [name, entry] of Object.entries(job.harness)) if (name.endsWith('.mjs')) {
    const url = pathToFileURL(path.join(job.consumer, name)).href;
    allowed.set(url, { ...entry, relative: name, graph: 'harness' }); harnessURLs.add(url);
  }
  const loads = [];
  const productBuiltins = new Set(['node:async_hooks', 'node:buffer', 'node:crypto', 'node:events', 'node:fs', 'node:fs/promises', 'node:http', 'node:https', 'node:net', 'node:path', 'node:perf_hooks', 'node:stream', 'node:stream/promises', 'node:stream/web', 'node:timers', 'node:timers/promises', 'node:url', 'node:util', 'node:worker_threads', 'node:zlib']);
  const harnessBuiltins = new Set([...productBuiltins, 'node:assert/strict']);
  const deny = detail => { throw new Error(`AP_753_LOADER_DENIED:${detail}`); };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) {
        if (!(harnessURLs.has(context.parentURL) ? harnessBuiltins : productBuiltins).has(specifier)) deny(specifier);
        return nextResolve(specifier, context);
      }
      if (!specifier.startsWith('.') && !specifier.startsWith('file:') && !(specifier === 'virtual-bash' && harnessURLs.has(context.parentURL))) deny(specifier);
      const result = nextResolve(specifier, context);
      if (!allowed.has(result.url)) deny(result.url);
      assert.equal(fs.realpathSync(fileURLToPath(result.url)), fileURLToPath(result.url));
      return result;
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) return nextLoad(url, context);
      const entry = allowed.get(url); if (!entry) deny(url);
      const stat = fs.lstatSync(fileURLToPath(url)); assert.ok(stat.isFile() && !stat.isSymbolicLink());
      assert.equal(stat.mode & 0o777, entry.mode);
      const result = nextLoad(url, context);
      const bytes = Buffer.from(result.source);
      assert.equal(bytes.length, entry.bytes);
      const digest = createHash('sha256').update(bytes).digest('hex'); assert.equal(digest, entry.sha256);
      assert.ok(loads.length < 6000, 'bounded loaded graph');
      loads.push({ url, relative: entry.relative, graph: entry.graph, bytes: bytes.length, sha256: digest, mode: entry.mode, format: result.format });
      return result;
    },
  });
  for (const name of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen']) Object.defineProperty(process, name, { value() { deny(`ambient:${name}`); }, writable: false, configurable: false });
  Object.defineProperty(globalThis, 'fetch', { configurable: false, get() { return () => deny('fetch'); }, set(value) { assert.equal(typeof value, 'function'); } });
  Object.defineProperty(globalThis, 'WebSocket', { value: undefined, writable: false, configurable: false });
  return loads;
}

export function installPacketLoader(packet, authority) { const job = decode(packet, authority); return { job, loads: installLoader(job) }; }
