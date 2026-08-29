import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as policy from './worker-policy.mjs';
const source = await fs.readFile(new URL('./resources.mjs', import.meta.url), 'utf8');
const fixture = JSON.parse(await fs.readFile(new URL('./CONTROL-DATA.json', import.meta.url)));
const rows = [];
async function record(id, body) { try { await body(); rows.push({ id, pass: true }); } catch (error) { rows.push({ id, pass: false, error: String(error?.stack ?? error) }); } }
async function instance(mode) {
  const events = [], callbacks = new Map(), reason = Object.freeze({ mode }); let births = 0, terminations = 0;
  const root = '/owned', entry = root + '/dist/commands/regex-execution/worker.js';
  const binding = { root, inputs: fixture.members.map(row => ({ path: row.path.slice(5), sha256: row.sha256 })) };
  class FakeWorker extends EventEmitter { constructor() { super(); births++; this.threadId = 42; } terminate() { terminations++; this.emit('exit', 1); return Promise.resolve(1); } }
  const workers = { Worker: FakeWorker };
  const fakeFs = { readFileSync(filename) { if (filename === 'binding') return JSON.stringify(binding); const row = fixture.members.find(row => root + '/' + row.path === filename); assert.ok(row); const bytes = Buffer.from(row.base64, 'base64'); if (mode === 'changed-bytes') bytes[0] ^= 1; return bytes; }, lstatSync() { return { isFile: () => true, isSymbolicLink: () => false }; }, realpathSync: filename => filename, appendFileSync(filename, line) { const event = JSON.parse(line); if ((mode === 'admit-fault' && event.kind === 'worker-admit') || (mode === 'create-fault' && event.kind === 'worker-create')) throw reason; events.push(event); } };
  const processStub = { env: { RESOURCE_LOG: 'trace', RESOURCE_ALLOWANCE: '1', PUBLIC_BINDING: 'binding' }, pid: 7, once(name, callback) { callbacks.set(name, callback); }, exitCode: 0 };
  const context = vm.createContext({ process: processStub, URL, Buffer, console });
  const values = { 'node:fs': { default: fakeFs }, 'node:path': { default: path }, 'node:worker_threads': { default: workers }, 'node:module': { syncBuiltinESMExports() {} }, 'node:url': { fileURLToPath }, 'node:crypto': { createHash }, 'node:assert/strict': { default: assert }, './worker-policy.mjs': policy };
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async specifier => { assert.ok(Object.hasOwn(values, specifier), specifier); const exports = values[specifier]; return new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context }); });
  await module.evaluate();
  return { workers, entry, events, callbacks, processStub, reason, counts: () => ({ births, terminations }) };
}
const options = () => ({ execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
await record('A01-valid-source-body', async () => { const item = await instance('valid'), worker = new item.workers.Worker(new URL('file://' + item.entry), options()); worker.emit('exit', 0); item.callbacks.get('beforeExit')(); assert.equal(item.counts().births, 1); assert.equal(item.events.at(-1).live, 0); });
await record('A02-wrong-entry-before-acquire', async () => { const item = await instance('valid'); assert.throws(() => new item.workers.Worker(new URL('file:///foreign/worker.js'), options())); assert.equal(item.counts().births, 0); });
await record('A03-changed-bytes-before-acquire', async () => { const item = await instance('changed-bytes'); assert.throws(() => new item.workers.Worker(new URL('file://' + item.entry), options())); assert.equal(item.counts().births, 0); });
await record('A04-admit-record-failure', async () => { const item = await instance('admit-fault'); assert.throws(() => new item.workers.Worker(new URL('file://' + item.entry), options()), error => error === item.reason); assert.equal(item.counts().births, 0); });
await record('A05-create-record-failure-cleanup', async () => { const item = await instance('create-fault'); assert.throws(() => new item.workers.Worker(new URL('file://' + item.entry), options()), error => error === item.reason); await Promise.resolve(); assert.deepEqual(item.counts(), { births: 1, terminations: 1 }); assert.equal(item.processStub.exitCode, 78); });
await record('A06-live-not-clean', async () => { const item = await instance('valid'); const worker = new item.workers.Worker(new URL('file://' + item.entry), options()); item.callbacks.get('beforeExit')(); assert.equal(item.processStub.exitCode, 78); worker.emit('exit', 0); });
for (const name of ['run.mjs', 'loader.mjs', 'novel.mjs', 'prepare.mjs', 'resources.mjs']) await record('S-' + name, async () => { new vm.SourceTextModule(await fs.readFile(new URL('./' + name, import.meta.url), 'utf8')); });
for (const row of rows) console.log(JSON.stringify(row)); const fail = rows.filter(row => !row.pass).length; console.log(JSON.stringify({ cases: rows.length, pass: rows.length - fail, fail, actualWorkers: 0, productImports: 0, sourceCompiledNotLinked: true })); process.exitCode = fail ? 1 : 0;
