import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { describeError, milliseconds, minimum, now, requireFact } from './primitives.mjs';
import { chargeCapture, markCaptureOverflow, publishReservedJson, releaseProcessReceipt, reserveProcessReceipt } from './capture-budget-v3.mjs';

const active = new Map();
export const activeChildren = () => [...active.values()].map(owner => ({ pid: owner.child.pid, group: owner.child.pid, role: owner.role }));
export function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
export function startOwned(options) {
  requireFact(['outer', 'tool', 'coordinator'].includes(options.role), 'PROCESS_ROLE');
  requireFact(![...active.values()].some(owner => owner.role === options.role), 'CONCURRENT_OWNER');
  requireFact(now() < BigInt(options.workDeadline), 'NO_CHILD_TIME');
  const metadataReservation = reserveProcessReceipt(options.budget, options.role);
  const output = {};
  for (const name of ['stdout', 'stderr']) output[name] = { path: join(options.directory, `${options.name}.${name}.bin`), descriptor: null, bytes: 0, digest: createHash('sha256') };
  let closeObserved = false;
  let exitCode = null;
  let exitSignal = null;
  let spawnError = null;
  let timedOut = false;
  let overflow = false;
  let termAt = null;
  let killAt = null;
  let closedAt = null;
  let total = 0;
  let settled = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const reservation = { role: options.role, child: { pid: null }, registeredBeforeSpawnNs: now().toString() };
  active.set(reservation, reservation);
  let child;
  try {
    for (const stream of Object.values(output)) stream.descriptor = openSync(stream.path, 'wx', 0o600);
    child = spawn(options.executable, options.argv, { cwd: options.cwd, env: options.env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe', ...(options.ipc ? ['ipc'] : [])] });
    reservation.child = child;
  } catch (error) {
    active.delete(reservation);
    const cleanupErrors = [];
    for (const stream of Object.values(output)) if (stream.descriptor !== null) { try { closeSync(stream.descriptor); } catch (cleanupError) { cleanupErrors.push(describeError(cleanupError)); } }
    try { publishReservedJson(metadataReservation, join(options.directory, `${options.name}.process.json`), { role: options.role, code: null, signal: null, spawnError: describeError(error), registeredBeforeSpawnNs: reservation.registeredBeforeSpawnNs, noChildSpawned: true, reaped: true, cleanupErrors }); }
    catch {}
    finally { releaseProcessReceipt(metadataReservation); }
    throw error;
  }
  const terminate = reason => {
    if (reason === 'timeout') timedOut = true;
    if (termAt === null && child.pid) {
      termAt = now();
      signalGroup(child.pid, 'SIGTERM');
    }
  };
  const capture = (name, bytes) => {
    try {
      const stream = output[name];
      const remaining = Math.max(0, Math.min(options.captureLimit - total, options.budget.remaining));
      const accepted = bytes.subarray(0, remaining);
      if (accepted.length) {
        chargeCapture(options.budget, accepted.length);
        let offset = 0;
        while (offset < accepted.length) {
          const written = writeSync(stream.descriptor, accepted, offset, accepted.length - offset);
          requireFact(written > 0, 'CAPTURE_WRITE_PROGRESS');
          stream.digest.update(accepted.subarray(offset, offset + written));
          stream.bytes += written;
          total += written;
          offset += written;
        }
      }
      if (accepted.length !== bytes.length) { overflow = true; markCaptureOverflow(options.budget, 'RAW_CAPTURE_OVERFLOW', bytes.length, remaining); terminate('overflow'); }
    } catch (error) { spawnError ??= describeError(error); terminate('capture-error'); }
  };
  child.stdout.on('data', bytes => capture('stdout', bytes));
  child.stderr.on('data', bytes => capture('stderr', bytes));
  child.on('error', error => { spawnError = describeError(error); });
  child.on('close', (code, signal) => { closeObserved = true; exitCode = code; exitSignal = signal; closedAt = now(); });
  const finish = reaped => {
    if (settled) return;
    settled = true;
    clearInterval(timer);
    for (const stream of Object.values(output)) {
      try { fsyncSync(stream.descriptor); } catch (error) { spawnError ??= describeError(error); }
      try { closeSync(stream.descriptor); } catch (error) { spawnError ??= describeError(error); }
    }
    const receipt = { role: options.role, pid: child.pid ?? null, group: child.pid ?? null, registeredBeforeSpawnNs: reservation.registeredBeforeSpawnNs, code: exitCode, signal: exitSignal, timedOut, overflow, spawnError, closeObserved, reaped, termSentNs: termAt?.toString() ?? null, killSentNs: killAt?.toString() ?? null, closedNs: closedAt?.toString() ?? null, workDeadlineNs: options.workDeadline.toString(), hardDeadlineNs: options.hardDeadline.toString(), endedNs: now().toString() };
    for (const [name, stream] of Object.entries(output)) { receipt[`${name}Path`] = stream.path; receipt[`${name}Bytes`] = stream.bytes; receipt[`${name}Sha256`] = stream.digest.digest('hex'); }
    try {
      const publication = publishReservedJson(metadataReservation, join(options.directory, `${options.name}.process.json`), receipt);
      receipt.metadataArtifact = publication.artifact;
      receipt.metadataComplete = publication.complete;
      if (!publication.complete) receipt.overflow = true;
    } catch (error) {
      receipt.metadataComplete = false;
      receipt.metadataError = describeError(error);
      receipt.spawnError ??= receipt.metadataError;
    } finally {
      releaseProcessReceipt(metadataReservation);
      if (reaped) active.delete(reservation);
      resolveDone(receipt);
    }
  };
  const timer = setInterval(() => {
    try {
      const instant = now();
      const workDeadline = minimum(BigInt(options.workDeadline), options.currentDeadline?.() ?? BigInt(options.workDeadline));
      if (instant >= workDeadline) terminate('timeout');
      if (termAt !== null && instant >= termAt + milliseconds(1000) && child.pid && groupAlive(child.pid)) { killAt ??= instant; signalGroup(child.pid, 'SIGKILL'); }
      if (closeObserved && (!child.pid || !groupAlive(child.pid))) finish(true);
      else if (closeObserved && termAt === null) terminate('remaining-group');
      if (instant >= BigInt(options.hardDeadline)) { if (child.pid) { killAt ??= instant; signalGroup(child.pid, 'SIGKILL'); } finish(closeObserved && (!child.pid || !groupAlive(child.pid))); }
    } catch (error) { spawnError = describeError(error); terminate('monitor-error'); if (now() >= BigInt(options.hardDeadline)) finish(false); }
  }, 10);
  return { child, done, terminate };
}
export async function stopAll(deadline) {
  for (const owner of active.values()) if (owner.child.pid) signalGroup(owner.child.pid, 'SIGTERM');
  const escalation = minimum(BigInt(deadline), now() + milliseconds(1000));
  while (now() < BigInt(deadline)) {
    const alive = [...active.values()].filter(owner => owner.child.pid && groupAlive(owner.child.pid));
    if (alive.length === 0) return true;
    if (now() >= escalation) for (const owner of alive) signalGroup(owner.child.pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return [...active.values()].every(owner => !owner.child.pid || !groupAlive(owner.child.pid));
}
