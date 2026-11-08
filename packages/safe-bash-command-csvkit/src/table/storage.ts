import type { FileSystem, FileStat, FileReadHandle } from "safe-bash-contracts/filesystem";
import { CsvkitBlocked } from "../errors.js";
import type { ByteSource } from "../contracts.js";

export interface ReplayFile {
  write(bytes: Uint8Array): Promise<void>;
  seal(): Promise<void>;
  read(): ByteSource;
  close(): Promise<void>;
}

function verify(actual: FileStat, expected: FileStat): void {
  const identity = expected.opaqueIdentity !== undefined ? expected.opaqueIdentity === actual.opaqueIdentity :
    expected.dev !== undefined && expected.ino !== undefined && expected.dev === actual.dev && expected.ino === actual.ino;
  if (!identity || expected.identityScope === undefined || expected.identityScope !== actual.identityScope || actual.type !== "file" ||
    actual.size !== expected.size || actual.revision !== expected.revision || actual.opaqueVersion !== expected.opaqueVersion ||
    actual.mtimeMs !== expected.mtimeMs || actual.ctimeMs !== expected.ctimeMs) throw new CsvkitBlocked("replay storage changed");
}

/** No host temporary files or private RAM volume: storage belongs to the caller. */
async function createRetainedReplayFile(fs: FileSystem, directory: string, signal: AbortSignal): Promise<ReplayFile> {
  signal.throwIfAborted();
  const capabilities = await fs.capabilitiesFor?.(directory, { signal }) ?? fs.capabilities;
  if (!capabilities.retainedStagingCleanup || !capabilities.retainedStagingWrite || !capabilities.retainedRead || !fs.createStagedFile || !fs.openReadFile)
    throw new CsvkitBlocked("replay requires caller filesystem retained staging and reads");
  const parent = await fs.stat(directory, { signal });
  signal.throwIfAborted();
  if (parent.type !== "directory") throw new CsvkitBlocked("replay storage directory");
  const staging = await fs.createStagedFile(`${directory.endsWith("/") ? directory : directory + "/"}.csvkit-${crypto.randomUUID()}`, "rows", { type: "file", data: new Uint8Array(0) }, { parent, mode: 0o600, retainCleanup: true, signal });
  const cleanup = staging.cleanup;
  const writer = staging.writer;
  if (!cleanup || !writer) {
    try { await cleanup?.remove(); } finally { await cleanup?.close(); }
    throw new CsvkitBlocked("replay backend omitted retained handles");
  }
  let size = 0;
  let expected: FileStat | undefined;
  let sealing: Promise<void> | undefined;
  let reader: FileReadHandle | undefined;
  let closing: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new CsvkitBlocked("replay storage closed"));
    const result = pending.then(async () => { signal.throwIfAborted(); return work(); });
    pending = result.catch(() => {});
    return result;
  };
  return {
    write(bytes) {
      if (sealing) return Promise.reject(new CsvkitBlocked("replay storage sealed"));
      return serialize(async () => {
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          signal.throwIfAborted();
          const owned = new Uint8Array(bytes.subarray(offset, offset + 16384));
          await writer.write(owned, { signal });
          size += owned.length;
          if (!Number.isSafeInteger(size)) throw new CsvkitBlocked("replay size overflow");
        }
      });
    },
    seal() {
      return sealing ??= serialize(async () => {
        expected = await writer.finish({ signal });
        signal.throwIfAborted();
        if (expected.size !== size) throw new CsvkitBlocked("replay size mismatch");
        reader = await fs.openReadFile!(staging.file.path, { signal });
        signal.throwIfAborted();
        verify(await reader.stat({ signal }), expected);
      });
    },
    async *read() {
      if (!expected || !reader) throw new CsvkitBlocked("replay storage not sealed");
      for (let position = 0; position < size;) {
        const bytes = await serialize(async () => {
          verify(await reader!.stat({ signal }), expected!);
          const count = Math.min(16384, size - position);
          const bytes = await reader!.read(position, count, { signal });
          signal.throwIfAborted();
          if (!bytes.length || bytes.length > count) throw new CsvkitBlocked("invalid replay range");
          const owned = new Uint8Array(bytes);
          verify(await reader!.stat({ signal }), expected!);
          return owned;
        });
        position += bytes.length;
        yield bytes;
      }
    },
    close() {
      return closing ??= (async () => {
        await pending;
        const failures: unknown[] = [];
        try { await reader?.close(); } catch (error) { failures.push(error); }
        try { await cleanup.remove(); } catch (error) { failures.push(error); }
        try { await cleanup.close(); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, "replay cleanup failed");
      })();
    }
  };
}

/** A fixed 64 KiB cache avoids filesystem acquisition for tiny tables. It never
 * grows into a RAM spool: overflow migrates to the caller's retained backend. */
export async function createReplayFile(fs: FileSystem, directory: string, signal: AbortSignal): Promise<ReplayFile> {
  const pages: Uint8Array[] = [];
  let size = 0, sealed = false, closed = false;
  let backing: ReplayFile | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new CsvkitBlocked("replay storage closed"));
    const result = pending.then(async () => { signal.throwIfAborted(); return work(); });
    pending = result.catch(() => {});
    return result;
  };
  return {
    write(bytes) {
      return serialize(async () => {
        if (sealed) throw new CsvkitBlocked("replay storage sealed");
        if (!backing && size + bytes.length > 65536) {
          backing = await createRetainedReplayFile(fs, directory, signal);
          for (let index = 0; index < pages.length; index++) await backing.write(pages[index]!.subarray(0, Math.min(16384, size - index * 16384)));
          pages.length = 0;
        }
        if (backing) { await backing.write(bytes); return; }
        let offset = 0;
        while (offset < bytes.length) {
          const index = Math.floor(size / 16384), position = size % 16384;
          pages[index] ??= new Uint8Array(16384);
          const count = Math.min(16384 - position, bytes.length - offset);
          pages[index]!.set(bytes.subarray(offset, offset + count), position);
          size += count; offset += count;
        }
      });
    },
    seal() { return serialize(async () => { await backing?.seal(); sealed = true; }); },
    async *read() {
      signal.throwIfAborted();
      if (closed || !sealed) throw new CsvkitBlocked("replay storage not readable");
      if (backing) { yield* backing.read(); return; }
      for (let index = 0; index < pages.length; index++) {
        signal.throwIfAborted();
        if (closed) throw new CsvkitBlocked("replay storage closed");
        yield new Uint8Array(pages[index]!.subarray(0, Math.min(16384, size - index * 16384)));
      }
    },
    close() {
      closed = true;
      return closing ??= (async () => { await pending; pages.length = 0; await backing?.close(); })();
    }
  };
}
