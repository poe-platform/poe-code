import fs from 'node:fs';
import workers from 'node:worker_threads';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { admit, bytes, hash, journal, own, reason, requireValue, stickyKey, witness } from './common.mjs';

const ownURL = new URL(import.meta.url);
requireValue([...ownURL.searchParams.keys()].sort().join(',') === 'config,sha256', 'PRELOAD_ARGUMENTS');
const configurationURL = ownURL.searchParams.get('config'), sha256 = ownURL.searchParams.get('sha256');
requireValue(/^[a-f0-9]{64}$/.test(sha256), 'CONFIG_HASH_SCHEMA');
const raw = bytes(fileURLToPath(configurationURL), 32768);
requireValue(hash(raw) === sha256, 'CONFIG_HASH');
const configuration = own(JSON.parse(raw), ['schema','token','entry','members','tools','preload','offline','log','fault']);
requireValue(configuration.schema === 'NESTED_REGEX_CONFIG_V1' && !workers.isMainThread, 'CHILD_ROLE');
const flag = witness(workers.getEnvironmentData(stickyKey), configuration.token), output = journal(configuration.log);
const bindings = new Map([...configuration.members, ...configuration.tools].map(row => [row.url, row]));
const token = configuration.token;
const emit = event => {
  try {
    if (configuration.fault === 'publication' && event.event === 'load' && event.role === 'product') throw new Error('INJECTED_CHILD_PUBLICATION');
    output.emit({ token, ...event });
  } catch (error) { Atomics.store(flag, 0, 1); throw error; }
};
const refuse = (code, detail) => {
  Atomics.store(flag, 0, 1);
  const error = Object.assign(new Error(code), { code });
  try { emit({ event: 'refused', code, detail: String(detail).slice(0,1024) }); } catch {}
  throw error;
};
for (const member of [...configuration.members, ...configuration.tools]) admit(member);
const ownBase = new URL(import.meta.url); ownBase.search = '';
requireValue(ownBase.href === configuration.preload && process.execArgv.length === 2 && process.execArgv[0] === '--import' && process.execArgv[1] === ownURL.href, 'EFFECTIVE_ARGV');
emit({ event: 'bootstrap', requestedExecArgv: [], effectiveExecArgv: process.execArgv, workerDataUndefined: workers.workerData === undefined, sharedBytes: 4 });
if (configuration.fault === 'startup') refuse('INJECTED_STARTUP_FAILURE', 'pre-entry');
const admittedBuiltins = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL ? bindings.get(context.parentURL.split('?')[0]) : null;
    const target = nextResolve(specifier, context);
    if (context.parentURL === ownURL.href && specifier === configuration.offline) return target;
    if (!parent) { if (!context.parentURL && target.url === configuration.entry) return target; return refuse('IMPORT_PARENT', context.parentURL); }
    if (!parent.imports.includes(specifier)) return refuse('IMPORT_EDGE', specifier);
    if (target.url.startsWith('node:')) {
      if (parent.role === 'product' && !['node:buffer','node:worker_threads'].includes(target.url)) return refuse('BUILTIN', target.url);
      admittedBuiltins.add(target.url);
    } else if (!bindings.has(target.url)) return refuse('IMPORT_TARGET', target.url);
    return target;
  },
  load(url, context, nextLoad) {
    try {
      if (url.startsWith('node:')) { requireValue(admittedBuiltins.has(url), 'UNRESOLVED_BUILTIN'); emit({ event: 'builtin', url }); return nextLoad(url, context); }
      const binding = bindings.get(url);
      requireValue(Boolean(binding), 'LOAD_BINDING'); admit(binding);
      const loaded = nextLoad(url, context);
      admit(binding, configuration.fault === 'loaded-source' && binding.role === 'product' ? 'changed' : loaded.source);
      emit({ event: 'load', role: binding.role, ...admit(binding, loaded.source) });
      return loaded;
    } catch (error) { return refuse(error.code ?? 'LOAD_REFUSAL', url); }
  },
});
const module = await import(configuration.offline);
const root = '/Users/kjopek/Workspace/safe-bash';
const offline = module.installOffline({ root, files: [...bindings.values()].map(row => ({ path: fileURLToPath(row.url).slice(root.length + 1), bytes: row.bytes, mode: row.mode, sha256: row.sha256 })) }, event => { if (event.kind === 'offline-denied') { Atomics.store(flag, 0, 1); emit({ event: 'offline-refused', detail: event.operation }); } });
workers.Worker = class { constructor() { refuse('RECURSIVE_WORKER', 'denied'); } };
workers.getEnvironmentData = () => refuse('PRODUCT_ENVIRONMENT_DATA', 'denied');
workers.setEnvironmentData = () => refuse('PRODUCT_ENVIRONMENT_DATA', 'denied');
syncBuiltinESMExports();
process.on('unhandledRejection', error => { Atomics.store(flag, 0, 1); try { emit({ event: 'unhandled', reason: reason(error) }); } catch {} });
process.on('exit', code => { try { emit({ event: 'thread-exit', code, sticky: Atomics.load(flag, 0), pending: offline.receipt().pending }); } finally { output.close(); } });
