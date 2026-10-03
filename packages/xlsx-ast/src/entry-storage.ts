import { ZipDirectoryIndex, type ZipSource, type ZipStreamEntry } from "@poe-code/office-package";
import type { WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";

/** Backend failures must not be mistaken for an unrecognized workbook. */
export class PackageIoFailure {
  constructor(readonly cause: unknown) {}
}

/** The XLSX reader consumes only decode metadata; ZIP names, spans and member
 * records live in scratch storage. Compressed payloads stay in the retained input. */
export function createStoredZipEntries(createStorage: () => WorkingStorage, source: ZipSource) {
  let raw: WorkingStorage;
  try { raw = createStorage(); } catch (error) { throw new PackageIoFailure(error); }
  const storage: WorkingStorage = {
    allocate(length) { try { return raw.allocate(length); } catch (error) { throw new PackageIoFailure(error); } },
    async read(position, length) { try { return await raw.read(position, length); } catch (error) { throw new PackageIoFailure(error); } },
    async write(position, bytes) { try { await raw.write(position, bytes); } catch (error) { throw new PackageIoFailure(error); } },
    async close() { try { await raw.close(); } catch (error) { throw new PackageIoFailure(error); } }
  };
  const names = new ZipDirectoryIndex(storage);
  return { storage, close: storage.close,
    async set(entry: ZipStreamEntry) {
      if (entry.dataOffset === undefined) throw new TypeError("Missing retained ZIP member offset");
      const bytes = new Uint8Array(64), view = new DataView(bytes.buffer);
      [entry.dataOffset, entry.compressedSize, entry.size, entry.crc32, entry.mode, entry.method,
        entry.flags ?? -1, entry.modified.getTime()].forEach((value, index) => view.setFloat64(index * 8, value, true));
      const position = storage.allocate(bytes.length);
      await storage.write(position, bytes);
      await names.set(entry.name, position);
    },
    async get(name: string): Promise<ZipStreamEntry | undefined> {
      const position = await names.get(name);
      if (position === undefined) return undefined;
      const bytes = await storage.read(position, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const dataOffset = view.getFloat64(0, true), compressedSize = view.getFloat64(8, true), flags = view.getFloat64(48, true);
      return { name, dataOffset, compressedSize, size: view.getFloat64(16, true), crc32: view.getFloat64(24, true),
        mode: view.getFloat64(32, true), method: view.getFloat64(40, true), ...(flags < 0 ? {} : { flags }),
        modified: new Date(view.getFloat64(56, true)), directory: false, symlink: false,
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
