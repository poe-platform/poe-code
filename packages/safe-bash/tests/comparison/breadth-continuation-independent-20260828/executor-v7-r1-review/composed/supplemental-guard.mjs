import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin, registerHooks } from 'node:module';
import { home, candidateRoot, digest } from './auth.mjs';

const original = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
const supplement = JSON.parse(fs.readFileSync(path.join(home, 'SUPPLEMENTAL-PRESEAL.json')));
const allowed = new Map([...original.owned, ...supplement.owned].filter(entry => entry.path.endsWith('.mjs')).map(entry => [path.join(home, entry.path), entry.sha256]));
for (const entry of original.actualImports) allowed.set(path.resolve(candidateRoot, entry.path), entry.sha256);
const events = [];
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (!isBuiltin(result.url) && !allowed.has(fileURLToPath(result.url))) throw new Error('SUPPLEMENTAL_IMPORT_NOT_SEALED');
    return result;
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (isBuiltin(url)) return result;
    const filename = fileURLToPath(url);
    if (events.length >= 256 || !allowed.has(filename) || result.source == null || digest(Buffer.from(result.source)) !== allowed.get(filename)) throw new Error('SUPPLEMENTAL_SOURCE_BINDING');
    events.push({ path: path.relative(home, filename), sha256: allowed.get(filename) });
    return result;
  },
});
process.once('exit', () => { hook.deregister(); fs.writeFileSync(path.join(home, 'evidence-02/IMPORTS.json'), `${JSON.stringify({ pid: process.pid, events })}\n`, { flag: 'wx' }); });
