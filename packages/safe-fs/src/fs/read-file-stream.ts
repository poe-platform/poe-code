import type { FileSystem, ReadStreamOptions } from "../contracts/filesystem.js";
import type { ByteSource } from "../contracts/io.js";
import { FsError } from "../contracts/errors.js";
import { finishCleanup } from "../contracts/cleanup.js";
import { openRetainedReadFile } from "./capabilities.js";

const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
const byteKind = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;

/** Sequential payload access without a whole-file fallback. The injected backend
 * must supply streaming reads or retained range reads; no private storage is used.
 * Chunks are borrowed until the consumer advances the iterator. */
export function readFileStream(
  fs: FileSystem, path: string, options: ReadStreamOptions & { readonly skipStream?: boolean } = {},
): AsyncGenerator<Uint8Array> {
  let activeCleanup: (() => Promise<unknown>) | undefined;
  const generator = (async function* (): AsyncGenerator<Uint8Array> {
    const { signal } = options;
    signal?.throwIfAborted();
    const chunkSize = options.chunkSize ?? 65536;
    let position = options.start ?? 0;
    const end = options.endExclusive ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || !Number.isSafeInteger(position) || position < 0
      || !Number.isSafeInteger(end) || end < position) throw new FsError("EINVAL", { path, syscall: "readStream" });
    const capabilities = await fs.capabilitiesFor?.(path, options) ?? fs.capabilities;
    signal?.throwIfAborted();
    if (!options.skipStream && fs.readStream && fs.capabilities?.streamingRead !== false && capabilities?.streamingRead !== false) {
      let emitted = false;
      let reading = true;
      try {
        const source: ByteSource = fs.readStream(path, { ...options, chunkSize });
        const iterator = source[Symbol.asyncIterator]();
        let done = false, failed = true;
        let returned: Promise<unknown> | undefined;
        const closeIterator = () => returned ??= Promise.resolve().then(() => iterator.return?.());
        activeCleanup = () => done ? Promise.resolve() : closeIterator();
        try {
          while (true) {
            signal?.throwIfAborted();
            const item = await iterator.next();
            signal?.throwIfAborted();
            if (item.done) { done = true; break; }
            reading = false;
            if (byteLength.call(item.value)) emitted = true;
            yield item.value;
            reading = true;
          }
          failed = false;
        } finally {
          activeCleanup = undefined;
          if (!done) await finishCleanup(closeIterator, failed);
        }
        return;
      } catch (error) {
        signal?.throwIfAborted();
        if (!reading || emitted || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
      }
    }
    const handle = await openRetainedReadFile(fs, path, options);
    let failed = true;
    let closed: Promise<unknown> | undefined;
    const closeHandle = () => closed ??= Promise.resolve().then(() => handle.close());
    activeCleanup = closeHandle;
    try {
      while (position < end) {
        signal?.throwIfAborted();
        const maximum = Math.min(chunkSize, end - position);
        const bytes = await handle.read(position, maximum, options);
        signal?.throwIfAborted();
        if (byteKind.call(bytes) !== "Uint8Array" || byteLength.call(bytes) > maximum) throw new FsError("EIO", { path, syscall: "read" });
        const length = byteLength.call(bytes) as number;
        if (!length) break;
        position += length;
        yield bytes;
      }
      failed = false;
    } finally {
      activeCleanup = undefined;
      await finishCleanup(closeHandle, failed);
    }
  })();
  const originalReturn = generator.return.bind(generator);
  generator.return = async (value?: unknown) => {
    let cleanupError: { reason: unknown } | undefined;
    try {
      await activeCleanup?.();
    } catch (reason) {
      cleanupError = { reason };
    }
    const result = await originalReturn(value as never);
    if (cleanupError) throw cleanupError.reason;
    return result;
  };
  return generator;
}
