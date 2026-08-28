export const VERSION = 'observer-qualification-v6.1';

export function reasonData(reason) {
  if (reason === undefined) return { type: 'undefined' };
  if (reason === null) return { type: 'null' };
  if (reason instanceof Error) return { type: 'Error', name: reason.name, message: reason.message, code: reason.code ?? null };
  return { type: typeof reason, value: reason };
}

export function inspectState(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.resources) || snapshot.resources.length !== snapshot.created ||
      typeof snapshot.hasFailure !== 'boolean' || typeof snapshot.traceOverflow !== 'boolean') return 'UNKNOWN';
  if (snapshot.traceOverflow || snapshot.hasFailure) return 'HOLD';
  for (const resource of snapshot.resources) {
    if (typeof resource.closed !== 'boolean' || typeof resource.destroyed !== 'boolean' ||
        typeof resource.closeDelivered !== 'boolean' || typeof resource.cleanupRegistered !== 'boolean' ||
        !['pending', 'settled', 'rejected'].includes(resource.cleanup) ||
        !Number.isSafeInteger(resource.writePending) || resource.writePending < 0 ||
        !Number.isSafeInteger(resource.endPending) || resource.endPending < 0) return 'UNKNOWN';
    if (!resource.closed || !resource.destroyed || !resource.cleanupRegistered ||
        resource.cleanup !== 'settled' || resource.writePending || resource.endPending) return 'HOLD';
  }
  return snapshot.resources.some(resource => !resource.closeDelivered) ? 'NOTIFICATION_PENDING' : 'CLEAR';
}

export function comparePredicates(settlement, horizon) {
  const old = settlement.created - settlement.resources.filter(resource => resource.closeDelivered).length !== 0 ? 'HOLD' : 'CLEAR';
  const atSettlement = inspectState(settlement);
  const atHorizon = inspectState(horizon);
  return { oldNotificationPredicate: old, atSettlement, atHorizon,
    proposedTerminal: ['CLEAR', 'NOTIFICATION_PENDING'].includes(atSettlement) && atHorizon === 'CLEAR' ? 'PASS' : 'HOLD' };
}

export class Observer {
  constructor(id) {
    this.id = id;
    this.resources = [];
    this.trace = [];
    this.failures = [];
    this.afterOutcome = false;
    this.traceOverflow = false;
    this.hasPrimary = false;
    this.primary = undefined;
    this.maxUnobservedNotifications = 0;
    this.maxNotClosed = 0;
    this.maxStatePending = 0;
  }

  reserve() {
    if (this.resources.length >= 2) throw new Error('resource bound');
    const resource = { id: this.resources.length + 1, created: false, cleanupRegistered: true,
      destroyRequested: 0, destroyed: false, closed: false, closeDelivered: false, error: 0,
      end: 0, finish: 0, writeCallbacks: 0, endCallbacks: 0, writePending: 0, endPending: 0,
      cleanup: 'pending', stream: null };
    this.resources.push(resource);
    this.record('cleanup-enrolled-before-acquisition');
    return resource;
  }

  attach(resource, stream) {
    resource.stream = stream;
    resource.created = true;
    stream.on('error', reason => { resource.error++; this.failure(reason, 'stream-error'); });
    stream.on('close', () => { resource.closeDelivered = true; this.record('close-delivered'); });
    stream.on('end', () => { resource.end++; this.record('end-event'); });
    stream.on('finish', () => { resource.finish++; this.record('finish-event'); });
    const observer = this;
    const destroy = stream.destroy;
    stream.destroy = function (...args) {
      resource.destroyRequested++;
      observer.record('destroy-requested');
      try { return Reflect.apply(destroy, this, args); }
      finally { observer.record('destroy-returned'); }
    };
    for (const method of ['write', 'end']) {
      const original = stream[method];
      stream[method] = function (...args) {
        const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined;
        const pending = method + 'Pending', completed = method + 'Callbacks';
        resource[pending]++;
        observer.record(method + '-admitted');
        let called = false;
        const done = reason => {
          if (called) { observer.failure(new Error('duplicate callback'), method); return; }
          called = true;
          resource[pending]--; resource[completed]++;
          if (reason !== undefined && reason !== null) observer.failure(reason, method + '-callback');
          observer.record(method + '-callback');
          if (callback) Reflect.apply(callback, this, [reason]);
        };
        try { return Reflect.apply(original, this, [...args, done]); }
        catch (reason) { if (!called) { called = true; resource[pending]--; } observer.failure(reason, method + '-throw'); throw reason; }
      };
    }
    this.record('created');
  }

  primaryFailure(reason) {
    if (!this.hasPrimary) { this.hasPrimary = true; this.primary = reason; }
    this.record('primary-failure');
  }

  failure(reason, channel) {
    if (this.failures.length < 64) this.failures.push({ reason, channel, late: this.afterOutcome, acknowledged: false });
    else this.traceOverflow = true;
    this.record(channel);
  }

  snapshot(label) {
    const resources = this.resources.filter(resource => resource.created).map(resource => ({
      id: resource.id, cleanupRegistered: resource.cleanupRegistered,
      destroyRequested: resource.destroyRequested, destroyed: resource.stream ? resource.stream.destroyed : resource.destroyed,
      closed: resource.stream ? resource.stream.closed : resource.closed,
      closeDelivered: resource.closeDelivered, error: resource.error, end: resource.end, finish: resource.finish,
      writeCallbacks: resource.writeCallbacks, endCallbacks: resource.endCallbacks,
      writePending: resource.writePending, endPending: resource.endPending, cleanup: resource.cleanup,
    }));
    return { label, created: resources.length, resources, traceOverflow: this.traceOverflow,
      hasPrimary: this.hasPrimary, primary: reasonData(this.primary),
      hasFailure: this.failures.some(failure => !failure.acknowledged),
      failures: this.failures.map(failure => ({ ...failure, reason: reasonData(failure.reason) })) };
  }

  record(event) {
    const snapshot = this.snapshot(event);
    this.maxUnobservedNotifications = Math.max(this.maxUnobservedNotifications, snapshot.resources.filter(resource => !resource.closeDelivered).length);
    this.maxNotClosed = Math.max(this.maxNotClosed, snapshot.resources.filter(resource => resource.closed !== true).length);
    this.maxStatePending = Math.max(this.maxStatePending, snapshot.resources.filter(resource => resource.closed !== true || resource.cleanup !== 'settled' || resource.writePending || resource.endPending).length);
    if (this.trace.length < 256) this.trace.push({ sequence: this.trace.length, event, afterOutcome: this.afterOutcome, snapshot });
    else this.traceOverflow = true;
  }

  settle(acceptedReasons = []) {
    for (const failure of this.failures) if (acceptedReasons.includes(failure.reason) && !failure.late) failure.acknowledged = true;
    this.record('product-settlement-surrogate');
    const snapshot = this.snapshot('product-settlement-surrogate');
    this.afterOutcome = true;
    return snapshot;
  }
}

export async function notificationHorizon(observer) {
  for (let turn = 0; turn < 2; turn++) {
    await new Promise(resolve => process.nextTick(resolve));
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    observer.record('notification-turn-' + (turn + 1));
  }
  return observer.snapshot('bounded-notification-horizon');
}
