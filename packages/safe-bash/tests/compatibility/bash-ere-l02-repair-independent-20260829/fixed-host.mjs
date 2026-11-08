import { EventEmitter } from 'node:events';

let configuration;
export function configure(options) {
  configuration = { ...options, events: [], workers: [], terminations: 0 };
  return configuration;
}
class Stream extends EventEmitter {
  constructor(control, name) { super(); this.control = control; this.name = name; this.readableEnded = false; this.closed = false; }
  once(event, handler) {
    this.control.events.push(this.name + ':enroll:' + event);
    if (Object.hasOwn(this.control.streamFaults ?? {}, this.name)) throw this.control.streamFaults[this.name];
    return super.once(event, handler);
  }
  finish() {
    this.control.events.push(this.name + ':observed-end');
    this.readableEnded = true; this.closed = true;
    this.emit('end'); this.emit('close');
  }
}
export class Worker extends EventEmitter {
  constructor() {
    super(); this.control = configuration; this.exitRegistrations = 0;
    this.stdout = new Stream(this.control, 'stdout'); this.stderr = new Stream(this.control, 'stderr');
    this.control.workers.push(this);
    queueMicrotask(() => this.emit('message', this.control.ready ?? { version: 1, operation: 'shell-ere', kind: 'ready' }));
  }
  once(event, handler) {
    if (event === 'exit') {
      this.exitRegistrations++;
      this.control.events.push('exit-enroll:' + this.exitRegistrations);
      if (this.control.persistent || this.control.single && this.exitRegistrations === 1) throw this.control.setup;
    }
    return super.once(event, handler);
  }
  finish(streams = true) {
    this.control.events.push('observed-exit'); this.emit('exit', 0);
    if (streams) { this.stdout.finish(); this.stderr.finish(); }
  }
  terminate() {
    const control = this.control;
    control.terminations++; control.events.push('terminate');
    const promise = new Promise((resolve, reject) => {
      if (control.rejectCleanup) { reject(control.cleanup); return; }
      if (control.pending) { control.complete = () => { this.finish(); resolve(0); }; return; }
      if (control.observedRejection) { queueMicrotask(() => { this.finish(); reject(control.cleanup); }); return; }
      this.once('exit', resolve);
      queueMicrotask(() => this.finish(!control.pendingStreams));
    });
    control.termination = promise;
    return promise;
  }
  postMessage() { throw this.control.postReason; }
}
