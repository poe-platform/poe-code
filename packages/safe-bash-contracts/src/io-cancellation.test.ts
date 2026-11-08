import assert from "node:assert/strict";
import { test } from "node:test";
import { createBytePipe, writeBytes } from "./io.js";

test("legacy pipe adapters retain identity and allocate consumer cancellation lazily", async context => {
  const native = globalThis.AbortController;
  let controllers = 0;
  context.mock.method(globalThis, "AbortController", new Proxy(native, {
    construct(target, args, receiver) {
      controllers++;
      return Reflect.construct(target, args, receiver);
    },
  }));
  const pipe = createBytePipe();
  try {
    const readable = pipe.readable;
    const iterator = readable[Symbol.asyncIterator]();
    const writable = pipe.writable;
    assert.equal(pipe.readable, readable);
    assert.equal(readable[Symbol.asyncIterator](), iterator);
    assert.equal(iterator, readable);
    assert.equal(pipe.writable, writable);
    assert.equal(writable.write, writable.ownedOutput!.write);
    assert.equal(controllers, 0);

    const write = writable.write;
    const next = iterator.next;
    const bytes = Uint8Array.of(1, 2);
    await write(bytes);
    bytes.fill(0);
    assert.deepEqual(await next(), { done: false, value: Uint8Array.of(1, 2) });
    assert.equal(controllers, 0);

    const signal = writable.ownedOutput!.consumerClosed;
    assert.equal(writable.ownedOutput!.consumerClosed, signal);
    assert.equal(controllers, 1);
    await iterator.return!();
    assert.equal(signal.aborted, true);
    assert.equal(controllers, 1);
  } finally {
    await pipe.abort();
    context.mock.restoreAll();
  }
});

for (const reason of [false, 0, "", null, new Error("cancelled write")]) {
  for (const immediate of [false, true]) {
    test(`writeBytes preserves synchronous cancellation ${String(reason)} with ${immediate ? "completed" : "pending"} output`, async () => {
      const controller = new AbortController();
      let rejectWrite!: (reason: unknown) => void;
      const output = immediate
        ? Object.defineProperty(Promise.resolve(), Symbol.for("safe-bash.syncResolved"), { value: true })
        : new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
      const execution = writeBytes({ write() { controller.abort(reason); return output; } }, Uint8Array.of(65), controller.signal);
      // A pending host operation must not hide synchronous cancellation. Its
      // later rejection still has to be observed after the caller has settled.
      try {
        await assert.rejects(execution, error => Object.is(error, reason));
      } finally {
        if (!immediate) rejectWrite(new Error("late write failure"));
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    });
  }
}
