import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, atomicWrite, createEvidence, verifyGuards } from './integrity.mjs';

const active = new Map();
export const activeChildren = () => [...active.entries()].map(([pid, group]) => ({ pid, group }));

function groupAbsent(group) {
  try { process.kill(-group, 0); return false; }
  catch (error) { return error?.code === 'ESRCH'; }
}

export function validateBounds(bounds) {
  for (const [name, minimum, maximum] of [
    ['deadlineMs', 50, 30000], ['termGraceMs', 20, 2000], ['reapMs', 100, 5000],
    ['captureBytes', 1024, 33554432], ['maximumJobs', 1, 512],
  ]) assert(Number.isSafeInteger(bounds[name]) && bounds[name] >= minimum && bounds[name] <= maximum, `Invalid bound ${name}`);
}

export async function ownedNode({ executable, args, cwd, bounds }) {
  validateBounds(bounds);
  assert(process.platform !== 'win32', 'This recipe requires POSIX process groups');
  const started = Date.now();
  let spawnError = null;
  let closed = false;
  let exitCode = null;
  let signal = null;
  let timedOut = false;
  let overflow = false;
  let terminationRequested = false;
  let combinedBytes = 0;
  const stdout = [];
  const stderr = [];
  const kills = [];
  const child = spawn(executable, args, {
    cwd, detached: true, env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pid = child.pid ?? null;
  if (pid !== null) active.set(pid, pid);
  let killTimer;
  const killOwned = (kind) => {
    if (pid === null || groupAbsent(pid)) return;
    try { process.kill(-pid, kind); kills.push(kind); }
    catch (error) { if (error?.code !== 'ESRCH') kills.push(`${kind}:${error?.code ?? 'error'}`); }
  };
  const terminate = () => {
    if (terminationRequested) return;
    terminationRequested = true;
    killOwned('SIGTERM');
    killTimer = setTimeout(() => killOwned('SIGKILL'), bounds.termGraceMs);
  };
  const collect = (target) => (chunk) => {
    const available = Math.max(0, bounds.captureBytes - combinedBytes);
    if (chunk.length > available) { overflow = true; terminate(); }
    if (available > 0) target.push(Buffer.from(chunk.subarray(0, available)));
    combinedBytes += Math.min(available, chunk.length);
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.on('error', (error) => { spawnError = String(error); });
  child.on('close', (code, terminationSignal) => { closed = true; exitCode = code; signal = terminationSignal; });
  const deadline = setTimeout(() => { timedOut = true; terminate(); }, bounds.deadlineMs);
  const hardEnd = started + bounds.deadlineMs + bounds.termGraceMs + bounds.reapMs;
  while (Date.now() < hardEnd) {
    if (closed && (pid === null || groupAbsent(pid))) break;
    if (closed && pid !== null && !groupAbsent(pid)) terminate();
    await delay(10);
  }
  clearTimeout(deadline);
  clearTimeout(killTimer);
  let reaped = closed && (pid === null || groupAbsent(pid));
  if (!reaped) {
    killOwned('SIGKILL');
    const lastEnd = Date.now() + bounds.reapMs;
    while (Date.now() < lastEnd && !(closed && (pid === null || groupAbsent(pid)))) await delay(10);
    reaped = closed && (pid === null || groupAbsent(pid));
  }
  if (reaped && pid !== null) active.delete(pid);
  if (!reaped) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
  return {
    stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
    metadata: { pid, group: pid, exitCode, signal, timedOut, overflow, spawnError, closed, reaped, kills, elapsedMs: Date.now() - started },
  };
}

export function parseReceipt(bytes, jobId) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert(text.endsWith('\n'), 'Receipt must end with LF');
  const lines = text.slice(0, -1).split('\n');
  assert.equal(lines.length, 1, 'Exactly one receipt is required');
  const receipt = JSON.parse(lines[0]);
  assert.equal(JSON.stringify(receipt), lines[0], 'Noncanonical or duplicate-key receipt');
  assert(receipt && typeof receipt === 'object' && !Array.isArray(receipt));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.jobId, jobId, 'Wrong or missing receipt job');
  assert(['PASS', 'FAIL', 'CAPTURED'].includes(receipt.outcome), 'Malformed receipt outcome');
  return receipt;
}

export async function runJobs({ executable, jobs, guards, evidenceParent, bounds, assertReceipt, withholdReapProof = false }) {
  validateBounds(bounds);
  assert(jobs.length > 0 && jobs.length <= bounds.maximumJobs);
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length, 'Duplicate jobs');
  assert(jobs.every((job) => /^[A-Za-z0-9_-]+$/.test(job.id)), 'Unsafe job ID');
  verifyGuards(guards);
  const evidence = createEvidence(evidenceParent, guards);
  const results = [];
  let stop = null;
  for (const job of jobs) {
    try { verifyGuards(guards); }
    catch (error) { stop = 'integrity'; results.push({ jobId: job.id, admitted: false, failure: String(error) }); break; }
    const folder = join(evidence, job.id);
    mkdirSync(folder, { mode: 0o700 });
    const capture = await ownedNode({ executable, args: job.args, cwd: job.cwd, bounds });
    atomicWrite(join(folder, 'stdout.bin'), capture.stdout);
    atomicWrite(join(folder, 'stderr.bin'), capture.stderr);
    atomicJson(join(folder, 'child.json'), capture.metadata);
    let integrity = true;
    let integrityError = null;
    try { verifyGuards(guards); }
    catch (error) { integrity = false; integrityError = String(error); }
    const reapProof = capture.metadata.reaped && !withholdReapProof;
    atomicJson(join(folder, 'boundary.json'), { integrity, integrityError, reapProof, syntheticWithheldReapProof: withholdReapProof });
    const failures = [];
    if (!integrity) failures.push('integrity');
    if (!reapProof) failures.push('reap');
    const metadata = capture.metadata;
    if (metadata.exitCode !== 0 || metadata.signal !== null || metadata.timedOut || metadata.overflow || metadata.spawnError !== null) failures.push('child-process');
    let receipt = null;
    try {
      receipt = parseReceipt(capture.stdout, job.id);
      atomicJson(join(folder, 'receipt.json'), receipt);
      assert.notEqual(receipt.outcome, 'FAIL', 'Child receipt reports failure');
      await assertReceipt(receipt, job, folder);
    } catch (error) { failures.push(`assertion: ${String(error)}`); }
    const result = { jobId: job.id, admitted: true, outcome: failures.length ? 'FAIL' : 'PASS', failures, integrity, reapProof, metadata };
    atomicJson(join(folder, 'verdict.json'), result);
    results.push(result);
    if (!integrity || !reapProof) { stop = !integrity ? 'integrity' : 'reap'; break; }
  }
  const summary = {
    schemaVersion: 1, aggregate: stop || results.length !== jobs.length || results.some((result) => result.outcome !== 'PASS') ? 'FAIL' : 'PASS',
    requested: jobs.length, admitted: results.filter((result) => result.admitted).length,
    stop, results, activeChildren: activeChildren(), evidence,
  };
  if (summary.activeChildren.length) summary.aggregate = 'FAIL';
  atomicJson(join(evidence, 'summary.json'), summary);
  return summary;
}
