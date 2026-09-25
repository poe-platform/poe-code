import assert from "node:assert/strict";
import { test } from "node:test";
import { createBytePipe } from "./io.js";
import { addManagedAbortWaiter } from "./managed-abort.js";
import { createOutputOperation } from "./output.js";

const waitersSymbol = Symbol.for("safe-bash.managedWaiters");
const discard = { async write() {} };

function seed(signal: AbortSignal, waiter: (reason: unknown) => void, multiple = false): void {
  Reflect.set(signal, waitersSymbol, multiple ? new Set([waiter]) : waiter);
}

for (const reason of [false, null, 0, ""]) {
  test(`active pipe listener shares cancellation storage with shell waiters: ${String(reason)}`, async () => {
    const upstream = createOutputOperation({ signal: new AbortController().signal }, discard);
    const pipe = createBytePipe({ signal: upstream.signal });
    try {
      const reading = pipe.endpoints!.read.readable[Symbol.asyncIterator]().next();
      assert.equal(typeof Reflect.get(upstream.signal, waitersSymbol), "function", "first pipe waiter uses singleton storage");
      const received: unknown[] = [];
      addManagedAbortWaiter(upstream.signal, value => { received.push(value); });
      const waiters: unknown = Reflect.get(upstream.signal, waitersSymbol);
      assert.ok(waiters instanceof Set, "a second listener shares the waiter Set");
      const rejected = assert.rejects(reading, error => Object.is(error, reason));
      await upstream.abort(reason);
      await rejected;
      assert.deepEqual(received, [reason]);
      assert.equal(Reflect.get(upstream.signal, waitersSymbol), waiters);
      assert.equal(waiters.size, 0);
    } finally { await pipe.abort(reason); await upstream.close(); }
  });
}

for (const multiple of [false, true]) {
  test(`pipe cancellation preserves preexisting ${multiple ? "set" : "singleton"} waiters`, async () => {
    const upstream = createOutputOperation({ signal: new AbortController().signal }, discard);
    const received: unknown[] = [];
    seed(upstream.signal, reason => received.push(reason), multiple);
    try {
      const pipe = createBytePipe({ signal: upstream.signal });
      const reading = pipe.endpoints!.read.readable[Symbol.asyncIterator]().next();
      const rejected = assert.rejects(reading, reason => Object.is(reason, false));
      await upstream.abort(false);
      await rejected;
      assert.deepEqual(received, [false]);
      await pipe.abort(false);
    } finally { await upstream.close(); }
  });

  test(`closing a pipe detaches only its own ${multiple ? "set" : "singleton"} subscription`, async () => {
    const upstream = createOutputOperation({ signal: new AbortController().signal }, discard);
    const received: unknown[] = [];
    const peer = (reason: unknown): void => { received.push(reason); };
    seed(upstream.signal, peer, multiple);
    try {
      const pipe = createBytePipe({ signal: upstream.signal });
      await pipe.endpoints!.read.close();
      await pipe.close();
      const current: unknown = Reflect.get(upstream.signal, waitersSymbol);
      assert.deepEqual(current instanceof Set ? [...current] : [current], [peer]);
      await upstream.abort(null);
      assert.deepEqual(received, [null]);
    } finally { await upstream.close(); }
  });

  for (const reason of [false, 0, "", null]) {
    test(`output cancellation preserves ${multiple ? "set" : "singleton"} waiter reason ${String(reason)}`, async () => {
      const upstream = createOutputOperation({ signal: new AbortController().signal }, discard);
      const received: unknown[] = [];
      seed(upstream.signal, value => received.push(value), multiple);
      try {
        const operation = createOutputOperation({ signal: upstream.signal }, discard);
        await upstream.abort(reason);
        assert.equal(operation.signal.aborted, true);
        assert.equal(operation.signal.reason, reason);
        assert.deepEqual(received, [reason]);
        await operation.close();
      } finally { await upstream.close(); }
    });
  }
}

test("output abort notifies a singleton waiter with its exact reason", async () => {
  const operation = createOutputOperation({ signal: new AbortController().signal }, discard);
  const received: unknown[] = [];
  seed(operation.signal, reason => received.push(reason));
  await operation.abort(false);
  assert.deepEqual(received, [false]);
});

test("pipe consumer closure notifies a singleton and cancels its owned output", async () => {
  const pipe = createBytePipe();
  const signal = pipe.writable.ownedOutput!.consumerClosed;
  const received: unknown[] = [];
  seed(signal, reason => received.push(reason));
  const operation = createOutputOperation({ signal: new AbortController().signal }, pipe.writable);
  try {
    await pipe.endpoints!.read.close();
    await operation.close();
    assert.equal(operation.signal.reason, signal.reason);
    assert.deepEqual(received, [signal.reason]);
    assert.equal((signal.reason as { code: string }).code, "EPIPE");
  } finally { await pipe.close(); await operation.close(); }
});

test("output acquisition promotes an existing singleton and drains after cancellation", async () => {
  const operation = createOutputOperation({ signal: new AbortController().signal }, discard);
  const pending = Promise.withResolvers<number>();
  const received: unknown[] = [];
  const released: number[] = [];
  const acquired = operation.acquire(signal => {
    seed(signal, reason => received.push(reason));
    return pending.promise;
  }, value => { released.push(value); });
  const rejected = assert.rejects(acquired, reason => Object.is(reason, 0));
  void rejected.catch(() => {});
  const closing = operation.abort(0);
  try {
    await rejected;
    assert.deepEqual(received, [0]);
    pending.resolve(7);
    await closing;
    assert.deepEqual(released, [7]);
  } finally { pending.resolve(7); await closing; }
});
