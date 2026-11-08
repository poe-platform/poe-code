import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileCommand, fileCommands } from './candidate/dist/commands/file/index.js';
import { FsError } from './candidate/dist/contracts/index.js';
import { Shell } from './candidate/dist/shell/index.js';
import { runHoldouts } from './holdout/v2-runner.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const caseId = process.argv[2];
assert(/^F(?:0[1-9]|[12][0-9]|3[0-9]|40)$/u.test(caseId), 'Only the forty root-authorized frozen cases');
const freeze = JSON.parse(readFileSync(join(root, 'freeze.json')));
const binding = JSON.parse(readFileSync(join(root, 'binding.json')));
const eventFile = join(root, 'results', `${caseId}.events.jsonl`);
const signalIds = new WeakMap();
let nextSignalId = 0;
let invocationNumber = 0;
const errorRecord = (error) => ({ name: error?.name, message: error?.message ?? String(error), code: error?.code, stack: error?.stack });
const event = (kind, details) => appendFileSync(eventFile, `${JSON.stringify({ at: new Date().toISOString(), kind, ...details })}\n`);
function signalRecord(signal) {
  if (!signal) return { present: false };
  if (!signalIds.has(signal)) {
    signalIds.set(signal, ++nextSignalId);
    signal.addEventListener('abort', () => event('signal-abort', { signalId: signalIds.get(signal), reason: errorRecord(signal.reason) }), { once: true });
  }
  return { present: true, signalId: signalIds.get(signal), aborted: signal.aborted };
}
function observeFs(fs, invocation) {
  return new Proxy(fs, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    return (...args) => {
      const options = args.findLast((argument) => argument && typeof argument === 'object' && !(argument instanceof Uint8Array));
      event('fs-call', { invocation, method: key, path: args[0], options: options && { start: options.start, endExclusive: options.endExclusive, chunkSize: options.chunkSize, maxBytes: options.maxBytes, signal: signalRecord(options.signal) } });
      return Reflect.apply(value, target, args);
    };
  } });
}
function observeSink(sink, invocation, stream) {
  return { async write(bytes) {
    event('sink-write', { invocation, stream, bytes: bytes.length, base64: Buffer.from(bytes).toString('base64') });
    try { await sink.write(bytes); event('sink-resolved', { invocation, stream }); }
    catch (error) { event('sink-rejected', { invocation, stream, error: errorRecord(error) }); throw error; }
  } };
}
const command = createFileCommand(binding.options);
const adapter = {
  caseId,
  caseStarted(id) { event('case-start', { id }); },
  observeHoldout(kind, details) { event(`holdout-${kind}`, details); },
  candidate: { finished: true, commit: freeze.commit, sourceSha256: freeze.sourceSha256, dependencySha256: freeze.dependencySha256, profile: 'virtual-bash-file-v1', options: binding.options },
  prefixBytes: 65536,
  unsupportedFormats: binding.unsupportedFormats,
  fsError: (code, options) => new FsError(code, options),
  shellUsesActualShell: true,
  async execute(context) {
    const invocation = ++invocationNumber;
    event('execute-start', { invocation, args: context.args, signal: signalRecord(context.signal) });
    try {
      const result = await command.execute({ ...context, fs: observeFs(context.fs, invocation), stdout: observeSink(context.stdout, invocation, 'stdout'), stderr: observeSink(context.stderr, invocation, 'stderr') });
      event('execute-result', { invocation, result });
      return result;
    } catch (error) { event('execute-rejected', { invocation, error: errorRecord(error) }); throw error; }
  },
  async shell({ fs, script, commands, stdin, signal }) {
    const invocation = ++invocationNumber;
    const shell = new Shell({ fs: observeFs(fs, invocation), cwd: '/', env: {}, limits: { maxOutputBytes: 65536, maxCommands: 32, pipeHighWaterMark: 32 } });
    for (const definition of commands) { assert.notEqual(definition.name, 'file'); shell.register(definition); }
    shell.use(fileCommands(binding.options));
    event('shell-start', { invocation, script, additionalCommands: commands.map((entry) => entry.name), signal: signalRecord(signal) });
    try {
      const result = await shell.exec(script, { ...(stdin === undefined ? {} : { stdin }), ...(signal === undefined ? {} : { signal }) });
      event('shell-result', { invocation, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
      return result;
    } catch (error) { event('shell-rejected', { invocation, error: errorRecord(error) }); throw error; }
    finally { await shell.dispose(); event('shell-disposed', { invocation }); }
  },
};
process.on('unhandledRejection', (error) => event('unhandled-rejection', { error: errorRecord(error) }));
const report = await runHoldouts(adapter);
writeFileSync(join(root, 'results', `${caseId}.json`), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
event('case-finished', { id: caseId, semanticStatus: report.reports[0].semanticStatus, nativeStatus: report.reports[0].nativeStatus });
console.log(JSON.stringify({ caseId, semanticStatus: report.reports[0].semanticStatus, nativeStatus: report.reports[0].nativeStatus, invocations: invocationNumber }));
