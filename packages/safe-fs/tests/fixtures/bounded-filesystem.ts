import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import type { FileSystem, FileStat } from "../../src/contracts/filesystem.js";
import { wrapped } from "../migration/fs/overlay/helpers.js";

/** Metadata-only storage simulator: generated 7-prefix/zero-tail, no RAM payload spool. */
export function boundedFileSystem() {
  const metadata = new MemoryFileSystem();
  const files = new Map<string, { size: number; nonzero: number }>();
  const metrics = { maxRead: 0, maxWrite: 0, openHandles: 0, reads: 0, writes: 0, payloadStored: 0 };
  let failWrite: (() => void) | undefined;
  const stat = (path: string, value: FileStat): FileStat => ({ ...value, size: files.get(path)?.size ?? value.size });
  const fs: FileSystem = wrapped(metadata, {
    readFile: () => { throw new Error("whole-file read"); },
    writeFile: () => { throw new Error("whole-file write"); },
    readStream: undefined, truncate: undefined,
    stat: async path => stat(path, await metadata.stat(path)),
    lstat: async path => stat(path, await metadata.lstat(path)),
    openReadFile: async path => {
      const retained = { ...files.get(path)! };
      const snapshot = stat(path, await metadata.stat(path));
      metrics.openHandles++;
      let closed = false;
      return {
        stat: async () => snapshot,
        read: async (position, maxBytes) => {
          if (closed) throw new Error("closed handle");
          metrics.reads++;
          metrics.maxRead = Math.max(metrics.maxRead, maxBytes);
          const chunk = new Uint8Array(Math.max(0, Math.min(maxBytes, retained.size - position)));
          chunk.fill(7, 0, Math.max(0, Math.min(chunk.length, retained.nonzero - position)));
          return chunk;
        },
        close: async () => { if (!closed) { closed = true; metrics.openHandles--; } },
      };
    },
    writeStream: async (path, source, options) => {
      await metadata.writeFile(path, new Uint8Array(), options);
      const record = options?.flag === "a" ? files.get(path)! : { size: 0, nonzero: 0 };
      files.set(path, record);
      for await (const chunk of source) {
        await Promise.resolve();
        failWrite?.();
        metrics.writes++;
        metrics.maxWrite = Math.max(metrics.maxWrite, chunk.byteLength);
        for (const byte of chunk) {
          if (byte !== 0 && byte !== 7) throw new Error("unexpected byte");
          if (byte === 7 && record.size !== record.nonzero) throw new Error("nonzero after zero tail");
          if (byte === 7) record.nonzero++;
          record.size++;
        }
      }
    },
    rename: async (source, destination, options) => {
      await metadata.rename(source, destination, options);
      const record = files.get(source);
      if (record) { files.set(destination, record); files.delete(source); }
    },
    rm: async (path, options) => {
      await metadata.rm(path, options);
      for (const key of files.keys()) if (key === path || key.startsWith(`${path}/`)) files.delete(key);
    },
  });
  return { fs, metrics, files, injectWrite: (callback: () => void) => { failWrite = callback; },
    seed: async (path: string, size: number) => {
      await metadata.writeFile(path, new Uint8Array());
      files.set(path, { size, nonzero: size });
    },
  };
}
