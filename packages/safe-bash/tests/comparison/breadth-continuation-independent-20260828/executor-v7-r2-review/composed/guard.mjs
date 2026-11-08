import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { registerHooks, isBuiltin } from 'node:module';

const home = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(home, '../../../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
const events = [], denied = [], late = [];
function inspect(entry) {
  const filename = path.resolve(repository, entry.path);
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.bytes || (info.mode & 0o7777) !== entry.mode) throw new Error(`INPUT_METADATA:${entry.path}`);
  const hasher = createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  const buffer = Buffer.alloc(65536);
  try {
    for (let amount; (amount = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0;) hasher.update(buffer.subarray(0, amount));
  } finally { fs.closeSync(descriptor); }
  const sha256 = hasher.digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`INPUT_HASH:${entry.path}`);
  return { ...entry, sha256 };
}
export function authenticate() {
  const inputs = seal.inputs.map(inspect);
  const names = fs.readdirSync(path.resolve(repository, seal.candidateDirectory)).filter(name => name !== 'runs').sort();
  if (JSON.stringify(names) !== JSON.stringify(seal.candidateNames)) throw new Error('CANDIDATE_NEW_ENTRY');
  return { inputs, candidateNames: names, sealSha256: digest(fs.readFileSync(path.join(home, 'PRESEAL.json'))) };
}
authenticate();
if (process.env.NODE_OPTIONS) throw new Error('AMBIENT_NODE_OPTIONS');
const allowed = new Map(seal.loadedAllowlist.map(member => {
  const input = seal.inputs.find(entry => entry.path === member);
  if (!input) throw new Error('ALLOWLIST_BINDING');
  return [path.resolve(repository, member), input];
}));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (!isBuiltin(result.url) && !allowed.has(fileURLToPath(result.url))) {
      denied.push(result.url); throw new Error('UNSEALED_IMPORT');
    }
    return result;
  },
  load(url, context, nextLoad) {
    if (isBuiltin(url)) return nextLoad(url, context);
    const entry = allowed.get(fileURLToPath(url));
    if (!entry || events.length >= 256) throw new Error('LOAD_BOUND');
    inspect(entry);
    const result = nextLoad(url, context);
    if (result.format !== 'module' || result.source == null || digest(Buffer.from(result.source)) !== entry.sha256) throw new Error('RETURNED_BODY_HASH');
    events.push({ path: entry.path, bytes: Buffer.byteLength(result.source), sha256: entry.sha256, actualNextLoad: true });
    return result;
  },
});
process.on('unhandledRejection', error => { late.push({ kind: 'unhandledRejection', type: typeof error, code: error?.code ?? null }); process.exitCode = 1; });
process.on('uncaughtExceptionMonitor', error => { late.push({ kind: 'uncaughtException', type: typeof error, code: error?.code ?? null }); });
process.once('exit', code => {
  const directory = path.join(home, 'evidence-01/imports');
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify({ pid: process.pid, code, argv: process.argv, execArgv: process.execArgv, events, denied, late, resources: process.getActiveResourcesInfo(), classification: 'ACTUAL_LOADS_NOT_HOST_SANDBOX' })}\n`);
  if (bytes.length > 262144) throw new Error('WITNESS_CAP');
  fs.writeFileSync(path.join(directory, `${process.pid}.json`), bytes, { flag: 'wx', mode: 0o644 });
});
