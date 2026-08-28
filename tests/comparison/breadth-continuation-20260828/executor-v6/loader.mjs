import fs from 'node:fs';
import { registerHooks, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { hash, requireThat } from '../executor-v4/safety.mjs';
import { readRegular } from '../executor-v3/regular-read.mjs';

import { authenticateConsumerScope } from '../executor-v5/consumer-scope.mjs';

const stat = fs.lstatSync.bind(fs);
function canonicalFileURL(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return null;
    parsed.search = ''; parsed.hash = '';
    return pathToFileURL(fileURLToPath(parsed)).href;
  } catch { return null; }
}
export function installLoader(view, emit, options = {}) {
  const scope = view.engine ? authenticateConsumerScope(view) : null;
  const entryParentURL = options.entryParentURL;
  if (scope) requireThat(typeof entryParentURL === 'string' && canonicalFileURL(entryParentURL) === entryParentURL, 'CONSUMER_ENTRY_BINDING', entryParentURL ?? null);
  const entryResolutions = [];
  const consumerResolutions = [];
  const files = new Map(view.files.map(file => [pathToFileURL(path.join(view.root, file.path)).href, file]));
  const loaded = [];
  const denied = [];
  function check(url) {
    requireThat(files.has(url), 'UNBOUND_MODULE', url);
    const filename = fileURLToPath(url);
    const entry = files.get(url);
    const info = stat(filename);
    requireThat(info.isFile() && !info.isSymbolicLink() && info.size === entry.bytes && (info.mode & 0o7777) === entry.mode, 'LOAD_METADATA', url);
    const bytes = readRegular(filename, entry.bytes);
    requireThat(hash(bytes) === entry.sha256, 'LOAD_HASH', url);
    return { bytes, entry };
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        if (isBuiltin(specifier)) {
          requireThat(!['inspector', 'inspector/promises', 'vm'].includes(specifier.replace(/^node:/, '')), 'BUILTIN_DENIED', specifier);
          return nextResolve(specifier, context);
        }
        const entryAttempt = scope && canonicalFileURL(specifier) === scope.parentURL;
        if (entryAttempt) {
          const observed = { kind: 'consumer-entry-attempt', stage: 'before-nextResolve', specifier, parentURL: context.parentURL ?? null, parentPresent: Object.hasOwn(context, 'parentURL'), expectedParentURL: entryParentURL, expectedURL: scope.parentURL };
          emit(observed);
          requireThat(context.parentURL === entryParentURL, 'CONSUMER_ENTRY_PARENT', observed);
          requireThat(specifier === scope.parentURL, 'CONSUMER_ENTRY_URL', observed);
        }
        const result = nextResolve(specifier, context);
        let entryResolution;
        if (scope && canonicalFileURL(result.url) === scope.parentURL) {
          entryResolution = { kind: 'consumer-entry-resolution', specifier, parentURL: context.parentURL ?? null, url: result.url, expectedParentURL: entryParentURL, expectedURL: scope.parentURL, accepted: false };
          entryResolutions.push(entryResolution);
          emit({ ...entryResolution, kind: 'consumer-entry-observed' });
          requireThat(context.parentURL === entryParentURL, 'CONSUMER_ENTRY_PARENT', entryResolution);
          requireThat(specifier === scope.parentURL && result.url === scope.parentURL, 'CONSUMER_ENTRY_URL', entryResolution);
        }
        let resolution;
        if (scope && specifier === view.engine) {
          resolution = { kind: 'consumer-resolution', specifier, parentURL: context.parentURL, url: result.url, expectedParentURL: scope.parentURL, accepted: false };
          consumerResolutions.push(resolution);
          emit({ ...resolution, kind: 'consumer-resolution-observed' });
          requireThat(context.parentURL === scope.parentURL, 'CONSUMER_PARENT', resolution);
        }
        requireThat(files.has(result.url), 'UNBOUND_MODULE', { specifier, parent: context.parentURL, url: result.url });
        if (entryResolution) { entryResolution.accepted = true; emit({ ...entryResolution }); }
        if (resolution) { resolution.accepted = true; emit({ ...resolution }); }
        return result;
      } catch (error) { denied.push({ code: error.code, specifier }); emit({ kind: 'load-denied', code: error.code, specifier }); throw error; }
    },
    load(url, context, nextLoad) {
      if (isBuiltin(url)) return nextLoad(url, context);
      try {
        const { bytes, entry } = check(url);
        const result = nextLoad(url, context);
        requireThat(['module', 'commonjs', 'json'].includes(result.format), 'LOAD_FORMAT', { url, format: result.format });
        const source = result.source == null && result.format === 'commonjs' ? bytes : result.source;
        requireThat(source != null && hash(Buffer.from(source)) === entry.sha256, 'RETURNED_SOURCE_HASH', url);
        const witness = { kind: 'nextLoad', path: entry.path, format: result.format, bytes: entry.bytes, sha256: entry.sha256, evaluationProven: false, origin: result.source == null ? 'authenticated-CJS-source-supplied-to-runtime' : 'actual-nextLoad-source' };
        loaded.push(witness); emit(witness);
        return { ...result, source };
      } catch (error) { denied.push({ code: error.code, url }); emit({ kind: 'load-denied', code: error.code, url }); throw error; }
    },
  });
  return { loaded, denied, entryResolutions, consumerResolutions, close: () => hooks.deregister() };
}
