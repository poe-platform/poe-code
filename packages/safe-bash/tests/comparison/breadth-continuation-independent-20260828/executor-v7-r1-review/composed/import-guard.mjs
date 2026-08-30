import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin, registerHooks } from 'node:module';
import { home, candidateRoot, digest } from './auth.mjs';

const seal = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
const allowed = new Map([...seal.owned.filter(entry => entry.path.endsWith('.mjs')).map(entry => [path.join(home, entry.path), entry.sha256]), ...seal.actualImports.map(entry => [path.resolve(candidateRoot, entry.path), entry.sha256])]);
const events = [];
const record = event => { if (events.length >= 256) throw new Error('OWNED_IMPORT_EVENT_BOUND'); events.push(event); };
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (isBuiltin(result.url)) return result;
    const filename = fileURLToPath(result.url);
    if (!allowed.has(filename)) { record({ denied: result.url }); throw new Error('OWNED_IMPORT_NOT_PRESEALED'); }
    return result;
  },
  load(url, context, nextLoad) {
    if (isBuiltin(url)) return nextLoad(url, context);
    const filename = fileURLToPath(url);
    if (!allowed.has(filename)) throw new Error('OWNED_LOAD_NOT_PRESEALED');
    const result = nextLoad(url, context);
    if (result.source === null || result.source === undefined || digest(Buffer.from(result.source)) !== allowed.get(filename)) throw new Error('OWNED_RETURNED_SOURCE_CHANGED');
    record({ path: path.relative(home, filename), sha256: allowed.get(filename) });
    return result;
  },
});
export const snapshotImports = () => events.map(event => ({ ...event }));
process.once('exit', () => {
  hook.deregister();
  const bytes = Buffer.from(`${JSON.stringify({ classification: 'SYNTHETIC_IMPORT_ALLOWLIST_NOT_HOST_SANDBOX', pid: process.pid, events })}\n`);
  if (bytes.length > 262144) throw new Error('OWNED_IMPORT_RECORD_CAP');
  fs.writeFileSync(path.join(home, 'evidence-01/imports', `${process.pid}.json`), bytes, { flag: 'wx' });
});
