import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative } from 'node:path';
import { assertTree, canonical, fileDigest, inside, readRegular, requireFact } from './primitives.mjs';

const BUILTINS = new Set(['node:path', 'node:util', 'node:stream/web', 'node:timers/promises']);
export function validateResolution(root, manifest, entry, specifier, parentURL, initial = false) {
  if (specifier.startsWith('node:')) { requireFact(!initial && BUILTINS.has(specifier), 'LOADER_BUILTIN', specifier); return specifier; }
  requireFact(!specifier.includes('?') && !specifier.includes('#'), 'LOADER_URL_DECORATION');
  let candidate;
  if (initial) { requireFact(specifier === pathToFileURL(join(root, entry)).href, 'LOADER_INITIAL_ENTRY'); candidate = specifier; }
  else {
    requireFact(typeof parentURL === 'string' && parentURL.startsWith('file:') && inside(root, fileURLToPath(parentURL)), 'LOADER_PARENT');
    requireFact(specifier.startsWith('./') || specifier.startsWith('../'), 'LOADER_PACKAGE_OR_HOST_FALLBACK');
    candidate = new URL(specifier, parentURL).href;
  }
  const filename = fileURLToPath(candidate);
  requireFact(inside(root, filename) && /\.(?:mjs|js)$/u.test(filename), 'LOADER_PATH');
  const suffix = relative(root, filename).split('\\').join('/');
  requireFact(manifest.files[suffix] && canonical(fileDigest(filename)) === canonical(manifest.files[suffix]), 'LOADER_FILE', suffix);
  return candidate;
}
export async function withCandidateLoad(materialization, callback, event) {
  const { root, manifest } = materialization;
  const entry = materialization.relativeEntry;
  assertTree(root, manifest);
  const loaded = [];
  const entryURL = pathToFileURL(join(root, entry)).href;
  let initial = true;
  const parents = new Map();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error('NETWORK_DENIED'), { unsafe: true }); };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const first = initial && specifier === entryURL;
      const url = validateResolution(root, manifest, entry, specifier, context.parentURL, first);
      if (first) initial = false;
      if (url.startsWith('node:')) return nextResolve(url, context);
      requireFact(typeof context.parentURL === 'string' && context.parentURL.startsWith('file:'), 'LOADER_PARENT_EVIDENCE');
      parents.set(url, context.parentURL);
      return { url, shortCircuit: true };
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) { requireFact(BUILTINS.has(url), 'LOADER_BUILTIN'); return nextLoad(url, context); }
      const filename = fileURLToPath(url);
      requireFact(inside(root, filename), 'LOADER_LOAD_ESCAPE');
      const suffix = relative(root, filename).split('\\').join('/');
      requireFact(manifest.files[suffix] && canonical(fileDigest(filename)) === canonical(manifest.files[suffix]), 'LOADER_LOAD_HASH');
      requireFact(loaded.length < 4096, 'LOAD_COUNT');
      const proof = { path: filename, relativePath: suffix, sha256: manifest.files[suffix].sha256, bytes: manifest.files[suffix].bytes, actualLoad: true, parentURL: parents.get(url) };
      loaded.push(proof);
      event(proof);
      return { format: 'module', source: readRegular(filename), shortCircuit: true };
    },
  });
  try {
    const namespace = await import(entryURL);
    requireFact(loaded.some(proof => proof.relativePath === entry), 'ENTRY_NOT_ACTUALLY_LOADED');
    return { value: await callback(namespace), loaded };
  } finally { hooks.deregister(); globalThis.fetch = previousFetch; assertTree(root, manifest); }
}
