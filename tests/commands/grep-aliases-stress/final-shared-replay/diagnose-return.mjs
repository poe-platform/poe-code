import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';

const output = process.argv[2];
assert.ok(output);
const workerModule = createRequire(import.meta.url)('node:worker_threads');
const OriginalWorker = workerModule.Worker;
const active = new Set();
const events = [];
const late = [];
let current;
class ObservedWorker extends OriginalWorker {
  constructor(...args) {
    super(...args);
    const identity = this.threadId;
    active.add(this);
    events.push({ event: 'create', identity, case: current, url: String(args[0]) });
    this.once('exit', code => { active.delete(this); events.push({ event: 'exit', identity, case: current, code }); });
  }
}
workerModule.Worker = ObservedWorker;
syncBuiltinESMExports();
process.on('unhandledRejection', error => late.push(String(error)));
const publicRootUrl = import.meta.resolve('virtual-bash');
const aliasUrl = new URL('../node_modules/virtual-bash/dist/commands/grep-aliases/index.js', import.meta.url).href;
const { Shell, MemoryFileSystem, createStandardCommands } = await import('virtual-bash');
const aliases = await import(aliasUrl);
const regex = { maxWorkers: 1, maxQueuedRequests: 1, maxQueuedBytes: 4096, requestTimeoutMs: 1500, startupTimeoutMs: 1500, idleTimeoutMs: 1000 };
const rows = [];
for (const name of ['egrep', 'grep']) {
  current = name;
  const fs = new MemoryFileSystem();
  const shell = name === 'egrep' ? new Shell({ fs, limits: { maxOutputBytes: 65536, maxCommands: 32, pipeHighWaterMark: 128 } }) : new Shell({ fs });
  if (name === 'egrep') shell.use(aliases.grepAliasCommands({ regex }));
  else shell.register(createStandardCommands({ regex }).find(definition => definition.name === 'grep'));
  let returns = 0;
  let nextCalls = 0;
  const failure = new Error(name === 'egrep' ? 'external-return-sentinel' : 'shared-grep-return-sentinel');
  const input = { [Symbol.asyncIterator]: () => ({ next: async () => { nextCalls += 1; return { done: false, value: Buffer.from('keep:01\n') }; }, return: () => { returns += 1; return Promise.reject(failure); } }) };
  const row = { command: `${name} -q keep`, inputChunkHex: Buffer.from('keep:01\n').toString('hex'), priorAssertion: 'fulfilled ShellResult exitCode 2 and stderr containing return sentinel', stdoutHex: null, stderrHex: null, status: null };
  try {
    const result = await shell.exec(row.command, { stdin: input });
    Object.assign(row, { settlement: 'fulfilled', status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex') });
  } catch (error) {
    Object.assign(row, { settlement: 'rejected', exactReturnReasonIdentity: error === failure, error: { name: error.name, message: error.message, stack: error.stack }, unavailableResultBytes: 'No ShellResult was returned; null is not an assertion of empty byte output.' });
  } finally { await shell.dispose(); }
  Object.assign(row, { returns, nextCalls, activeWorkersAfterDispose: active.size, filesAfter: await fs.readdir('/') });
  rows.push(row);
}
await new Promise(resolve => setImmediate(resolve));
writeFileSync(output, `${JSON.stringify({ classification: 'two-existing-failure-diagnostic-observations-not-new-product-passes', publicRootUrl, aliasUrl, rows, events, activeWorkers: active.size, lateErrors: late, verifierForcedTermination: 0 }, null, 2)}\n`);
workerModule.Worker = OriginalWorker;
syncBuiltinESMExports();
assert.equal(active.size, 0);
assert.deepEqual(late, []);
