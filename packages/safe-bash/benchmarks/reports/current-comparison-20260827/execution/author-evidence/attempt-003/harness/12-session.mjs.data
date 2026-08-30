import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openFixture } from './network.mjs';
import { errorRecord, readFrames, writeFrame } from './io.mjs';

const synthetic = process.argv[2] === '--synthetic';
const output = createWriteStream(null, { fd: 3 });
output.on('error', () => { process.exitCode = 1; });
let request, engine, fixture, closing = false, queue = Promise.resolve(), diagnosticBytes = 0;
const send = message => { queue = queue.then(() => writeFrame(output, { id: request?.id, nonce: request?.nonce, ...message }, request?.caps.reportBytes)); queue.catch(() => { process.exitCode = 1; }); return queue; };
async function closeSession(code, signal, capture) {
  if (closing) return; closing = true;
  await send({ kind: 'engine-close', code, signal });
  const server = fixture ? await fixture.close() : { closed: true, sockets: 0, requests: [] };
  await send({ kind: 'fixture-close', ...server });
  await capture;
  await send({ kind: 'session-complete' });
  process.stdin.destroy();
  await queue;
  await new Promise(resolveEnd => output.end(resolveEnd));
}
async function start() {
  assert.equal(Boolean(request.synthetic), synthetic);
  fixture = synthetic ? null : await openFixture(request, value => { send(value).catch(() => {}); });
  if (fixture) request.baseUrl = fixture.baseUrl;
  const args = ['--unhandled-rejections=strict', '--experimental-import-meta-resolve', `--max-old-space-size=${request.heapMiB}`, fileURLToPath(new URL('./engine-child.mjs', import.meta.url)), ...(synthetic ? ['--synthetic'] : [])];
  engine = spawn(process.execPath, args, { cwd: request.host.cwd, env: request.host.env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  engine.stdin.on('error', error => { if (!closing) send({ kind: 'failure', error: errorRecord(error) }).catch(() => {}); });
  engine.on('error', error => { send({ kind: 'failure', error: errorRecord(error) }).catch(() => {}); });
  engine.on('exit', (code, signal) => { send({ kind: 'engine-exit', code, signal }).catch(() => {}); });
  await send({ kind: 'engine-spawn', pid: engine.pid, argv: [process.execPath, ...args] });
  for (const [name, stream] of [['stdout', engine.stdout], ['stderr', engine.stderr]]) stream.on('data', chunk => {
    const remaining = Math.max(0, request.caps.diagnosticBytes - diagnosticBytes);
    diagnosticBytes += chunk.length;
    if (remaining) { stream.pause(); send({ kind: 'diagnostic', stream: name, base64: chunk.subarray(0, remaining).toString('base64') }).finally(() => stream.resume()).catch(() => {}); }
    if (diagnosticBytes > request.caps.diagnosticBytes) { stream.destroy(); send({ kind: 'failure', error: 'host diagnostic byte cap' }).catch(() => {}); }
  });
  const capture = readFrames(engine.stdio[3], async message => {
    assert.equal(message.id, request.id); assert.equal(message.nonce, request.nonce);
    await send(message);
    if (message.kind === 'ready') await writeFrame(engine.stdin, { kind: 'execute', nonce: request.nonce });
  }, { bytes: request.caps.reportBytes, events: request.caps.events }).catch(async error => { await send({ kind: 'failure', error: errorRecord(error) }); });
  engine.on('close', (code, signal) => { closeSession(code, signal, capture).catch(error => { process.exitCode = 1; send({ kind: 'failure', error: errorRecord(error) }).catch(() => {}); }); });
  await writeFrame(engine.stdin, { kind: 'configure', request });
  if (synthetic && request.mode === 'coordinator-stall') { process.on('SIGTERM', () => {}); while (true) {} }
}
readFrames(process.stdin, async message => {
  if (!request) { assert.equal(message.kind, 'configure'); request = message.request; await start(); }
  else if (message.kind === 'cancel') { if (engine && !engine.stdin.destroyed) await writeFrame(engine.stdin, message); }
  else throw new Error('unexpected coordinator message');
}, { bytes: 64 * 1024 * 1024, events: 8 }).catch(async error => {
  if (closing && error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
  process.exitCode = 1;
  await send({ kind: 'failure', error: errorRecord(error) }).catch(() => {});
  if (!engine) { fixture && await fixture.close(); process.stdin.destroy(); await queue; output.end(); }
});
