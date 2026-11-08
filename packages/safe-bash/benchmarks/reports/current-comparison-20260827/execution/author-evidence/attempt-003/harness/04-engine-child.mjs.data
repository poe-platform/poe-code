import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFrames, writeFrame, readBound, errorRecord } from './io.mjs';
import { observeExpanded } from './expanded.mjs';
import { observeBreadth } from './breadth.mjs';

const synthetic = process.argv[2] === '--synthetic';
const output = createWriteStream(null, { fd: 3 });
output.on('error', () => { process.exitCode = 1; });
let request, library, executing = false, settled = false, timer, channel;
let queue = Promise.resolve(), count = 0, bytes = 0;
const controller = new AbortController();
function send(message) {
  const frame = { id: request?.id, nonce: request?.nonce, ...message };
  const size = Buffer.byteLength(JSON.stringify(frame)) + 4;
  if (++count > (request?.caps.events ?? 4096) || (bytes += size) > (request?.caps.reportBytes ?? 67108864)) return Promise.reject(new Error('child report/event cap'));
  queue = queue.then(() => writeFrame(output, frame, request?.caps.reportBytes));
  queue.catch(() => { process.exitCode = 1; controller.abort(new Error('report transport failed')); });
  return queue;
}
async function mark(phase, detail = {}) {
  if (phase === 'exec-start') timer = setTimeout(() => { controller.abort(new Error('guest deadline')); send({ kind: 'failure', error: 'guest deadline' }).catch(() => {}); }, request.caps.guestMs);
  if (phase === 'exec-settled') clearTimeout(timer);
  await send({ kind: 'phase', phase, ...detail });
}
async function finish() {
  clearTimeout(timer);
  channel?.port1.close(); channel?.port2.close();
  process.stdin.destroy();
  await queue;
  await new Promise(resolveEnd => output.end(resolveEnd));
}
async function importBound(load) {
  readBound(dirname(load.packagePath), load.packagePath, load.files[load.packagePath]);
  channel = new MessageChannel();
  channel.port1.on('message', event => { send({ kind: 'module', event }).catch(() => {}); });
  channel.port1.unref();
  register(new URL('./observe-load.mjs', import.meta.url), { data: { files: load.files, port: channel.port2 }, transferList: [channel.port2] });
  const resolved = import.meta.resolve(load.packageName, pathToFileURL(load.packagePath).href);
  assert.equal(resolved, pathToFileURL(load.entry).href, 'root public export resolved to wrong entry');
  await send({ kind: 'public-resolution', specifier: load.packageName, parent: load.packagePath, resolved });
  const imported = await import(resolved);
  await send({ kind: 'entry-import-fulfilled', resolved });
  return imported;
}
async function execute() {
  assert.ok(!executing && !settled, 'duplicate execution'); executing = true;
  try {
    let result;
    if (synthetic) result = await syntheticObservation();
    else if (request.profile === 'breadth') result = { report: await observeBreadth({ ...request, library, signal: controller.signal, mark }) };
    else result = { observation: await observeExpanded({ ...request, library, signal: controller.signal, mark }) };
    if (result && !settled) { settled = true; await send({ kind: 'result', ...result }); }
  } catch (error) { settled = true; await send({ kind: 'failure', error: errorRecord(error) }); }
  finally { await finish(); }
}
async function syntheticObservation() {
  const mode = request.mode;
  await mark('exec-start');
  if (mode === 'ignore-term') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); await new Promise(() => {}); }
  if (mode === 'late-reject') await new Promise((resolveLate, rejectLate) => { controller.signal.addEventListener('abort', () => setTimeout(() => rejectLate(new Error('observed late rejection')), 40), { once: true }); });
  if (mode === 'oversize') { const header = Buffer.alloc(4); header.writeUInt32BE(request.caps.reportBytes + 1); output.write(header); await new Promise(() => {}); }
  if (mode === 'diagnostic-flood') { process.stdout.write(Buffer.alloc(request.caps.diagnosticBytes + 100, 65)); await new Promise(() => {}); }
  if (mode === 'partial-frame') { output.write(Buffer.from([0, 0, 0])); output.end(); return null; }
  if (mode === 'crash') process.exit(9);
  const observation = structuredClone(request.expected);
  if (mode === 'wrong-output') observation.stdout = Buffer.from('wrong\n').toString('base64');
  if (mode === 'wrong-vfs') observation.entries['extra'] = { type: 'file', bytes: 'AA==' };
  if (mode === 'wrong-status') observation.exitCode = 17;
  await mark('exec-settled'); await mark('snapshot-complete');
  await mark('dispose-start'); await mark('dispose-settled');
  if (mode === 'leak') setInterval(() => {}, 1000);
  if (mode === 'result-crash') setTimeout(() => process.exit(9), 30);
  if (mode === 'late-error') setTimeout(() => { throw new Error('late synthetic error'); }, 30);
  if (mode === 'duplicate') { await send({ kind: 'result', observation }); await send({ kind: 'result', observation }); settled = true; return null; }
  if (mode === 'wrong-id') { await send({ kind: 'result', id: 'wrong-request', observation }); settled = true; return null; }
  if (request.profile === 'breadth') {
    const binary = { path: '/fixture/binary', type: 'file', base64: request.expected.entries.binary.bytes };
    const report = { engine: 'ours', captureErrors: [], before: { complete: true, entries: [] }, after: { complete: true, entries: mode === 'wrong-vfs' ? [] : [binary] }, result: { exitCode: observation.exitCode, stdoutBase64: observation.stdout, stderrBase64: observation.stderr, stdout: Buffer.from(observation.stdout, 'base64').toString(), stderr: '' }, cleanup: { completion: 'returned' } };
    if (mode === 'cleanup-error') report.cleanup = { error: { message: 'synthetic dispose rejection' } };
    return { report };
  }
  return { observation };
}
const reading = readFrames(process.stdin, async message => {
  if (!request) {
    assert.equal(message.kind, 'configure'); request = message.request;
    assert.equal(Boolean(request.synthetic), synthetic, 'synthetic admission mismatch');
    if (synthetic) {
      if (request.syntheticBinding) {
        const bound = request.syntheticBinding;
        readBound(bound.root, bound.path, bound);
      }
      if (request.syntheticModule) await importBound(request.syntheticModule);
    } else {
      assert.ok(request.load && ['virtual-bash', 'just-bash'].includes(request.engine));
      library = await importBound(request.load);
    }
    await send({ kind: 'ready' });
  } else if (message.kind === 'cancel') {
    controller.abort(new Error(message.reason ?? 'parent cancellation'));
  } else if (message.kind === 'execute') {
    assert.equal(message.nonce, request.nonce);
    execute().catch(error => { process.exitCode = 1; send({ kind: 'failure', error: errorRecord(error) }).catch(() => {}); });
  } else throw new Error('unknown child request');
}, { bytes: 64 * 1024 * 1024, events: 8 });
reading.catch(async error => {
  if (settled && error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
  process.exitCode = 1;
  await send({ kind: 'failure', error: errorRecord(error) }).catch(() => {});
  if (!executing) await finish().catch(() => {});
});
process.on('uncaughtExceptionMonitor', error => { process.stderr.write(`${JSON.stringify(errorRecord(error))}\n`); });
