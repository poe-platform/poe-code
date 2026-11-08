import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { SsconvertError, type Cleanup, type WorkingStorage } from "./contracts.js";

/** Private virtual pages prevent a codec from addressing another store or the
 * retained input spool. All stores share the session's bounded physical cache. */
export function createWorkingStorage(storage: PagedStorage, check: () => void,
  own: (cleanup: Cleanup) => void): WorkingStorage {
  check();
  let pages: IntegerTable | undefined = new IntegerTable(storage, 128);
  let end = 8, closed = false, closing: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  const admit = () => {
    check();
    if (closed) throw new SsconvertError("invalid-request", "ssconvert working storage is closed");
  };
  const close = () => {
    closed = true;
    return closing ??= pending.then(() => { pages = undefined; });
  };
  own(close);
  const range = (position: number, length: number) => {
    if (!Number.isSafeInteger(position) || position < 8 || !Number.isSafeInteger(length) || length < 0 || length > 16384 || position > end - length)
      throw new SsconvertError("invalid-request", "Invalid ssconvert working storage range");
  };
  const transfer = (position: number, bytes: Uint8Array, write: boolean) => {
    const work = pending.then(async () => {
      admit(); range(position, bytes.length);
      for (let offset = 0; offset < bytes.length;) {
        admit();
        const address = position + offset, page = BigInt(Math.floor(address / 16384));
        let physical = await pages!.get(page);
        const within = address % 16384, length = Math.min(bytes.length - offset, 16384 - within);
        if (write) {
          if (physical === undefined) {
            physical = BigInt(storage.allocate(16384));
            await pages!.set(page, physical);
          }
          await storage.write(Number(physical) + within, bytes.subarray(offset, offset + length));
        } else if (physical !== undefined) bytes.set(await storage.read(Number(physical) + within, length), offset);
        offset += length;
      }
      admit();
    });
    pending = work.then(() => undefined, () => undefined);
    return work;
  };
  return Object.freeze({ close, allocate(length: number) {
    admit();
    if (!Number.isSafeInteger(length) || length < 0 || length > Number.MAX_SAFE_INTEGER - end)
      throw new SsconvertError("resource-limit", "ssconvert working storage size exceeded");
    const position = end; end += length; return position;
  }, async read(position: number, length: number) {
    admit(); range(position, length);
    const bytes = new Uint8Array(length);
    await transfer(position, bytes, false);
    return bytes;
  }, async write(position: number, bytes: Uint8Array) {
    admit(); range(position, bytes.length);
    await transfer(position, bytes, true);
  } });
}
