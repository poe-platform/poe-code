import type { FileSystem, ReadStreamOptions } from "@poe-code/safe-fs/contracts";

/** Expose existing in-memory test data through the command's streaming contract. */
export function streamingFixture<T extends Pick<FileSystem, "readFile"> & Partial<FileSystem>>(filesystem: T) {
  return {
    ...filesystem,
    async *readStream(path: string, options: ReadStreamOptions = {}) {
      options.signal?.throwIfAborted();
      const bytes = await filesystem.readFile(path, options);
      options.signal?.throwIfAborted();
      const chunkSize = Math.min(65536, options.chunkSize ?? 65536);
      if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new RangeError("Invalid fixture chunk size");
      const end = Math.min(bytes.length, options.endExclusive ?? bytes.length);
      for (let offset = options.start ?? 0; offset < end; offset += chunkSize) {
        options.signal?.throwIfAborted();
        yield new Uint8Array(bytes.subarray(offset, Math.min(end, offset + chunkSize)));
      }
    }
  };
}
