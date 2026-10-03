import { SsconvertError, type RangeSource, type Cleanup } from "./contracts.js";

/** Serialize borrowed backend responses and own each bounded range before the
 * next request can reuse its buffer. Capturing size also prevents moving EOF. */
export function ownedRangeSource(source: RangeSource, signal: AbortSignal, check: () => void, own: (cleanup: Cleanup) => void): RangeSource {
  const size = source.size;
  if (!Number.isSafeInteger(size) || size < 0) throw new SsconvertError("io", "Invalid ssconvert source size");
  const read = source.read.bind(source);
  let pending: Promise<unknown> = Promise.resolve();
  own(async () => { await pending; });
  return Object.freeze<RangeSource>({
    size,
    read(position, maxBytes, options = {}) {
      const operationSignal = options.signal && options.signal !== signal ? AbortSignal.any([signal, options.signal]) : signal;
      const reading = pending.then(async () => {
        check(); operationSignal.throwIfAborted();
        if (!Number.isSafeInteger(position) || position < 0 || position > size || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
          throw new SsconvertError("invalid-request", "Invalid ssconvert source range");
        const maximum = Math.min(16384, maxBytes, size - position);
        if (!maximum) return new Uint8Array();
        const bytes = await read(position, maximum, { signal: operationSignal });
        check(); operationSignal.throwIfAborted();
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maximum)
          throw new SsconvertError("io", "Invalid or truncated ssconvert source range");
        return bytes.slice();
      });
      pending = reading.then(() => undefined, () => undefined);
      return reading;
    }
  });
}

/** Compatibility only for legacy codecs that explicitly require a byte array. */
export async function bufferRangeInput(source: RangeSource, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const bytes = new Uint8Array(source.size);
  for (let offset = 0; offset < bytes.length;) {
    signal.throwIfAborted();
    const chunk = await source.read(offset, Math.min(16384, bytes.length - offset), { signal });
    signal.throwIfAborted();
    if (!chunk.length || chunk.length > bytes.length - offset) throw new SsconvertError("io", "Truncated ssconvert source range");
    bytes.set(chunk, offset); offset += chunk.length;
  }
  return bytes;
}
