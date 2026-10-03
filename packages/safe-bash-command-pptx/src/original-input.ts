import { FsError, type FileSystem } from "@poe-code/safe-fs/core";

/** Compare incrementally; metadata checks and conditional publication remain
 * the caller's responsibility. Buffered-only backends retain their old path. */
export async function verifyOriginalInput(
  fs: FileSystem,
  path: string,
  original: Uint8Array,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
  signal.throwIfAborted();
  let offset = 0;
  const compare = (chunk: Uint8Array): void => {
    signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) throw new FsError("EIO");
    if (chunk.length > original.length - offset) throw new FsError("EAGAIN");
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== original[offset + index]) throw new FsError("EAGAIN");
    }
    offset += chunk.length;
  };
  if (fs.openReadFile && capabilities.retainedRead === true) {
    const handle = await fs.openReadFile(path, { signal });
    let failure: { error: unknown } | undefined;
    try {
      for (;;) {
        signal.throwIfAborted();
        const maximum = Math.min(65536, original.length - offset + 1);
        const chunk = await handle.read(offset, maximum, { signal });
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || chunk.length > maximum) throw new FsError("EIO");
        if (!chunk.length) break;
        compare(chunk);
      }
      if (offset !== original.length) throw new FsError("EAGAIN");
    } catch (error) {
      failure = { error };
    }
    try { await handle.close(); }
    catch (error) { failure ??= { error }; }
    signal.throwIfAborted();
    if (failure) throw failure.error;
    return;
  }
  if (fs.readStream && capabilities.streamingRead !== false) {
    try {
      for await (const chunk of fs.readStream(path, { signal, chunkSize: 65536 })) compare(chunk);
      signal.throwIfAborted();
      if (offset !== original.length) throw new FsError("EAGAIN");
      return;
    } catch (error) {
      signal.throwIfAborted();
      if (offset || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
    }
  }
  compare(await fs.readFile(path, { maxBytes: original.length, signal }));
  if (offset !== original.length) throw new FsError("EAGAIN");
}
