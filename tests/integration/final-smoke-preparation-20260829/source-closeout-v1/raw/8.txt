import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

export function tag(value) {
  if (value === null) return { type: 'null' };
  const type = typeof value;
  return ['number', 'boolean', 'string'].includes(type) ? { type, value: type === 'string' ? value.slice(0, 256) : value } : { type };
}
export function errors() {
  let primaryPresent = false, primary;
  const secondary = [];
  return { add(value) { if (!primaryPresent) { primaryPresent = true; primary = value; } else secondary.push(value); }, snapshot() { return { primaryPresent, ...(primaryPresent ? { primary: tag(primary) } : {}), secondary: secondary.map(tag) }; } };
}
export function writeAll(io, descriptor, buffer, charge) {
  charge(buffer.length);
  for (let offset = 0; offset < buffer.length;) {
    const count = io.writeSync(descriptor, buffer, offset, buffer.length - offset);
    if (!Number.isInteger(count) || count <= 0 || count > buffer.length - offset) throw new Error('CAPTURE_WRITE');
    offset += count;
  }
}
export function openPair(io, files, secondary) {
  const first = io.openSync(files[0], 'wx');
  try { return [first, io.openSync(files[1], 'wx')]; }
  catch (reason) { try { io.closeSync(first); } catch (extra) { secondary(extra); } throw reason; }
}
export function identity(filename, maximum) {
  const stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= maximum);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev);
    const buffer = Buffer.alloc(65536), hash = crypto.createHash('sha256'); let bytes = 0, count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) { bytes += count; assert(bytes <= stat.size && bytes <= maximum); hash.update(buffer.subarray(0, count)); }
    assert.equal(bytes, stat.size); return { path: filename, bytes, sha256: hash.digest('hex') };
  } finally { fs.closeSync(descriptor); }
}
export class Owner {
  constructor(config) {
    this.config = config; this.started = performance.now(); this.bytes = 0; this.metadataBytes = 0; this.terminal = false; this.poisoned = false;
    this.rows = []; this.attempts = []; this.active = new Map();
    this.self = Object.freeze({ id: `owner-${process.pid}`, role: 'administrative-owner', pid: process.pid, startUTC: new Date().toISOString(), startObserved: true, exitObserved: false, closeObserved: false, state: 'LIVE_COORDINATOR' });
  }
  check() { assert(!this.poisoned && performance.now() - this.started + (this.terminal ? 0 : this.config.reserveMs) < this.config.wallMs, 'CLOCK_OR_POISON'); }
  charge(bytes, metadata = false) {
    const field = metadata ? 'metadataBytes' : 'bytes', maximum = metadata ? this.config.metadataLimit : this.config.captureLimit;
    assert(Number.isSafeInteger(bytes) && bytes >= 0 && this[field] + bytes <= maximum - (this.terminal ? 0 : this.config.tailBytes), 'BYTE_LIMIT'); this[field] += bytes;
  }
  snapshot() { return structuredClone({ schema: 'administrative-owner-r1', self: this.self, starts: this.rows, attempts: this.attempts, knownStarts: 1 + this.rows.length, activeKnownPIDs: [...this.active.keys()], captureBytes: this.bytes, metadataBytes: this.metadataBytes, elapsedMs: performance.now() - this.started, poisoned: this.poisoned }); }
  persist(filename, value) {
    const body = Buffer.from(JSON.stringify(value, null, 2) + '\n'); const descriptor = fs.openSync(filename, 'wx');
    try { writeAll(fs, descriptor, body, count => this.charge(count, true)); } finally { fs.closeSync(descriptor); }
    return { path: filename, bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
  }
  async run(role, tool, argv, timeoutMs = 10000, implementation = spawn) {
    this.check(); assert.match(role, /^[a-z0-9-]{1,64}$/); assert(Array.isArray(argv) && argv.every(value => typeof value === 'string'));
    const admitted = this.config.tools.find(entry => entry.path === tool); assert(admitted, 'UNKNOWN_TOOL'); assert.deepEqual(identity(tool, 128 * 1024 * 1024), admitted, 'CHANGED_TOOL');
    assert(!this.attempts.some(entry => entry.role === role), 'DUPLICATE_ROLE'); assert(2 + this.rows.length <= this.config.maxStarts && 2 + this.active.size <= this.config.peak, 'ROLE_LIMIT');
    const files = [path.join(this.config.raw, role + '.stdout'), path.join(this.config.raw, role + '.stderr')], state = errors(), closeErrors = [];
    let descriptors;
    try { descriptors = openPair(fs, files, extra => closeErrors.push(extra)); }
    catch (reason) { state.add(reason); for (const extra of closeErrors) state.add(extra); this.poisoned = true; return { faults: state.snapshot(), files }; }
    const attempt = { role, tool, argv: [...argv], atUTC: new Date().toISOString(), spawned: false }; this.attempts.push(attempt);
    let child, row, closed = false, resolveClosed;
    const closedPromise = new Promise(resolve => { resolveClosed = resolve; });
    const signal = name => { if (child?.pid && !closed) { try { const sent = child.kill(name); row.signals.push({ name, sent, atUTC: new Date().toISOString() }); } catch (reason) { state.add(reason); } } };
    const wait = async duration => { let timer; try { return await Promise.race([closedPromise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, duration)); })]); } finally { clearTimeout(timer); } };
    try {
      child = implementation(tool, argv, { cwd: this.config.cwd, env: this.config.env, stdio: ['ignore', 'pipe', 'pipe'] });
      if (Number.isSafeInteger(child.pid) && child.pid > 0) { row = { id: `${role}-${child.pid}`, role, pid: child.pid, tool, argv: [...argv], startUTC: new Date().toISOString(), startObserved: true, exitObserved: false, closeObserved: false, stdoutEnd: false, stderrEnd: false, signals: [] }; attempt.spawned = true; this.rows.push(row); this.active.set(row.pid, child); }
      child.once('error', reason => { state.add(reason); });
      child.once('exit', (code, reason) => { if (row) { row.exitObserved = true; row.exitCode = code; row.exitSignal = reason; row.exitUTC = new Date().toISOString(); } });
      child.once('close', (code, reason) => { closed = true; if (row) { row.closeObserved = true; row.closeCode = code; row.closeSignal = reason; row.closeUTC = new Date().toISOString(); this.active.delete(row.pid); } resolveClosed(); });
      for (const [stream, descriptor, field] of [[child.stdout, descriptors[0], 'stdoutEnd'], [child.stderr, descriptors[1], 'stderrEnd']]) {
        stream.once('end', () => { if (row) row[field] = true; });
        stream.on('error', reason => { state.add(reason); signal('SIGTERM'); });
        stream.on('data', buffer => { try { writeAll(fs, descriptor, buffer, count => this.charge(count)); } catch (reason) { state.add(reason); signal('SIGTERM'); } });
      }
      if (!await wait(Math.min(timeoutMs, this.config.wallMs - (performance.now() - this.started) - this.config.cleanupMs - (this.terminal ? 0 : this.config.reserveMs)))) state.add('CHILD_DEADLINE');
    } catch (reason) { state.add(reason); }
    finally {
      if (child && !closed) { signal('SIGTERM'); if (!await wait(this.config.cleanupMs / 2)) { signal('SIGKILL'); if (!await wait(this.config.cleanupMs / 2)) state.add('RETIREMENT_UNKNOWN'); } }
      for (const descriptor of descriptors) { try { fs.closeSync(descriptor); } catch (reason) { state.add(reason); } }
    }
    if (row && !(row.exitObserved && row.closeObserved && row.stdoutEnd && row.stderrEnd)) state.add('INCOMPLETE_OBSERVATION');
    const result = { row: row && structuredClone(row), attempt: structuredClone(attempt), files, faults: state.snapshot() };
    if (result.faults.primaryPresent) this.poisoned = true;
    return result;
  }
}
