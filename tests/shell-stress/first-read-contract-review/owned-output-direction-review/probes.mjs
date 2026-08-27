import { Buffer } from 'node:buffer';

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function createBoundedTrace(maxEvents = 64, maxEventBytes = 512) {
  const events = [];
  return {
    record(event) {
      const encoded = JSON.stringify(event);
      if (events.length >= maxEvents || Buffer.byteLength(encoded) > maxEventBytes) {
        throw new Error('Preparation probe trace bound exceeded');
      }
      events.push(JSON.parse(encoded));
    },
    snapshot() {
      return structuredClone(events);
    }
  };
}

export function createOpaqueBorrowedInput(chunks, trace = createBoundedTrace()) {
  const payloads = chunks.map(chunk => new TextEncoder().encode(chunk));
  const counts = { next: 0, returned: 0, canceled: 0, closed: 0, rejected: 0 };
  let pending;
  let offset = 0;
  let sourceClosed = false;

  function destructiveCall(kind) {
    counts[kind] += 1;
    sourceClosed = true;
    trace.record({ event: `borrowed-${kind}`, pending: Boolean(pending) });
  }

  const iterator = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      counts.next += 1;
      trace.record({ event: 'borrowed-next', call: counts.next, offset });
      if (pending) {
        return Promise.reject(new Error('Concurrent underlying borrowed next'));
      }
      if (sourceClosed) {
        return Promise.resolve({ done: true, value: undefined });
      }
      pending = createDeferred();
      return pending.promise;
    },
    return() {
      destructiveCall('returned');
      return Promise.resolve({ done: true, value: undefined });
    },
    cancel() {
      destructiveCall('canceled');
    },
    close() {
      destructiveCall('closed');
    }
  };

  return {
    iterator,
    release() {
      if (!pending) throw new Error('No admitted opaque read to release');
      const current = pending;
      pending = undefined;
      if (offset === payloads.length) {
        trace.record({ event: 'borrowed-eof' });
        current.resolve({ done: true, value: undefined });
        return;
      }
      const value = payloads[offset].slice();
      trace.record({ event: 'borrowed-delivery', offset, hex: Buffer.from(value).toString('hex') });
      offset += 1;
      current.resolve({ done: false, value });
    },
    reject(reason) {
      if (!pending) throw new Error('No admitted opaque read to reject');
      const current = pending;
      pending = undefined;
      counts.rejected += 1;
      trace.record({ event: 'borrowed-rejection', offset });
      current.reject(reason);
    },
    snapshot() {
      return { counts: { ...counts }, pending: Boolean(pending), deliveredChunks: offset, sourceClosed };
    },
    trace
  };
}

