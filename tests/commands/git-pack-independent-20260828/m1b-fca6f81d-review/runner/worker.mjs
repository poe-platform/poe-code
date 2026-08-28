import './tool-fence.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { demand, exact, ownData, relative, regular } from './primitives.mjs';

const jobSize = Number(process.env.M1B_JOB_BYTES);
demand(Number.isSafeInteger(jobSize) && jobSize >= 0 && jobSize <= 131072 && /^[a-f0-9]{64}$/.test(process.env.M1B_JOB_SHA256 ?? ''), 'JOB_EXPECTED_IDENTITY');
const request = JSON.parse((await regular(process.env.M1B_JOB, { mode: 0o600, bytes: jobSize, sha256: process.env.M1B_JOB_SHA256 })).body.toString('utf8'));
let sequence = 0;
let pending = null;
let controller;
process.on('SIGTERM', () => controller?.abort(new Error('OWNED_TERM')));
process.on('message', message => {
  if (message?.type === 'CANCEL') { controller?.abort(message.reason); return; }
  if (!pending || message?.sequence !== pending.sequence || message?.type !== 'ACK') {
    process.exitCode = 1;
    controller?.abort(new Error('RPC_REPLY_INVALID'));
    return;
  }
  const current = pending;
  pending = null;
  current.resolve(message.value);
});
async function rpc(type, value) {
  demand(pending === null && typeof process.send === 'function', 'RPC_STATE');
  const projected = ownData(value);
  const frame = { sequence: ++sequence, type, value: projected };
  demand(Buffer.byteLength(JSON.stringify(frame)) <= 131072, 'RPC_FRAME');
  return new Promise((resolve, reject) => {
    pending = { sequence, resolve, reject };
    process.send(frame, error => { if (error) { pending = null; reject(error); } });
  });
}
let failed = false;
for (const item of request.cases) {
  controller = new AbortController();
  const cleanups = [];
  const assertions = [];
  let captured = 0;
  let rawBytes = 0;
  let cleanupFailed = false;
  let escaped = false;
  let thrownType = null;
  let cleanupAdmissionOpen = true;
  await rpc('CASE_BEGIN', { caseId: item.id });
  const caseRoot = path.join(request.caseBase, item.id);
  await fs.mkdir(caseRoot, { mode: 0o700 });
  const api = Object.freeze({
    caseId: item.id,
    layout: request.layout,
    candidateRoot: request.candidateRoot,
    caseRoot,
    signal: controller.signal,
    async load(name) {
      demand(cleanupAdmissionOpen, 'LOAD_ADMISSION_CLOSED');
      relative(name);
      demand(name.startsWith('dist/') && name.endsWith('.js'), 'PRODUCT_ENTRY');
      const result = await import(pathToFileURL(path.join(request.candidateRoot, name)).href);
      await api.capture('loaded-entry', { path: name });
      return result;
    },
    async capture(label, value) {
      demand(typeof label === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(label), 'CAPTURE_LABEL');
      const projected = ownData(value);
      const bytes = Buffer.from(JSON.stringify(projected));
      demand(bytes.length <= 65536 && rawBytes + bytes.length <= item.captureBytes, 'CASE_CAPTURE_LIMIT');
      rawBytes += bytes.length;
      await rpc('CAPTURE', { caseId: item.id, label, encoding: 'json', data: projected });
      captured++;
    },
    async captureBytes(label, bytes) {
      demand(ArrayBuffer.isView(bytes) && bytes.BYTES_PER_ELEMENT === 1 && bytes.constructor?.name !== 'DataView', 'CAPTURE_BYTES_TYPE');
      demand(typeof label === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(label), 'CAPTURE_LABEL');
      demand(rawBytes + bytes.byteLength <= item.captureBytes, 'CASE_CAPTURE_LIMIT');
      rawBytes += bytes.byteLength;
      const copy = Buffer.from(bytes);
      for (let offset = 0; offset < copy.byteLength || offset === 0; offset += 49152) {
        const owned = copy.subarray(offset, Math.min(offset + 49152, copy.byteLength));
        await rpc('CAPTURE', { caseId: item.id, label, encoding: 'base64', data: owned.toString('base64') });
      }
      captured++;
    },
    check(label, passed, details = null) {
      demand(captured > 0 && typeof label === 'string' && label.length <= 256 && typeof passed === 'boolean' && assertions.length < 4096, 'ASSERTION_ADMISSION');
      assertions.push({ label, passed, details: ownData(details) });
    },
    registerCleanup(callback) {
      demand(cleanupAdmissionOpen && typeof callback === 'function' && cleanups.length < 256, 'CLEANUP_ADMISSION');
      let promise;
      const once = () => promise ??= Promise.resolve().then(callback);
      cleanups.push(once);
      return once;
    },
    async compile(fixtureId) {
      demand(arguments.length === 1 && item.role === 'TYPE' && typeof fixtureId === 'string' && item.requires.includes(fixtureId), 'COMPILER_ROLE');
      const result = await rpc('COMPILE', { caseId: item.id, fixtureId });
      captured++;
      return { code: result.code, signal: result.signal, stdout: Uint8Array.from(Buffer.from(result.stdout, 'base64')), stderr: Uint8Array.from(Buffer.from(result.stderr, 'base64')) };
    }
  });
  try {
    const module = await import(pathToFileURL(path.join(request.harnessRoot, relative(item.entry))).href);
    demand(typeof module.runCase === 'function', 'CASE_EXPORT');
    await module.runCase(api, item.id);
  } catch (reason) {
    escaped = true;
    thrownType = reason === null ? 'null' : typeof reason;
    await api.capture('escaping-reason-type', { escaped: true, type: thrownType });
  } finally {
    cleanupAdmissionOpen = false;
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); }
      catch { cleanupFailed = true; }
    }
  }
  const status = escaped || cleanupFailed || controller.signal.aborted || assertions.some(row => !row.passed) ? 'FAIL' : assertions.length === 0 ? 'INCOMPLETE' : 'PASS';
  await rpc('CASE_END', { caseId: item.id, status, captured, rawBytes, assertions, cleanupFailed, escaped, thrownType, aborted: controller.signal.aborted });
  if (status !== 'PASS') { failed = true; break; }
}
await rpc('BATCH_END', { failed });
process.exitCode = failed ? 1 : 0;
process.disconnect();
