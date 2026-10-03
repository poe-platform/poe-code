import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type { PdfIndexStorage } from "./cos/object-index.js";
import { PdfError } from "./errors.js";

/** Shared admission for PDF scratch files on caller storage. Pass the same
 * instance to all owners in an operation. Pending writes count as live bytes;
 * uncertain creation/write/removal failures retain their reservations until
 * successful retained cleanup. This does not account for resident memory. */
export class PdfStagingStorage implements PdfIndexStorage {
  readonly fs: FileSystem;
  readonly directory: string;
  private live = 0;
  get liveBytes(): number { return this.live; }

  constructor(storage: PdfIndexStorage, readonly maxBytes = Infinity) {
    if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new RangeError("Invalid PDF staging byte limit");
    this.directory = storage.directory;
    const create = storage.fs.createStagedFile?.bind(storage.fs);
    const createStagedFile: FileSystem["createStagedFile"] = create ? async (...args) => {
      const content = args[2], options = args[3];
      if (content.type !== "file" || !options.retainCleanup) throw new PdfError("E_CAPABILITY", "PDF scratch admission requires retained regular-file cleanup");
      let reserved = 0, closing = false;
      const admit = (bytes: number) => {
        if (closing) throw new PdfError("E_CAPABILITY", "PDF staging is closing");
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Math.min(this.maxBytes, Number.MAX_SAFE_INTEGER) - this.live)
          throw new PdfError("E_LIMIT", "PDF aggregate staging byte limit exceeded");
        this.live += bytes; reserved += bytes;
      };
      admit(content.data.length);
      // A failed create can have reached an external backend. Without a cleanup
      // receipt its reservation cannot safely be refunded by this owner.
      const staging = await create(...args);
      const cleanup = staging.cleanup;
      if (!cleanup) throw new PdfError("E_CAPABILITY", "PDF staging backend omitted retained cleanup");
      let removal: Promise<void> | undefined;
      return { ...staging,
        ...(staging.writer ? { writer: {
          async write(bytes, io) { admit(bytes.length); await staging.writer!.write(bytes, io); },
          finish: io => staging.writer!.finish(io),
        } } : {}),
        cleanup: {
          remove: io => {
            closing = true;
            removal ??= (async () => { await cleanup.remove(io); this.live -= reserved; reserved = 0; })();
            return removal;
          },
          async close() { closing = true; await cleanup.close(); },
        },
      };
    } : undefined;
    this.fs = new Proxy(Object.create(storage.fs) as FileSystem, { get(_target, property) {
      if (property === "createStagedFile") return createStagedFile;
      const value = Reflect.get(storage.fs, property, storage.fs);
      return typeof value === "function" ? value.bind(storage.fs) : value;
    } });
  }
}
