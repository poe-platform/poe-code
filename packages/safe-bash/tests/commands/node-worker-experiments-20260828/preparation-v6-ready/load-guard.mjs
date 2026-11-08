import * as moduleAPI from 'node:module';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authorizeEdge } from './import-policy.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = new URL('.', import.meta.url);
const path = new URL('./MODULES.json', import.meta.url);
const stat = lstatSync(path);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw Error('manifest admission');
const inventory = JSON.parse(readFileSync(path, 'utf8'));
const loaded = [];
export function assertClosedInputs() { if (inventory.publicEntry.status !== 'compiled-source-bound-not-runtime-qualified') throw Error('closed composition required'); }
export function installGuard(role) {
  if (typeof moduleAPI.registerHooks !== 'function' || !['parent','worker'].includes(role)) throw Error('hook/role admission');
  const records = new Map(inventory.files.map(record => [new URL(record.path, directory).href, record]));
  const admittedBuiltins = new Set();
  function authenticate(url) {
    const record = records.get(url);
    if (!record || !record.roles.includes(role)) throw Error('unlisted file/role');
    const filename = fileURLToPath(url); const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(filename) !== filename || stat.size !== record.bytes || stat.size > 2097152) throw Error('regular module admission');
    const bytes = readFileSync(filename);
    if (digest(bytes) !== record.sha256) throw Error('module hash');
    return { record, bytes };
  }
  moduleAPI.registerHooks({
    resolve(specifier, context) {
      const { record } = authenticate(context.parentURL);
      const target = authorizeEdge(inventory, record.path, specifier, role, record.sha256);
      if (target.startsWith('node:')) { admittedBuiltins.add(target); return { url: target, shortCircuit: true }; }
      const url = new URL(target, directory).href; authenticate(url);
      return { url, shortCircuit: true };
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) { if (!admittedBuiltins.has(url)) throw Error('builtin without importer admission'); return nextLoad(url, context); }
      const { record, bytes } = authenticate(url);
      if (loaded.length >= 256) throw Error('load record cap');
      loaded.push({ path: record.path, bytes: bytes.length, sha256: record.sha256 });
      return { format: 'module', shortCircuit: true, source: bytes };
    }
  });
  return loaded;
}
