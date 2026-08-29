import * as fs from 'node:fs';
import { spawn } from 'node:child_process';

export function validateOwner(spec, state, now) {
  for (const [name, value] of Object.entries({ now, deadline: state.deadline, maximumStarts: state.maximumStarts, starts: state.starts, maximumCapture: state.maximumCapture, capture: state.capture, caseMs: spec.caseMs, retireMs: spec.retireMs, childCapture: spec.childCapture })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`invalid finite owner field: ${name}`);
  }
  if (spec.caseMs < 1 || spec.retireMs < 1 || now >= state.deadline || state.starts >= state.maximumStarts || state.capture > state.maximumCapture) throw new Error('owner admission limit');
  if (!Array.isArray(state.owned) || !Array.isArray(state.secondary)) throw new TypeError('owner receipts');
  for (const path of [spec.stdout, spec.stderr, spec.cwd]) if (typeof path !== 'string' || !path.startsWith('/private/tmp/') || path.split('/').includes('..')) throw new TypeError('noncanonical owner path');
  if (spec.stdout === spec.stderr) throw new TypeError('capture channels must be distinct');
}

export async function ownProcess(spec, state, publish, supplied = {}) {
  const io = { open: fs.openSync, close: fs.closeSync, write: fs.writeSync, spawn, now: Date.now, later: setTimeout, cancel: clearTimeout, ...supplied };
  validateOwner(spec, state, io.now());
  const descriptors = [];
  let failed = false;
  let reason;
  let child;
  let receipt;
  let bytes = 0;
  let timeout;
  let retireTimeout;
  let settled;
  const remember = error => { if (!failed) { failed = true; reason = error; } };
  const stop = error => {
    remember(error);
    if (child && receipt && !receipt.retired) {
      try { child.kill('SIGKILL'); } catch (killError) { state.secondary.push(killError); }
    }
  };
  try {
    descriptors.push(io.open(spec.stdout, 'wx', 0o600));
    descriptors.push(io.open(spec.stderr, 'wx', 0o600));
    state.starts++;
    child = io.spawn(spec.executable, spec.argv, { cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'] });
    receipt = { id: spec.id, pid: child.pid, retired: false, closeObserved: false };
    state.owned.push(receipt);
    let finish;
    settled = new Promise(resolve => { finish = resolve; });
    child.once('close', (code, signal) => {
      receipt.closeObserved = true;
      receipt.retired = true;
      receipt.code = code;
      receipt.signal = signal;
      finish();
    });
    const remaining = state.deadline - io.now();
    timeout = io.later(() => stop(new Error('case deadline')), Math.max(0, Math.min(spec.caseMs, remaining - spec.retireMs)));
    retireTimeout = io.later(() => {
      if (!receipt.closeObserved) {
        state.unknownRetirement = true;
        stop(new Error('unknown retirement at total deadline'));
        finish();
      }
    }, Math.max(0, Math.min(spec.caseMs + spec.retireMs, remaining)));
    child.once('error', error => { remember(error); });
    const accept = descriptor => chunk => {
      try {
        if (!Buffer.isBuffer(chunk)) throw new TypeError('non-byte capture');
        if (chunk.length > spec.childCapture - bytes || chunk.length > state.maximumCapture - state.capture) throw new Error('capture cap');
        bytes += chunk.length;
        state.capture += chunk.length;
        let offset = 0;
        while (offset < chunk.length) {
          const written = io.write(descriptor, chunk, offset, chunk.length - offset);
          if (!Number.isSafeInteger(written) || written <= 0 || written > chunk.length - offset) throw new Error('capture short-write failure');
          offset += written;
        }
      } catch (error) { stop(error); }
    };
    child.stdout.on('data', accept(descriptors[0]));
    child.stderr.on('data', accept(descriptors[1]));
    try { publish({ event: 'owned', ...receipt }); } catch (error) { stop(error); }
    await settled;
    io.cancel(timeout);
    io.cancel(retireTimeout);
    if (!receipt.closeObserved) state.unknownRetirement = true;
    try { publish({ event: 'settled', ...receipt, bytes }); } catch (error) { remember(error); }
  } catch (error) {
    remember(error);
    if (child && receipt && !receipt.retired) {
      stop(error);
      if (retireTimeout !== undefined) await settled;
      else state.unknownRetirement = true;
    }
  } finally {
    if (timeout !== undefined) io.cancel(timeout);
    if (retireTimeout !== undefined) io.cancel(retireTimeout);
    for (const descriptor of descriptors) {
      try { io.close(descriptor); } catch (error) { remember(error); }
    }
    if (io.now() >= state.deadline) remember(new Error('total deadline includes publication and cleanup'));
  }
  if (failed) throw reason;
  return receipt;
}
