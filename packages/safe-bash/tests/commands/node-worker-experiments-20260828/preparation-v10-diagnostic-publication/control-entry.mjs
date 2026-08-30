import { registerHooks } from 'node:module';
import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const root = new URL('.', import.meta.url);
const presealUrl = new URL('PRESEAL.json', root);
const presealStat = lstatSync(presealUrl);
if (!presealStat.isFile() || presealStat.isSymbolicLink() || presealStat.size > 65536) throw Error('preseal admission');
const seal = JSON.parse(readFileSync(presealUrl, 'utf8'));
const records = new Map(seal.modules.map(record => [new URL(record.path, root).href, record]));
const loaded = [], edges = [];
function authenticate(url) {
  const record = records.get(url);
  if (!record) throw Error('unknown module');
  const filename = fileURLToPath(url), stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(filename) !== filename || stat.size !== record.bytes || stat.size > 65536) throw Error('module admission');
  const bytes = readFileSync(filename);
  if (digest(bytes) !== record.sha256) throw Error('module hash');
  return { record, bytes };
}
authenticate(import.meta.url);
const builtins = new Set();
registerHooks({
  resolve(specifier, context) {
    const { record } = authenticate(context.parentURL);
    const edge = record.edges.find(edge => edge.specifier === specifier);
    if (!edge || edges.length >= 32) throw Error('unsealed edge');
    edges.push({ importer: record.path, specifier, target: edge.target });
    if (edge.target.startsWith('node:')) { builtins.add(edge.target); return { url: edge.target, shortCircuit: true }; }
    const url = new URL(edge.target, root).href;
    authenticate(url);
    return { url, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) { if (!builtins.has(url)) throw Error('builtin without edge'); return nextLoad(url, context); }
    const { record, bytes } = authenticate(url);
    if (loaded.length >= 16) throw Error('load cap');
    loaded.push({ path: record.path, bytes: bytes.length, sha256: record.sha256 });
    return { format: 'module', shortCircuit: true, source: bytes };
  }
});
await import('./controls.mjs');
await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({schema:'repair-control-loads-v1',loaded,edges})+'\n',error=>error?reject(error):resolve()));
