import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({ stdout: 65536, stderr: 65536, fd3: 262144, intent: 16384, events: 49152, receipt: 65536, outer: 524288, inner: 268435456, administration: 524288, overall: 269484032 });
const channels = ['stdout', 'stderr', 'fd3'];
const digest = () => createHash('sha256');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const problem = code => Object.assign(new Error(code), { code });

export function reasonRecord(value) {
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  const type = typeof value;
  if (type === 'string') return { type, value: value.slice(0, 512), truncated: value.length > 512 };
  if (type === 'number') return { type, value: Number.isFinite(value) ? value : String(value) };
  if (type === 'boolean') return { type, value };
  if (type !== 'object' && type !== 'function') return { type };
  const result = { type };
  for (const key of ['code', 'message']) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') result[key] = descriptor.value.slice(0, 512);
    } catch { result.descriptionUnavailable = true; }
  }
  return result;
}

export function processPresence(pid) {
  if (!Number.isInteger(pid) || pid === 0) return 'unknown';
  try { process.kill(pid, 0); return 'present'; }
  catch (error) { return error?.code === 'ESRCH' ? 'absent' : 'unknown'; }
}

export async function captureLaunch(options, hooks = {}) {
  const started = Date.now();
  const io = hooks.io ?? fs;
  const receipt = { schema: 'BREADTH_OUTER_CAPTURE_V1', primaryPresent: false, primary: null, secondary: [], secondaryOmitted: 0, events: [], child: { attempted: false, pid: null, group: null, enrolled: false, error: null, exit: null, close: null, pidPresence: null, groupPresence: null, reaped: false, natural: false }, streams: {}, signals: [], files: {}, captureQualified: false, publication: 'REQUIRES_TERMINAL_CONFIRMATION' };
  let primaryReason;
  let eventBytes = 0;
  let child;
  let closeResolve;
  let closeDone = false;
  let stopStarted = false;
  let timeoutTimer;
  let killTimer;
  let retirementTimer;
  let deadlineResolve;
  let receiptHandle;
  let publicationPresent = false;
  let publicationReason;
  let directoryCreated = false;
  const handles = new Map();
  const hashes = new Map();
  const closePromise = new Promise(resolve => { closeResolve = resolve; });
  const deadlinePromise = new Promise(resolve => { deadlineResolve = resolve; });
  const events = (phase, details = {}) => {
    if (receipt.events.length < 96) receipt.events.push({ ordinal: receipt.events.length + 1, phase, ...details });
    else throw problem('OUTER_EVENT_COUNT');
  };
  const fail = (phase, reason) => {
    const record = { phase, reason: reasonRecord(reason) };
    if (!receipt.primaryPresent) { receipt.primaryPresent = true; receipt.primary = record; primaryReason = reason; }
    else if (receipt.secondary.length < 24) receipt.secondary.push(record);
    else receipt.secondaryOmitted++;
  };
  const signal = name => {
    if (!child || !Number.isInteger(receipt.child.pid)) return;
    try { process.kill(-receipt.child.pid, name); receipt.signals.push({ name, delivered: true }); }
    catch (error) {
      receipt.signals.push({ name, delivered: false, reason: reasonRecord(error) });
      if (error?.code !== 'ESRCH') fail('signal', error);
    }
  };
  const stop = () => {
    if (stopStarted || !child) return;
    stopStarted = true;
    signal('SIGTERM');
    killTimer = setTimeout(() => signal('SIGKILL'), options.termMs);
    retirementTimer = setTimeout(() => {
      if (!closeDone) fail('retirement', problem('OUTER_CLOSE_UNKNOWN'));
      for (const stream of child.stdio.slice(1)) stream?.destroy();
      deadlineResolve('deadline');
    }, options.termMs + options.killMs);
  };
  const writeAll = async (handle, bytes, onWrite = () => {}) => {
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(bytes, offset, bytes.length - offset, null);
      if (!Number.isInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > bytes.length - offset) throw problem('OUTER_WRITE_PROGRESS');
      onWrite(bytes.subarray(offset, offset + result.bytesWritten));
      offset += result.bytesWritten;
    }
  };
  const persistEvent = async value => {
    const bytes = encode(value);
    if (bytes.length > 4096 || eventBytes + bytes.length > LIMITS.events) throw problem('OUTER_EVENT_BYTES');
    await writeAll(handles.get('events'), bytes, part => { eventBytes += part.length; });
  };
  const settleHandle = async (name, handle, state) => {
    state.syncAttempted = true;
    try { await handle.sync(); state.synced = true; } catch (error) { fail(name + ':sync', error); }
    state.closeAttempted = true;
    try { await handle.close(); state.closed = true; } catch (error) { fail(name + ':close', error); }
  };
  try {
    if (!path.isAbsolute(options.directory) || !Number.isSafeInteger(options.totalMs) || options.totalMs < options.termMs + options.killMs + 1 || options.totalMs > 4500000 || !Number.isSafeInteger(options.termMs) || options.termMs < 1 || options.termMs > 2000 || !Number.isSafeInteger(options.killMs) || options.killMs < 1 || options.killMs > 1000) throw problem('OUTER_OPTIONS');
    const parent = path.dirname(options.directory);
    if (await fs.realpath(parent) !== parent) throw problem('OUTER_PARENT_ALIAS');
    await fs.mkdir(options.directory, { mode: 0o700 });
    directoryCreated = true;
    for (const name of [...channels, 'intent', 'events']) {
      const handle = await io.open(path.join(options.directory, name + (channels.includes(name) ? '.raw' : '.ndjson')), 'wx', 0o600);
      handles.set(name, handle);
      receipt.files[name] = { syncAttempted: false, synced: false, closeAttempted: false, closed: false };
      if (channels.includes(name)) {
        receipt.streams[name] = { observed: 0, retained: 0, lost: 0, limit: LIMITS[name], truncated: false, writeFailed: false, ended: false, sha256: null };
        hashes.set(name, digest());
      }
    }
    events('captures-open');
    const intent = encode({ schema: 'BREADTH_OUTER_INTENT_V1', runId: options.runId, limit: LIMITS, command: options.command.file, argvCount: options.command.args.length });
    if (intent.length > LIMITS.intent) throw problem('OUTER_INTENT_BYTES');
    await writeAll(handles.get('intent'), intent);
    await handles.get('intent').sync();
    await persistEvent({ phase: 'captures-open-before-admission' });
    await hooks.beforeLaunch?.();
    const remaining = options.totalMs - (Date.now() - started) - options.termMs - options.killMs;
    if (remaining <= 0) throw problem('OUTER_PREFLIGHT_DEADLINE');
    events('admission-complete');
    receipt.child.attempted = true;
    child = spawn(options.command.file, options.command.args, { cwd: options.command.cwd, env: options.command.env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    receipt.child.pid = child.pid ?? null;
    receipt.child.group = child.pid ?? null;
    receipt.child.enrolled = true;
    child.once('error', error => { receipt.child.error = reasonRecord(error); fail('spawn', error); stop(); });
    child.once('exit', (code, signalName) => { receipt.child.exit = { code, signal: signalName }; });
    child.once('close', (code, signalName) => { receipt.child.close = { code, signal: signalName }; closeDone = true; closeResolve('close'); });
    for (const stream of child.stdio.slice(1)) stream.on('error', error => { fail('pipe', error); stop(); });
    events('child-enrolled-listeners-installed', { pid: receipt.child.pid });
    const consumers = channels.map(async (name, index) => {
      const state = receipt.streams[name];
      try {
        for await (const bytes of child.stdio[index + 1]) {
          state.observed += bytes.length;
          if (!Number.isSafeInteger(state.observed)) { fail(name, problem('OUTER_OBSERVATION_RANGE')); stop(); break; }
          const available = Math.max(0, state.limit - state.retained);
          const keep = state.writeFailed ? 0 : Math.min(available, bytes.length);
          if (keep) {
            try {
              await writeAll(handles.get(name), bytes.subarray(0, keep), part => { hashes.get(name).update(part); state.retained += part.length; });
            } catch (error) { state.writeFailed = true; fail(name + ':write', error); stop(); }
          }
          state.lost = state.observed - state.retained;
          if (state.observed > state.limit && !state.truncated) { state.truncated = true; fail(name, problem('OUTER_CAPTURE_CAP')); stop(); }
        }
        state.ended = true;
      } catch (error) { fail(name + ':read', error); stop(); }
    });
    timeoutTimer = setTimeout(() => { fail('deadline', problem('OUTER_DEADLINE')); stop(); }, remaining);
    try { await hooks.afterEnrolled?.(receipt.child); await persistEvent({ phase: 'child-enrolled', pid: receipt.child.pid }); }
    catch (error) { fail('after-enrollment', error); stop(); }
    await Promise.race([closePromise, deadlinePromise]);
    await Promise.all(consumers);
    clearTimeout(timeoutTimer);
    clearTimeout(killTimer);
    clearTimeout(retirementTimer);
    const probe = hooks.presence ?? processPresence;
    receipt.child.pidPresence = probe(receipt.child.pid);
    receipt.child.groupPresence = Number.isInteger(receipt.child.pid) ? probe(-receipt.child.pid) : 'not-created';
    if (receipt.child.pid === null && receipt.child.error && closeDone) {
      receipt.child.pidPresence = 'not-created';
      receipt.child.reaped = true;
    } else receipt.child.reaped = closeDone && receipt.child.exit !== null && receipt.child.pidPresence === 'absent' && receipt.child.groupPresence === 'absent';
    receipt.child.natural = receipt.child.reaped && receipt.signals.length === 0 && receipt.child.exit?.signal === null && receipt.child.close?.signal === null;
    if (!receipt.child.reaped) fail('retirement', problem('OUTER_RETIREMENT_UNKNOWN'));
    if (receipt.child.exit?.code !== 0 || receipt.child.close?.code !== 0 || !receipt.child.natural) fail('disposition', problem('OUTER_NONZERO_OR_UNNATURAL'));
    events('child-settled', { reaped: receipt.child.reaped, natural: receipt.child.natural });
  } catch (error) {
    fail('capture', error);
    if (child && !closeDone) {
      stop();
      await Promise.race([closePromise, deadlinePromise]);
    }
  } finally {
    clearTimeout(timeoutTimer);
    clearTimeout(killTimer);
    clearTimeout(retirementTimer);
    for (const [name, handle] of handles) await settleHandle(name, handle, receipt.files[name]);
    for (const [name, hash] of hashes) receipt.streams[name].sha256 = hash.digest('hex');
  }
  for (const name of channels) {
    const state = receipt.streams[name];
    if (state) state.lost = state.observed - state.retained;
  }
  const equal = channels.every(name => receipt.streams[name]?.observed === receipt.streams[name]?.retained && receipt.streams[name]?.lost === 0 && receipt.streams[name]?.ended === true);
  receipt.captureQualified = !receipt.primaryPresent && receipt.child.reaped && receipt.child.natural && equal && [...handles.keys()].every(name => receipt.files[name].synced && receipt.files[name].closed);
  try {
    if (!directoryCreated) throw problem('OUTER_DIRECTORY_NOT_CREATED');
    const bytes = encode(receipt);
    if (bytes.length > LIMITS.receipt) throw problem('OUTER_RECEIPT_BYTES');
    receiptHandle = await io.open(path.join(options.directory, 'RECEIPT.json'), 'wx', 0o600);
    await writeAll(receiptHandle, bytes);
    await receiptHandle.sync();
    await receiptHandle.close();
    receiptHandle = null;
  } catch (error) {
    publicationPresent = true;
    publicationReason = error;
    fail('receipt-publication', error);
    if (receiptHandle) {
      try { await receiptHandle.close(); } catch (later) { fail('receipt-publication-close', later); }
    }
  }
  if (directoryCreated) {
    try {
      const expected = [...handles.keys()].map(name => name + (channels.includes(name) ? '.raw' : '.ndjson'));
      if (receiptHandle !== undefined || !publicationPresent) expected.push('RECEIPT.json');
      const names = await fs.readdir(options.directory);
      if (JSON.stringify(names.sort()) !== JSON.stringify(expected.sort())) throw problem('OUTER_CAPTURE_CENSUS');
      let total = 0;
      for (const name of names) {
        const stat = await fs.lstat(path.join(options.directory, name));
        const role = name === 'RECEIPT.json' ? 'receipt' : name.split('.')[0];
        if (!stat.isFile() || (stat.mode & 511) !== 384 || stat.size > LIMITS[role]) throw problem('OUTER_CAPTURE_FILE_BOUND');
        if (channels.includes(role) && stat.size !== receipt.streams[role].retained) throw problem('OUTER_CAPTURE_LENGTH');
        total += stat.size;
      }
      if (total > LIMITS.outer) throw problem('OUTER_CAPTURE_TOTAL');
      receipt.actualCaptureBytes = total;
    } catch (error) { fail('capture-postguard', error); }
  }
  receipt.elapsedMs = Date.now() - started;
  if (receipt.elapsedMs > options.totalMs) fail('total-deadline', problem('OUTER_TOTAL_DEADLINE'));
  return { receipt, primaryPresent: receipt.primaryPresent, primaryReason, publicationPresent, publicationReason, qualified: receipt.captureQualified && !receipt.primaryPresent && !publicationPresent };
}

export function publishTerminal(value, write) {
  const result = { ok: false, primaryPresent: false, primaryReason: undefined, bytes: 0, retained: 0 };
  try {
    const bytes = encode(value);
    result.bytes = bytes.length;
    if (bytes.length > 8192) throw problem('OUTER_TERMINAL_BOUND');
    while (result.retained < bytes.length) {
      const count = write(bytes, result.retained, bytes.length - result.retained);
      if (!Number.isInteger(count) || count < 1 || count > bytes.length - result.retained) throw problem('OUTER_TERMINAL_WRITE_PROGRESS');
      result.retained += count;
    }
    result.ok = true;
  } catch (error) { result.primaryPresent = true; result.primaryReason = error; }
  return result;
}
