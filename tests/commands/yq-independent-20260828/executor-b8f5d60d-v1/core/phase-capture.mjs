import { appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';
import { milliseconds, minimum, now, requireFact } from './primitives.mjs';

export const STATES = ['setup', 'admission', 'operation', 'capture', 'cleanup', 'complete'];
export class PhaseCapture {
  constructor(filename, job, deadline) {
    this.descriptor = openSync(filename, 'wx', 0o600);
    this.job = job;
    this.deadline = deadline;
    this.index = -1;
    this.count = 0;
    this.bytes = 0;
    this.operationStart = null;
  }
  record(kind, detail = {}, transition = false) {
    requireFact(now() <= BigInt(this.deadline.jobNs), 'PHASE_DEADLINE');
    if (transition) {
      const next = STATES.indexOf(kind);
      requireFact(next === this.index + 1, 'PHASE_ORDER', `${this.job.id}:${kind}`);
      this.index = next;
      if (kind === 'operation') this.operationStart = now();
    }
    const event = { schema: 1, index: this.count++, jobId: this.job.id, phase: this.job.phase, kind, transition, parentMonotonicNs: now().toString(), detail };
    const line = `${JSON.stringify(event)}\n`;
    this.bytes += Buffer.byteLength(line);
    requireFact(this.count <= 4096 && this.bytes <= 4194304 && Buffer.byteLength(line) <= 262144, 'PHASE_EVENT_BOUND');
    appendFileSync(this.descriptor, line);
    fsyncSync(this.descriptor);
    return event;
  }
  operationDeadline() {
    if (this.operationStart === null) return BigInt(this.deadline.workNs);
    const millisecondsCap = ['SOURCE_RUNTIME', 'MOVED_RUNTIME', 'LOADED_CONTROLS'].includes(this.job.phase) ? 30000 : this.job.slotCapMs;
    return minimum(BigInt(this.deadline.workNs), this.operationStart + milliseconds(millisecondsCap));
  }
  currentDeadline() {
    if (this.index < 2 && ['SOURCE_RUNTIME', 'MOVED_RUNTIME', 'LOADED_CONTROLS'].includes(this.job.phase)) {
      const setup = this.job.phase === 'SOURCE_RUNTIME' ? 5000 : 40000;
      return minimum(BigInt(this.deadline.workNs), BigInt(this.deadline.reservationNs) + milliseconds(setup));
    }
    return this.index === 2 ? this.operationDeadline() : BigInt(this.deadline.workNs);
  }
  close() { if (this.descriptor !== null) { fsyncSync(this.descriptor); closeSync(this.descriptor); this.descriptor = null; } }
}
