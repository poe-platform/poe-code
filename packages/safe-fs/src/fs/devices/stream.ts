import type { ByteSource } from "../../contracts/io.js";
import { finishCleanup } from "../../contracts/cleanup.js";
import type { FileReadHandle } from "../../contracts/filesystem.js";

export function deviceReadStream(open: () => Promise<ByteSource>, signal?: AbortSignal): ByteSource {
  return { [Symbol.asyncIterator]() {
    let opened: Promise<AsyncIterator<Uint8Array>> | undefined;
    let closing: Promise<IteratorResult<Uint8Array>> | undefined;
    const iterator = () => opened ??= open().then(source => source[Symbol.asyncIterator]());
    const close = () => closing ??= iterator().then(async source => source.return ? source.return() : { done: true, value: undefined });
    return {
      async next() {
        if (closing) { await closing; return { done: true, value: undefined }; }
        try {
          const source = await iterator();
          signal?.throwIfAborted();
          if (closing) { await closing; return { done: true, value: undefined }; }
          const next = source.next;
          signal?.throwIfAborted();
          if (closing) { await closing; return { done: true, value: undefined }; }
          return await Reflect.apply(next, source, []);
        }
        catch (error) { await finishCleanup(close, true); throw error; }
      },
      return: close,
    };
  } };
}

export async function drainDeviceFile(handle: FileReadHandle, signal?: AbortSignal): Promise<void> {
  let failed = false;
  let position = 0;
  try {
    await drainDeviceInput({ [Symbol.asyncIterator]: () => ({ async next() {
      const value = await handle.read(position, 65536, signal ? { signal } : {});
      if (!(value instanceof Uint8Array) || value.byteLength > 65536) throw new TypeError("Retained reads must return bounded Uint8Array chunks");
      position += value.byteLength;
      if (!Number.isSafeInteger(position)) throw new RangeError("Retained read position exceeds safe integer range");
      return { done: value.byteLength === 0, value };
    } }) }, signal);
  } catch (error) { failed = true; throw error; }
  finally {
    await finishCleanup(async () => {
      try { await handle.close(); }
      catch (error) { signal?.throwIfAborted(); throw error; }
    }, failed);
  }
  signal?.throwIfAborted();
}

function nextChunk(iterator: AsyncIterator<Uint8Array>, signal?: AbortSignal): Promise<IteratorResult<Uint8Array>> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { signal?.removeEventListener("abort", aborted); reject(signal?.reason); };
    signal?.addEventListener("abort", aborted, { once: true });
    try {
      Promise.resolve(iterator.next()).then(result => {
        signal?.removeEventListener("abort", aborted);
        if (signal?.aborted) reject(signal.reason);
        else resolve(result);
      }, error => { signal?.removeEventListener("abort", aborted); reject(signal?.aborted ? signal.reason : error); });
    } catch (error) { signal?.removeEventListener("abort", aborted); reject(signal?.aborted ? signal.reason : error); }
  });
}

export async function drainDeviceInput(source: ByteSource, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const iterator = source[Symbol.asyncIterator]();
  let failed = false;
  let bytes = 0;
  let pulls = 0;
  try {
    for (;;) {
      const result = await nextChunk(iterator, signal);
      signal?.throwIfAborted();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
      bytes += result.value.byteLength;
      if (++pulls >= 64 || bytes >= 65536) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        bytes = 0;
        pulls = 0;
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await finishCleanup(async () => {
      try { await iterator.return?.(); }
      catch (error) { signal?.throwIfAborted(); throw error; }
    }, failed);
  }
  signal?.throwIfAborted();
}
