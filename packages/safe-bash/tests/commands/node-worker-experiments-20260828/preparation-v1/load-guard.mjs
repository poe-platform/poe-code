import * as moduleAPI from 'node:module';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = fileURLToPath(new URL('.', import.meta.url));
const inventory = JSON.parse(readFileSync(new URL('./MODULES.json', import.meta.url), 'utf8'));
const loaded = [];

export function installGuard(role) {
  if (typeof moduleAPI.registerHooks !== 'function') throw new Error('K4: synchronous public module hooks unavailable');
  if (!['parent', 'worker', 'compiler'].includes(role)) throw new Error('launch role');
  const files = new Map(inventory.files.map(record => [new URL(record.path, import.meta.url).href, record]));
  function authenticate(url) {
    const record = files.get(url);
    if (!record || !record.roles.includes(role)) throw new Error('unlisted module load: ' + url);
    const filename = fileURLToPath(url);
    if (!filename.startsWith(directory) || !lstatSync(filename).isFile() || realpathSync(filename) !== filename) throw new Error('noncanonical module path');
    const bytes = readFileSync(filename);
    if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw new Error('module body mismatch');
    return { bytes, record };
  }
  moduleAPI.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) {
        if (!inventory.builtins[role].includes(specifier)) throw new Error('unlisted builtin');
        return nextResolve(specifier, context);
      }
      if (specifier === '@poe-code/safejs/core') {
        if (role !== 'worker' || inventory.publicEntry.status !== 'closed') throw new Error('K4: PUBLIC66 lacks src/lint.ts and public-entry emission bindings');
        return { url: new URL(inventory.publicEntry.path, import.meta.url).href, shortCircuit: true };
      }
      if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('file:')) throw new Error('ambient package refused');
      const resolved = nextResolve(specifier, context);
      authenticate(resolved.url);
      return resolved;
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) {
        if (!inventory.builtins[role].includes(url)) throw new Error('unlisted builtin load');
        return nextLoad(url, context);
      }
      const { bytes, record } = authenticate(url);
      const result = nextLoad(url, context);
      if (result.source === null || result.source === undefined || digest(Buffer.from(result.source)) !== digest(bytes)) throw new Error('loaded source mismatch');
      if (loaded.length >= 128) throw new Error('loaded-module record capacity');
      loaded.push({ url: pathToFileURL(fileURLToPath(url)).href, sha256: record.sha256, bytes: record.bytes });
      return result;
    }
  });
  return loaded;
}

export function assertClosedInputs() {
  if (inventory.publicEntry.status !== 'closed') throw new Error('K4_INPUT_MISSING: src/core.ts reexports ./lint.js; src/lint.ts absent from PUBLIC66; do not deep-import src/run.ts');
}
