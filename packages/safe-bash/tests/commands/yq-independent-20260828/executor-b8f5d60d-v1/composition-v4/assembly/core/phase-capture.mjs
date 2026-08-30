import { appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { milliseconds, minimum, now, requireFact } from './primitives.mjs';
import { chargePhase, markCaptureOverflow, terminalJson } from './capture-budget-v3.mjs';

export const STATES = ['setup', 'admission', 'operation', 'capture', 'cleanup', 'complete'];
export class PhaseCapture {
  constructor(filename, job, deadline, budget) {
    this.descriptor = openSync(filename, 'wx', 0o600);
    this.job = job;
    this.deadline = deadline;
    this.index = -1;
    this.count = 0;
    this.bytes = 0;
    this.operationStart = null;
    this.filename = filename;
    this.budget = budget;
    this.lateFailure = null;
    this.lateError = null;
  }
  record(kind, detail = {}, transition = false) {
    const observed = now();
    const outgoingDeadline = this.currentDeadline();
    const next = transition ? STATES.indexOf(kind) : this.index;
    this.observeDeadline(observed, outgoingDeadline, kind, transition, 'record-entry', observed);
    const event = { schema: 1, index: this.count, jobId: this.job.id, phase: this.job.phase, kind, transition, parentMonotonicNs: observed.toString(), outgoingIndex: this.index, outgoingDeadlineNs: outgoingDeadline.toString(), deadlineMissed: this.lateFailure !== null, detail };
    const line = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.count + 1 > 4096 || this.bytes + bytes > 4194304 || bytes > 262144) {
      markCaptureOverflow(this.budget, 'PHASE_EVENT_BOUND', bytes, Math.max(0, Math.min(4194304 - this.bytes, 262144)));
      if (this.lateError) throw this.lateError;
      requireFact(false, 'PHASE_EVENT_BOUND');
    }
    chargePhase(this.budget, bytes);
    appendFileSync(this.descriptor, line);
    fsyncSync(this.descriptor);
    this.count++;
    this.bytes += bytes;
    if (this.lateError) throw this.lateError;
    if (transition) {
      requireFact(next === this.index + 1, 'PHASE_ORDER', `${this.job.id}:${kind}`);
      this.observeDeadline(now(), outgoingDeadline, kind, transition, 'before-index-change', observed);
      if (this.lateError) throw this.lateError;
      this.index = next;
      if (kind === 'operation') this.operationStart = observed;
    }
    return event;
  }
  observeDeadline(observed, outgoingDeadline, kind, transition, checkpoint, recordedEvent) {
    if (observed >= outgoingDeadline && this.lateFailure === null) {
      this.lateFailure = { schema: 1, code: 'PHASE_DEADLINE', jobId: this.job.id, outgoingIndex: this.index, outgoingState: STATES[this.index] ?? 'outer-admission', requestedKind: kind, transition, checkpoint, recordedEventNs: recordedEvent.toString(), parentMonotonicNs: observed.toString(), outgoingDeadlineNs: outgoingDeadline.toString(), absoluteDeadlines: this.deadline, sticky: true, acceptedTransition: false };
      this.lateError = Object.assign(new Error('PHASE_DEADLINE'), { code: 'PHASE_DEADLINE', unsafe: true });
      terminalJson(this.budget, 'phaseFailure', join(dirname(this.filename), 'phase-deadline.json'), this.lateFailure);
    }
  }
  absoluteDeadline() { return minimum(...['globalNs', 'phaseNs', 'jobNs', 'workNs'].map(name => BigInt(this.deadline[name]))); }
  operationDeadline() {
    if (this.operationStart === null) return this.absoluteDeadline();
    const millisecondsCap = ['SOURCE_RUNTIME', 'MOVED_RUNTIME', 'LOADED_CONTROLS'].includes(this.job.phase) ? 30000 : this.job.slotCapMs;
    return minimum(this.absoluteDeadline(), this.operationStart + milliseconds(millisecondsCap));
  }
  currentDeadline() {
    if (this.lateFailure) return minimum(this.absoluteDeadline(), BigInt(this.lateFailure.outgoingDeadlineNs));
    if (this.index < 2 && ['SOURCE_RUNTIME', 'MOVED_RUNTIME', 'LOADED_CONTROLS'].includes(this.job.phase)) {
      const setup = this.job.phase === 'SOURCE_RUNTIME' ? 5000 : 40000;
      return minimum(this.absoluteDeadline(), BigInt(this.deadline.reservationNs) + milliseconds(setup));
    }
    return this.index === 2 ? this.operationDeadline() : this.absoluteDeadline();
  }
  close() { if (this.descriptor !== null) { fsyncSync(this.descriptor); closeSync(this.descriptor); this.descriptor = null; } }
}
