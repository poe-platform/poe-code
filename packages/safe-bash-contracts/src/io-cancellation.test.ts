import assert from "node:assert/strict";
import { test } from "node:test";
import { writeBytes } from "./io.js";

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
