import assert from "node:assert/strict";
import { test } from "node:test";
import { createBytePipe } from "./io.js";

for (const ending of ["sync-eof", "async-eof", "return", "sync-return", "pending-eof", "pending-abort", "endpoint-close", "failed-next", "failed-sync-next"] as const) {
  test(`pipe releases last synchronous chunk on ${ending}`, async () => {
    const pipe = createBytePipe();
    const endpoint = pipe.endpoints!.read;
    const reader = endpoint.readable[Symbol.asyncIterator]() as AsyncIterableIterator<Uint8Array> & {
      tryNextSync(): IteratorResult<Uint8Array> | undefined;
      syncReturn(): void;
      _syncResult?: unknown;
    };
    try {
      await pipe.writable.write(Uint8Array.of(42));
      const result = reader.tryNextSync();
      assert.deepEqual(result, { done: false, value: Uint8Array.of(42) });
      if (ending === "sync-eof" || ending === "async-eof") {
        await pipe.close();
        assert.equal((ending === "sync-eof" ? reader.tryNextSync() : await reader.next())?.done, true);
      } else if (ending === "return") await reader.return!();
      else if (ending === "sync-return") reader.syncReturn();
      else if (ending === "failed-next" || ending === "failed-sync-next") {
        await pipe.abort(new Error("cancelled"));
        if (ending === "failed-sync-next") assert.throws(() => reader.tryNextSync());
        else await assert.rejects(reader.next());
      } else {
        const pending = reader.next();
        if (ending === "pending-eof") { await pipe.close(); assert.equal((await pending).done, true); }
        else {
          const rejected = assert.rejects(pending);
          if (ending === "pending-abort") await pipe.abort(new Error("cancelled"));
          else await endpoint.close();
          await rejected;
        }
      }
      assert.equal(reader._syncResult, undefined);
      assert.deepEqual(result, { done: false, value: Uint8Array.of(42) });
    } finally { await pipe.abort(); }
  });
}
