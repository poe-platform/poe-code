import type { PptxRetainedInput } from "./streaming-inputs.js";
import { FsError, type FileSystem } from "@poe-code/safe-fs/core";

/** Compare incrementally; metadata checks and conditional publication remain
 * the caller's responsibility. Buffered-only backends retain their old path. */
export async function verifyOriginalInput(
  fs: FileSystem,
  path: string,
  original: Uint8Array | Pick<PptxRetainedInput, "size" | "read">,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
  signal.throwIfAborted();
  const length = original instanceof Uint8Array ? original.length : original.size;
  if (!Number.isSafeInteger(length) || length < 0) throw new FsError("EINVAL");
  let offset = 0;
  const compare = async (chunk: Uint8Array): Promise<void> => {
    signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) throw new FsError("EIO");
    if (chunk.length > length - offset) throw new FsError("EAGAIN");
    if (original instanceof Uint8Array) {
      for (let index = 0; index < chunk.length; index++) {
        if (chunk[index] !== original[offset + index]) throw new FsError("EAGAIN");
      }
    } else {
      const owned = new Uint8Array(chunk);
      for (let index = 0; index < owned.length;) {
        const expected = await original.read(offset + index, Math.min(16384, owned.length - index), { signal });
        signal.throwIfAborted();
        if (!(expected instanceof Uint8Array) || !expected.length || expected.length > Math.min(16384, owned.length - index)) throw new FsError("EIO");
        for (let n = 0; n < expected.length; n++) if (owned[index + n] !== expected[n]) throw new FsError("EAGAIN");
        index += expected.length;
      }
    }
    offset += chunk.length;
  };
  if (fs.openReadFile && capabilities.retainedRead === true) {
    const handle = await fs.openReadFile(path, { signal });
    let failure: { error: unknown } | undefined;
    try {
      for (;;) {
        signal.throwIfAborted();
        const maximum = Math.min(65536, length - offset + 1);
        const chunk = await handle.read(offset, maximum, { signal });
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || chunk.length > maximum) throw new FsError("EIO");
        if (!chunk.length) break;
        await compare(chunk);
      }
      if (offset !== length) throw new FsError("EAGAIN");
    } catch (error) {
      failure = { error };
    }
    try { await handle.close(); }
    catch (error) { failure ??= { error }; }
    signal.throwIfAborted();
    if (failure) throw failure.error;
    return;
  }
  if (!(original instanceof Uint8Array)) throw new FsError("ENOTSUP");
  if (fs.readStream && capabilities.streamingRead !== false) {
    try {
      for await (const chunk of fs.readStream(path, { signal, chunkSize: 65536 })) await compare(chunk);
      signal.throwIfAborted();
      if (offset !== length) throw new FsError("EAGAIN");
      return;
    } catch (error) {
      signal.throwIfAborted();
      if (offset || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
    }
  }
  await compare(await fs.readFile(path, { maxBytes: length, signal }));
  if (offset !== length) throw new FsError("EAGAIN");
}
