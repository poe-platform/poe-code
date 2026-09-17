import { composeAbortSignals } from "../../contracts/abort.js";
import { finishCleanup } from "../../contracts/cleanup.js";
import { FsError } from "../../contracts/errors.js";
import type { CapabilityQueryOptions, FileDescriptor, FileStat, FileSystem, FsOptions, OpenFileOptions } from "../../contracts/filesystem.js";
import type { ByteSource } from "../../contracts/io.js";
import { validatePath } from "../../contracts/virtual-path.js";
import { openFileDescriptor } from "../descriptor.js";

export interface ObjectFileVersion {
  readonly revision: string;
  readonly stat: FileStat;
  read(position: number, maxBytes: number, options?: FsOptions): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface ObjectFilePublicationOptions extends FsOptions {
  readonly size: number;
  readonly mode: number;
}

export interface ObjectFileAcquireOptions extends FsOptions {
  readonly access: OpenFileOptions["access"];
}

export interface ObjectFilePublicationStore {
  acquire(path: string, options: ObjectFileAcquireOptions): Promise<ObjectFileVersion | undefined>;
  publish?(path: string, expectedRevision: string | null, source: ByteSource, options: ObjectFilePublicationOptions): Promise<ObjectFileVersion>;
}

export interface ObjectFileDescriptorOptions {
  readonly chunkBytes?: number;
  readonly maxStagedBytes?: number;
  readonly maxStagedPages?: number;
  readonly maxFileBytes?: number;
  readonly maxOpenFiles?: number;
}

interface ObjectFileState {
  head: ObjectFileVersion | undefined;
  position: number;
  size: number;
  inheritedSize: number;
  modifiedAt: number;
  dirty: boolean;
  pages: Map<number, Uint8Array>;
  failure: { reason: unknown } | undefined;
}

export function withObjectFileDescriptors(filesystem: FileSystem, store: ObjectFilePublicationStore,
  options: ObjectFileDescriptorOptions = {}): FileSystem {
  const chunkBytes = options.chunkBytes ?? 65536;
  const maxStagedBytes = options.maxStagedBytes ?? 8 * 1024 * 1024;
  const maxStagedPages = options.maxStagedPages ?? 4096;
  const maxFileBytes = options.maxFileBytes ?? 256 * 1024 * 1024;
  const maxOpenFiles = options.maxOpenFiles ?? 64;
  if (![chunkBytes, maxStagedBytes, maxStagedPages, maxFileBytes, maxOpenFiles].every(value => Number.isSafeInteger(value) && value > 0)
    || chunkBytes > 1048576 || typeof store.acquire !== "function"
    || store.publish !== undefined && typeof store.publish !== "function") throw new TypeError("Invalid object descriptor configuration");
  let stagedBytes = 0;
  let openFiles = 0;

  const version = (value: ObjectFileVersion): ObjectFileVersion => {
    if (!value || typeof value.revision !== "string" || value.revision.length === 0 || value.revision.length > 4096
      || !value.stat || value.stat.type !== "file" || !Number.isSafeInteger(value.stat.size) || value.stat.size < 0
      || !Number.isSafeInteger(value.stat.mode) || value.stat.mode < 0 || value.stat.mode > 0o177777
      || ![value.stat.mtimeMs, value.stat.atimeMs, value.stat.ctimeMs].every(Number.isFinite)
      || typeof value.read !== "function" || typeof value.close !== "function") throw new FsError("EIO", { message: "Invalid immutable object version" });
    if (value.stat.size > maxFileBytes) throw new FsError("EFBIG", { message: "Object descriptor file limit exceeded" });
    return Object.freeze({ revision: value.revision, stat: Object.freeze({ ...value.stat }), read: value.read.bind(value), close: value.close.bind(value) });
  };
  const clearPages = (state: ObjectFileState): void => {
    stagedBytes -= state.pages.size * chunkBytes;
    state.pages.clear();
  };
  const open = (path: string, openOptions: OpenFileOptions): Promise<FileDescriptor> => openFileDescriptor<ObjectFileState>(path, openOptions, {
    publication: "conditional", position: true, positionedRead: true, positionedWrite: true,
    truncate: true, synchronization: "storage",
  }, async admitted => {
    validatePath(path);
    if (path.length === 0) throw new FsError("ENOENT", { path });
    if (openFiles >= maxOpenFiles) throw new FsError("EMFILE", { path });
    openFiles++;
    let acquiring = true;
    const state: ObjectFileState = { head: undefined, position: 0, size: 0, inheritedSize: 0, modifiedAt: Date.now(), dirty: false, pages: new Map(), failure: undefined };
    const check = (forwarded: FsOptions): void => {
      if (acquiring) admitted.signal?.throwIfAborted();
      forwarded.signal?.throwIfAborted();
      if (state.failure) throw state.failure.reason;
    };
    const perform = async <Value>(forwarded: FsOptions, action: (options: FsOptions) => Promise<Value>): Promise<Value> => {
      check(forwarded);
      const scope = composeAbortSignals([...(acquiring && admitted.signal ? [admitted.signal] : []), ...(forwarded.signal ? [forwarded.signal] : [])]);
      try {
        const result = await action({ signal: scope.signal });
        scope.signal.throwIfAborted();
        return result;
      } catch (error) { scope.signal.throwIfAborted(); throw error; }
      finally { scope.dispose(); }
    };
    const readBase = async (position: number, length: number, forwarded: FsOptions): Promise<Uint8Array> => {
      const count = Math.min(length, Math.max(0, state.inheritedSize - position));
      if (count === 0 || !state.head) return new Uint8Array();
      const data = await perform(forwarded, selected => state.head!.read(position, count, selected));
      if (!(data instanceof Uint8Array) || data.byteLength !== count) throw new FsError("EIO", { path, message: "Immutable range read returned an invalid byte count" });
      return Uint8Array.from(data);
    };
    const read = async (buffer: Uint8Array, position: number, forwarded: FsOptions): Promise<number> => {
      check(forwarded);
      const count = Math.min(buffer.byteLength, Math.max(0, state.size - position));
      let copied = 0;
      while (copied < count) {
        const offset = position + copied;
        const page = Math.floor(offset / chunkBytes);
        const within = offset % chunkBytes;
        const length = Math.min(count - copied, chunkBytes - within);
        const staged = state.pages.get(page);
        if (staged) buffer.set(staged.subarray(within, within + length), copied);
        else {
          buffer.fill(0, copied, copied + length);
          buffer.set(await readBase(offset, length, forwarded), copied);
        }
        copied += length;
      }
      return count;
    };
    const flush = async (forwarded: FsOptions): Promise<void> => {
      check(forwarded);
      if (!state.dirty) return;
      if (!store.publish) throw new FsError("ENOTSUP", { path, message: "Object writes require authoritative conditional publication" });
      const expected = state.head?.revision ?? null;
      let emitted = 0;
      let active = true;
      let received: ObjectFileVersion | undefined;
      let source: AsyncGenerator<Uint8Array, void, unknown> | undefined;
      const streamAbort = new AbortController();
      let streamScope: ReturnType<typeof composeAbortSignals> | undefined;
      try {
        await perform(forwarded, async selected => {
          streamScope = composeAbortSignals([...(selected.signal ? [selected.signal] : []), streamAbort.signal]);
          const bodyOptions = { signal: streamScope.signal };
          source = (async function* () {
            for (let position = 0; position < state.size; position += chunkBytes) {
              if (!active) throw new FsError("EBADF", { path });
              const bytes = new Uint8Array(Math.min(chunkBytes, state.size - position));
              await read(bytes, position, bodyOptions);
              emitted += bytes.length;
              yield bytes;
            }
          })();
          received = await store.publish!(path, expected, source, { ...selected, size: state.size, mode: (state.head?.stat.mode ?? admitted.mode) & 0o7777 });
        });
        const published = version(received!);
        if (emitted !== state.size || published.stat.size !== state.size || published.revision === expected) throw new FsError("EIO", { path, message: "Invalid conditional publication acknowledgement" });
        const previous = state.head;
        state.head = published;
        received = undefined;
        state.inheritedSize = state.size;
        state.modifiedAt = published.stat.mtimeMs;
        state.dirty = false;
        clearPages(state);
        await previous?.close();
      } catch (reason) {
        state.failure = { reason };
        if (received) await finishCleanup(() => received!.close(), true);
        throw reason;
      } finally {
        active = false;
        streamAbort.abort(new FsError("ECANCELED", { path, syscall: "object publication stream" }));
        try { await finishCleanup(() => source?.return(undefined), state.failure !== undefined); }
        finally { streamScope?.dispose(); }
      }
    };
    try {
      const capabilities = await filesystem.capabilitiesFor?.(path, admitted) ?? filesystem.capabilities;
      check(admitted);
      const mutating = admitted.access !== "read" || admitted.creation !== "never" || admitted.truncate;
      if (mutating && capabilities.readOnly === true) throw new FsError("EROFS", { path });
      if (mutating && (!store.publish || capabilities.write === false)) throw new FsError("ENOTSUP", { path, message: "Object writes require authoritative conditional publication" });
      if (admitted.access !== "write" && capabilities.read === false) throw new FsError("EACCES", { path });
      const acquired = await store.acquire(path, { access: admitted.access, ...(admitted.signal ? { signal: admitted.signal } : {}) });
      if (acquired) {
        try { state.head = version(acquired); }
        catch (error) { await finishCleanup(() => acquired.close(), true); throw error; }
      }
      check(admitted);
      if (state.head && admitted.creation === "exclusive") throw new FsError("EEXIST", { path });
      if (!state.head && admitted.creation === "never") throw new FsError("ENOENT", { path });
      state.size = state.head?.stat.size ?? 0;
      state.inheritedSize = state.size;
      state.modifiedAt = state.head?.stat.mtimeMs ?? Date.now();
      if (!state.head || admitted.truncate) {
        state.size = 0;
        state.inheritedSize = 0;
        state.dirty = true;
        await flush(admitted);
      }
      acquiring = false;
      return {
        resource: state,
        getPosition: async () => state.position,
        stat: async (_state, forwarded) => {
          check(forwarded);
          const { allocatedBytes: ignoredAllocated, ...metadata } = state.head!.stat;
          return { ...metadata, size: state.size, mtimeMs: state.modifiedAt };
        },
        read: async (_state, buffer, position, forwarded) => {
          const count = await read(buffer, position ?? state.position, forwarded);
          if (position === null) state.position += count;
          return count;
        },
        write: async (_state, buffer, position, forwarded) => {
          check(forwarded);
          const start = admitted.append ? state.size : position ?? state.position;
          const end = start + buffer.byteLength;
          if (!Number.isSafeInteger(end) || end > maxFileBytes) throw new FsError("EFBIG", { path, message: "Object descriptor file limit exceeded" });
          const first = Math.floor(start / chunkBytes);
          const last = Math.floor((end - 1) / chunkBytes);
          const missing: number[] = [];
          const available = Math.min(Math.floor((maxStagedBytes - stagedBytes) / chunkBytes), maxStagedPages - stagedBytes / chunkBytes);
          for (let page = first; page <= last; page++) if (!state.pages.has(page)) {
            if (missing.length >= available) throw new FsError("ENOSPC", { path, message: "Object descriptor staging budget exceeded; flush staged writes or increase maxStagedBytes/maxStagedPages" });
            missing.push(page);
          }
          const additional = missing.length * chunkBytes;
          stagedBytes += additional;
          const prepared = new Map<number, Uint8Array>();
          try {
            for (const page of missing) {
              const bytes = new Uint8Array(chunkBytes);
              bytes.set(await readBase(page * chunkBytes, chunkBytes, forwarded));
              prepared.set(page, bytes);
            }
            check(forwarded);
          } catch (error) { stagedBytes -= additional; throw error; }
          for (const [page, bytes] of prepared) state.pages.set(page, bytes);
          let copied = 0;
          while (copied < buffer.byteLength) {
            const offset = start + copied;
            const length = Math.min(buffer.byteLength - copied, chunkBytes - offset % chunkBytes);
            state.pages.get(Math.floor(offset / chunkBytes))!.set(buffer.subarray(copied, copied + length), offset % chunkBytes);
            copied += length;
          }
          state.size = Math.max(state.size, end);
          state.modifiedAt = Date.now();
          state.dirty = true;
          if (position === null) state.position = end;
          if (admitted.synchronization !== undefined) await flush(forwarded);
          return buffer.byteLength;
        },
        truncate: async (_state, length, forwarded) => {
          check(forwarded);
          if (length > maxFileBytes) throw new FsError("EFBIG", { path });
          for (const [page, bytes] of state.pages) {
            if (page * chunkBytes >= length) { state.pages.delete(page); stagedBytes -= chunkBytes; }
            else if ((page + 1) * chunkBytes > length) bytes.fill(0, length % chunkBytes);
          }
          state.inheritedSize = Math.min(state.inheritedSize, length);
          state.size = length;
          state.modifiedAt = Date.now();
          state.dirty = true;
          if (admitted.synchronization !== undefined) await flush(forwarded);
        },
        sync: async (_state, _dataOnly, forwarded) => { await flush(forwarded); },
        close: async () => {
          let failed = false;
          try { if (state.dirty || state.failure) await flush({}); }
          catch (error) { failed = true; throw error; }
          finally {
            clearPages(state);
            const retained = state.head;
            state.head = undefined;
            try { await finishCleanup(() => retained?.close(), failed); }
            finally { openFiles--; }
          }
        },
      };
    } catch (error) {
      clearPages(state);
      try { await finishCleanup(() => state.head?.close(), true); }
      finally { openFiles--; }
      throw error;
    }
  });
  return new Proxy(Object.create(filesystem) as FileSystem, {
    get(_target, property) {
      if (property === "open") return open;
      if (property === "capabilities") return { ...filesystem.capabilities, open: true, versionedDescriptors: true };
      if (property === "capabilitiesFor") return async (path: string, query?: CapabilityQueryOptions) => {
        const capabilities = await filesystem.capabilitiesFor?.(path, query) ?? filesystem.capabilities;
        query?.signal?.throwIfAborted();
        return { ...capabilities, open: true, versionedDescriptors: true };
      };
      const value: unknown = Reflect.get(filesystem, property, filesystem);
      return typeof value === "function" ? value.bind(filesystem) : value;
    },
  });
}
