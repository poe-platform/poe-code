import assert from "node:assert/strict";

export function barrier() {
  let release;
  let reached;
  let released = false;
  const entered = new Promise((resolve) => { reached = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  return { entered, async hold() { reached(); await pending; }, release() { if (!released) { released = true; release(); } }, get released() { return released; } };
}
export function cooperativeOwner() {
  const pending = new Set();
  let closed = false;
  let completion;
  return {
    admit(operation) {
      assert(!closed, "owned admission closed");
      const promise = Promise.resolve().then(operation);
      pending.add(promise);
      void promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return promise;
    },
    close() {
      if (!completion) { closed = true; completion = Promise.allSettled([...pending]); }
      return completion;
    },
    get pending() { return pending.size; },
    get closed() { return closed; }
  };
}
export function boundedSink({ maxBytes = 16 * 1024 * 1024, hold, failAt, failure } = {}) {
  const chunks = [];
  let writes = 0;
  let inFlight = 0;
  let maximum = 0;
  let bytes = 0;
  return {
    chunks,
    async write(chunk) {
      assert(chunk instanceof Uint8Array);
      writes++;
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      try {
        assert(bytes + chunk.byteLength <= maxBytes, "harness sink cap");
        const copy = Uint8Array.from(chunk);
        if (hold) { await hold(writes); assert.deepEqual(chunk, copy, "pending sink bytes mutated"); }
        if (writes === failAt) throw failure;
        chunks.push(copy);
        bytes += copy.byteLength;
      } finally { inFlight--; }
    },
    get writes() { return writes; },
    get maximumInFlight() { return maximum; },
    get bytes() { return bytes; }
  };
}
export function continuationAllowed(result) {
  return result.closed === true && result.natural === true && result.intact === true && result.timedOut === false && result.leak === false && ["pass", "assertion-failure"].includes(result.kind);
}
