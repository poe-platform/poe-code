import { ZipDirectoryIndex, type ZipMetadataStorage } from "./zip-index.js";
import type { ZipSource, ZipStreamEntry } from "./zip.js";

export interface ZipEntryStorage extends ZipMetadataStorage {
  close(): Promise<void>;
}

/** Backend failures must not be mistaken for an unrecognized workbook. */
export class ZipStorageFailure {
  constructor(readonly cause: unknown) {}
}

/** Persist member decode metadata and names without retaining a member collection.
 * Compressed payloads stay in the stable input. The source must return owned bytes
 * (or serialize borrowed replies into snapshots). Extras/comments for archive
 * rewriting are outside this decode-only index. The caller owns both capabilities. */
export function createStoredZipEntries(createStorage: () => ZipEntryStorage, source: ZipSource) {
  let raw: ZipEntryStorage;
  try { raw = createStorage(); } catch (error) { throw new ZipStorageFailure(error); }
  const storage: ZipEntryStorage = {
    allocate(length) { try { return raw.allocate(length); } catch (error) { throw new ZipStorageFailure(error); } },
    async read(position, length) { try { return await raw.read(position, length); } catch (error) { throw new ZipStorageFailure(error); } },
    async write(position, bytes) { try { await raw.write(position, bytes); } catch (error) { throw new ZipStorageFailure(error); } },
    async close() { try { await raw.close(); } catch (error) { throw new ZipStorageFailure(error); } }
  };
  const names = new ZipDirectoryIndex(storage);
  return { storage, close: storage.close,
    async set(entry: ZipStreamEntry) {
      if (entry.dataOffset === undefined) throw new TypeError("Missing retained ZIP member offset");
      const bytes = new Uint8Array(80), view = new DataView(bytes.buffer);
      [entry.dataOffset, entry.compressedSize, entry.size, entry.crc32, entry.mode, entry.method,
        entry.flags ?? -1, entry.modified.getTime(), Number(entry.directory), Number(entry.symlink)].forEach((value, index) => view.setFloat64(index * 8, value, true));
      const position = storage.allocate(bytes.length);
      await storage.write(position, bytes);
      await names.set(entry.name, position);
    },
    async get(name: string): Promise<ZipStreamEntry | undefined> {
      const position = await names.get(name);
      if (position === undefined) return undefined;
      const bytes = await storage.read(position, 80), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const dataOffset = view.getFloat64(0, true), compressedSize = view.getFloat64(8, true), flags = view.getFloat64(48, true);
      return { name, dataOffset, compressedSize, size: view.getFloat64(16, true), crc32: view.getFloat64(24, true),
        mode: view.getFloat64(32, true), method: view.getFloat64(40, true), ...(flags < 0 ? {} : { flags }),
        modified: new Date(view.getFloat64(56, true)), directory: view.getFloat64(64, true) !== 0, symlink: view.getFloat64(72, true) !== 0,
        data: async function* (signal) {
          for (let offset = 0; offset < compressedSize;) {
            signal.throwIfAborted();
            const bytes = await source.read(dataOffset + offset, Math.min(16384, compressedSize - offset), { signal });
            signal.throwIfAborted();
            if (!bytes.length || bytes.length > Math.min(16384, compressedSize - offset)) throw new TypeError("Invalid retained ZIP range");
            offset += bytes.length;
            yield bytes;
          }
        }
      };
    }
  };
}
