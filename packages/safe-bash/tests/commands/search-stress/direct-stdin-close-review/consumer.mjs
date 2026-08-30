import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import workerThreads from 'node:worker_threads';
import { runCase, caseNames } from './cases.mjs';

const name = process.argv[2];
if (!caseNames.includes(name)) throw new Error('explicit frozen case name required');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = [];
const workerEvents = [];
const live = new Set();
const OriginalWorker = workerThreads.Worker;
workerThreads.Worker = class extends OriginalWorker {
  constructor(url, options) {
    const filename = fileURLToPath(url);
    const event = { url: String(url), sha256: digest(readFileSync(filename)), options, exited: false };
    super(url, options);
    workerEvents.push(event);
    live.add(this);
    this.once('exit', code => { event.exited = true; event.exitCode = code; live.delete(this); });
  }
};
syncBuiltinESMExports();
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url.startsWith('file:')) modules.push({ url, sha256: digest(readFileSync(fileURLToPath(url))) });
  return result;
} });
const resolved = import.meta.resolve('virtual-bash');
const api = await import('virtual-bash');
const result = await runCase(name, api, { active: () => live.size, created: () => workerEvents.length });
const packagePrefix = new URL('./node_modules/virtual-bash/', import.meta.url).href;
result.authentication = { resolved, expectedPackagePrefix: packagePrefix, modules, workerEvents,
  packageModulesOnly: modules.every(entry => entry.url.startsWith(packagePrefix)),
  workerAssetsMoved: workerEvents.every(entry => entry.url.startsWith(packagePrefix)),
  node: process.version, execArgv: process.execArgv };
result.pass &&= result.authentication.packageModulesOnly && result.authentication.workerAssetsMoved;
console.log(JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
