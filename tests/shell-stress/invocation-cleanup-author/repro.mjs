import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const events = [];
const workers = [];
const lateErrors = [];
let activeCase;
const event = (kind, fields = {}) => events.push({ sequence: events.length, milliseconds: performance.now(), kind, case: activeCase?.name, ...fields });
const describe = error => ({ name: error?.name, message: error?.message, value: String(error) });
process.on('unhandledRejection', error => lateErrors.push(describe(error)));
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    super(url, options);
    const record = { owner: activeCase.name, url: String(url), threadId: this.threadId, exited: false, terminationStarted: false, terminationDone: false };
    workers.push(record);
    event('worker-created', { threadId: record.threadId, url: record.url, execArgv: options.execArgv });
    this.once('exit', code => { record.exited = true; record.exitCode = code; event('worker-exit', { threadId: record.threadId, code }); });
    const terminate = this.terminate.bind(this);
    this.terminate = () => {
      record.terminationStarted = true;
      event('terminate-start', { threadId: record.threadId });
      const termination = terminate();
      void termination.then(code => {
        record.terminationDone = true;
        event('terminate-done', { threadId: record.threadId, code });
      }, error => {
        record.terminationFailure = describe(error);
        event('terminate-error', { threadId: record.threadId, error: describe(error) });
      });
      return termination;
    };
    const postMessage = this.postMessage.bind(this);
    this.postMessage = (...args) => {
      const result = postMessage(...args);
      const message = args[0];
      event('worker-request-posted', { threadId: record.threadId, id: message.id, rows: message.rows?.length, descriptorKind: message.descriptor?.kind });
      if (activeCase.abortOnContent && message.descriptor?.kind === 'grep' && message.rows?.length > 0) {
        activeCase.abortOnContent = false;
        activeCase.controller.abort(activeCase.reason);
        event('caller-abort');
      }
      return result;
    };
  }
};
syncBuiltinESMExports();
const moduleLocation = pathToFileURL(process.argv[2]).href;
const { Shell, MemoryFileSystem, agentCommands } = await import(moduleLocation);
const snapshot = () => workers.filter(record => record.owner === activeCase.name).map(record => ({ ...record }));
const cases = [
  { name: 'ordinary-grep', source: "grep -E '^a'", input: 'ab\n' },
  { name: 'early-downstream-grep-head', source: "grep -E '^a' | head -n 1", input: 'ab\n'.repeat(200) },
  { name: 'caller-abort-after-content-post', source: "grep -E '^a'", input: 'ab\n'.repeat(200), abortOnContent: true },
];
const observations = [];
for (const fixture of cases) {
  activeCase = { ...fixture, controller: new AbortController(), reason: new Error('owned cleanup baseline caller abort') };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  const stdoutChunks = [];
  const stderrChunks = [];
  const observation = { name: fixture.name, source: fixture.source, stdinHex: Buffer.from(fixture.input).toString('hex'), stdinSha256: createHash('sha256').update(fixture.input).digest('hex') };
  event('exec-start');
  try {
    const result = await shell.exec(fixture.source, {
      stdin: fixture.input,
      signal: activeCase.controller.signal,
      stdout: { write: async chunk => { stdoutChunks.push(Buffer.from(chunk)); } },
      stderr: { write: async chunk => { stderrChunks.push(Buffer.from(chunk)); } },
    });
    observation.result = { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex') };
  } catch (error) {
    observation.rejection = describe(error);
    observation.exactCallerReason = error === activeCase.reason;
  }
  event('exec-settled');
  observation.atExec = snapshot();
  observation.stdoutSinkHex = Buffer.concat(stdoutChunks).toString('hex');
  observation.stderrSinkHex = Buffer.concat(stderrChunks).toString('hex');
  try { await shell.dispose(); }
  catch (error) { observation.disposeError = describe(error); }
  event('dispose-settled');
  observation.atDispose = snapshot();
  observation.cleanupBeforeExec = observation.atExec.length > 0 && observation.atExec.every(record => record.exited && record.terminationDone);
  observation.cleanupBeforeDispose = observation.atDispose.length > 0 && observation.atDispose.every(record => record.exited && record.terminationDone);
  try {
    if (fixture.abortOnContent) {
      assert.equal(observation.exactCallerReason, true);
      assert.equal(observation.result, undefined);
      assert.equal(observation.stdoutSinkHex, '');
    } else {
      assert.deepEqual(observation.result, { exitCode: 0, stdout: 'ab\n', stderr: '', stdoutHex: '61620a', stderrHex: '' });
      assert.equal(observation.stdoutSinkHex, '61620a');
    }
    assert.equal(observation.stderrSinkHex, '');
    assert.equal(observation.disposeError, undefined);
    observation.payloadAndAbortControl = true;
  } catch (error) { observation.payloadAndAbortControl = false; observation.controlFailure = describe(error); }
  const deadline = performance.now() + 2000;
  while (snapshot().some(record => !record.exited || !record.terminationDone) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  observation.afterObservationOnly = snapshot();
  observation.eventualOwnedTermination = observation.afterObservationOnly.every(record => record.exited && record.terminationDone);
  observations.push(observation);
  if (!observation.eventualOwnedTermination) break;
}
await new Promise(resolve => setTimeout(resolve, 10));
const report = { node: process.version, platform: process.platform, arch: process.arch, moduleLocation, observations, events, lateErrors, noHostRescue: true, denominator: observations.length, expectedCases: cases.length, semantics: 'Strict intended cleanup-before-public-settlement. Observation-only wait after saved settlements is not acceptance or host termination.' };
console.log(JSON.stringify(report));
if (observations.length !== cases.length || observations.some(observation => !observation.cleanupBeforeExec || !observation.cleanupBeforeDispose || !observation.payloadAndAbortControl) || lateErrors.length) process.exitCode = 1;
