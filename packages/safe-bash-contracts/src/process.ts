import type { InvocationCleanup } from './command.js';

/** Explicit process signals are independent of invocation cancellation. The host
 * admits a named/numbered pair in its native signal namespace. Acceptance is not
 * process termination; the process outcome supplies that separate observation. */
export interface ProcessSignalRequest {
  readonly name: string;
  readonly number: number;
  readonly target: 'process-group';
}
export interface ProcessSignalEvent extends ProcessSignalRequest {
  readonly sequence: bigint;
}
export interface ProcessSignalAcceptance {
  readonly sequence: bigint;
}
export interface ProcessSignals {
  subscribe(accept: (event: ProcessSignalEvent) => Promise<ProcessSignalAcceptance>): InvocationCleanup;
}

/** One invocation subscriber, bounded outstanding requests, ordered acceptance.
 * No queued signals are replayed to a later invocation. Unsubscription blocks
 * new admission and drains requests already admitted to that subscriber. */
export function createProcessSignalChannel(): ProcessSignals & {
  send(request: ProcessSignalRequest): Promise<ProcessSignalAcceptance>;
} {
  let subscriber: { accept: (event: ProcessSignalEvent) => Promise<ProcessSignalAcceptance> } | undefined;
  let sequence = 0n;
  let pending = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    subscribe(accept) {
      if (subscriber || pending) throw new Error('Process signal subscriber is already active');
      if (typeof accept !== 'function') throw new TypeError('Invalid process signal subscriber');
      const subscription = { accept };
      subscriber = subscription;
      let closing: Promise<void> | undefined;
      return () => {
        if (closing) return closing;
        if (subscriber === subscription) subscriber = undefined;
        closing ??= tail;
        return closing;
      };
    },
    async send(request) {
      if (!subscriber) throw new Error('No process signal subscriber');
      if (pending >= 64) throw new RangeError('Process signal admission limit');
      const subscription = subscriber;
      const { name, number, target } = request;
      if (typeof name !== 'string' || !name || name.includes('\0')
        || !Number.isSafeInteger(number) || number < 1 || number > 255
        || target !== 'process-group') throw new TypeError('Invalid process signal request');
      // Host accessors can close/rebind the subscription or admit more work
      // while fields are read. Commit admission only against the same owner.
      if (subscriber !== subscription) throw new Error('Process signal subscriber changed during admission');
      if (pending >= 64) throw new RangeError('Process signal admission limit');
      const event = Object.freeze({ name, number, target, sequence: ++sequence });
      pending++;
      const operation = tail.then(async () => {
        const acknowledgment = await subscription.accept(event);
        if (acknowledgment.sequence !== event.sequence) throw new TypeError('Process signal acceptance sequence conflict');
        return { sequence: event.sequence };
      });
      tail = operation.then(() => {}, () => {});
      try { return await operation; } finally { pending--; }
    },
  };
}
