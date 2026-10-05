import { RetainedInputCatalog } from "./retained-input-catalog.js";
import { PagedStorage, PagedStorageCache } from "@poe-code/safe-fs/storage";
import { FsError, writeBytes, type ByteSink, type ByteSource, type CommandContext, type FileStat } from "safe-bash-contracts";
import { compareCopyIdentity } from "safe-bash-contracts/filesystem-identity";
import { pathOf } from "safe-bash-io-engine/internal";
import type { PackageWorkingStorage } from "safe-bash-presentation-engine/retained-package";

export interface PptxRetainedInput {
  readonly size: number;
  /** Returns at most 16 KiB. Sources expire when the invocation completes. */
  read(position: number, maximum: number, options: { readonly signal: AbortSignal }): Promise<Uint8Array>;
  stream(): ByteSource;
}

export interface PptxStreamingIO {
  readonly workingStorage: PackageWorkingStorage;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  /** Captures an immutable invocation-owned snapshot in caller safe-fs storage.
   * Reopening the same path replays that snapshot, including stdin. */
  openInput(path: string, maxBytes: number): Promise<PptxRetainedInput>;
}

export function sameRetainedIdentity(before: FileStat, after: FileStat): boolean {
  if (before.opaqueIdentity !== undefined || after.opaqueIdentity !== undefined) {
    const scope = before.identityScope;
    return ((typeof scope === "object" && scope !== null) || typeof scope === "symbol")
      && scope === after.identityScope && typeof before.opaqueIdentity === "string"
      && before.opaqueIdentity.length > 0 && before.opaqueIdentity.length <= 4096
      && before.opaqueIdentity === after.opaqueIdentity;
  }
  return compareCopyIdentity(before, after) === "same";
}

export function createPptxInputSession(context: CommandContext) {
  const { fs, signal } = context;
  const directory = pathOf(context, context.env.TMPDIR || context.cwd);
  const workingStorage = Object.freeze({ fs, directory });
  const cache = new PagedStorageCache(64);
  const storage = new PagedStorage({ fs, cwd: directory, env: {}, signal }, 64, cache);
  const sources = new Map<string, PptxRetainedInput>();
  const metadata = new PagedStorage({ fs, cwd: directory, env: {}, signal }, 64, cache);
  const catalog = new RetainedInputCatalog(metadata, signal);
  const remember = (path: string, value: PptxRetainedInput) => { sources.delete(path); sources.set(path, value); if (sources.size > 128) sources.delete(sources.keys().next().value!); return value; };
  let pending: Promise<unknown> = Promise.resolve();
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { signal.throwIfAborted(); if (closed) throw new FsError("EBADF"); };
  const close = () => {
    closed = true;
    return closing ??= pending.then(async () => { const results = await Promise.allSettled([storage.close(), metadata.close()]); for (const result of results) if (result.status === "rejected") throw result.reason; sources.clear(); });
  };
  context.registerCleanup?.(close);
  function source(start: number, size: number): PptxRetainedInput {
    const retained: PptxRetainedInput = Object.freeze({ size,
      async read(position: number, maximum: number, options: { readonly signal: AbortSignal }) {
        check(); options.signal.throwIfAborted();
        if (!Number.isSafeInteger(position) || position < 0 || position > size || !Number.isSafeInteger(maximum) || maximum < 0) throw new FsError("EINVAL");
        const bytes = await storage.read(start + position, Math.min(maximum, 16384, size - position));
        check(); options.signal.throwIfAborted();
        return bytes;
      },
      async *stream() {
        for (let offset = 0; offset < size;) {
          const bytes = await retained.read(offset, 16384, { signal });
          offset += bytes.length;
          yield bytes;
        }
        check();
      }
    });
    return retained;
  }
  const io: PptxStreamingIO = Object.freeze({ workingStorage,
    stdout: { write: (chunk: Uint8Array) => writeBytes(context.stdout, chunk, signal) },
    stderr: { write: (chunk: Uint8Array) => writeBytes(context.stderr, chunk, signal) },
    openInput(path: string, maxBytes: number): Promise<PptxRetainedInput> {
      const work = pending.then(async () => {
        try {
          check();
          if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new FsError("EINVAL");
          const resolved = path === "-" ? "-" : pathOf(context, path);
          const cached = sources.get(resolved);
          if (cached) { if (cached.size > maxBytes) throw new FsError("EFBIG"); return remember(resolved, cached); }
          const saved = await catalog.get(resolved);
          if (saved) { if (saved.size > maxBytes) throw new FsError("EFBIG"); return remember(resolved, source(saved.start, saved.size)); }
          let sourceStart = 0, entryObservation: FileStat | undefined, retainedIdentity: FileStat | undefined;
          let retained: PptxRetainedInput;
          if (path === "-") {
            const start = storage.allocate(0);
            let size = 0;
            for await (const chunk of context.stdin) {
              check();
              if (!(chunk instanceof Uint8Array)) throw new FsError("EIO");
              if (chunk.length > maxBytes - size || !Number.isSafeInteger(size + chunk.length)) throw new FsError("EFBIG");
              for (let offset = 0; offset < chunk.length; offset += 16384) {
                check();
                const bytes = new Uint8Array(chunk.subarray(offset, offset + 16384));
                await storage.append(bytes);
                size += bytes.length;
              }
            }
            check();
            sourceStart = start; retained = source(start, size);
          } else {
            const capabilities = await fs.capabilitiesFor?.(resolved, { signal }) ?? fs.capabilities;
            check();
            if (!fs.openReadFile || capabilities.retainedRead !== true) {
              // Preserve stream-only and buffered convenience backends. A real
              // stream is copied straight into caller pages, never collected.
              let entry: FileStat | undefined;
              try { entry = await fs.lstat(resolved, { signal }); } catch { check(); }
              const start = storage.allocate(0); let size = 0, streamed = false;
              const consume = async (chunks: ByteSource) => {
                for await (const chunk of chunks) {
                  check(); if (!(chunk instanceof Uint8Array)) throw new FsError("EIO");
                  if (chunk.length > maxBytes - size || !Number.isSafeInteger(size + chunk.length)) throw new FsError("EFBIG");
                  for (let offset = 0; offset < chunk.length; offset += 16384) {
                    check(); const owned = new Uint8Array(chunk.subarray(offset, offset + 16384));
                    await storage.append(owned); size += owned.length;
                  }
                }
                check();
              };
              if (fs.readStream && capabilities.streamingRead !== false) {
                try { await consume(fs.readStream(resolved, { signal, chunkSize: 16384 })); streamed = true; }
                catch (error) { check(); if (size || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error; }
              }
              if (!streamed) {
                if (capabilities.read === false) throw new FsError("ENOTSUP");
                const bytes = await fs.readFile(resolved, { maxBytes, signal }); check();
                await consume((async function* () { yield bytes; })());
              }
              if (entry) {
                const after = await fs.lstat(resolved, { signal }); check();
                if (sameRetainedIdentity(entry, entry) && (!sameRetainedIdentity(entry, after) || entry.revision !== after.revision
                  || entry.opaqueVersion !== after.opaqueVersion || entry.size !== after.size || entry.mode !== after.mode
                  || entry.nlink !== after.nlink || entry.mtimeMs !== after.mtimeMs || entry.ctimeMs !== after.ctimeMs)) throw new FsError("EAGAIN");
                entryObservation = entry;
              }
              sourceStart = start; retained = source(start, size);
            } else {
              const entry = await fs.lstat(resolved, { signal });
              check();
              const handle = await fs.openReadFile(resolved, { signal });
              let failure: { error: unknown } | undefined;
              let observed: FileStat | undefined;
              let captured: PptxRetainedInput | undefined;
              try {
                check(); observed = await handle.stat({ signal }); check();
                if (observed.type !== "file" || !Number.isSafeInteger(observed.size) || observed.size < 0) throw new FsError("EINVAL");
                if ((observed.revision === undefined && (typeof observed.opaqueVersion !== "string" || !observed.opaqueVersion.length)) || !sameRetainedIdentity(observed, observed)) throw new FsError("ENOTSUP");
                if (observed.size > maxBytes) throw new FsError("EFBIG");
                const start = storage.allocate(observed.size);
                for (let offset = 0; offset < observed.size;) {
                  check();
                  const maximum = Math.min(16384, observed.size - offset);
                  const chunk = await handle.read(offset, maximum, { signal });
                  check();
                  if (!(chunk instanceof Uint8Array) || chunk.length > maximum) throw new FsError("EIO");
                  if (!chunk.length) throw new FsError("EAGAIN");
                  await storage.write(start + offset, new Uint8Array(chunk));
                  offset += chunk.length;
                }
                const extra = await handle.read(observed.size, 1, { signal });
                check();
                if (!(extra instanceof Uint8Array)) throw new FsError("EIO");
                if (extra.length) throw new FsError("EAGAIN");
                const after = await handle.stat({ signal });
                check();
                if (!sameRetainedIdentity(observed, after) || observed.revision !== after.revision
                  || observed.opaqueVersion !== after.opaqueVersion
                  || observed.size !== after.size || observed.mode !== after.mode || observed.nlink !== after.nlink
                  || observed.mtimeMs !== after.mtimeMs || observed.ctimeMs !== after.ctimeMs) throw new FsError("EAGAIN");
                sourceStart = start; captured = source(start, observed.size);
              } catch (error) { failure = { error }; }
              try { await handle.close(); } catch (error) { failure ??= { error }; }
              check();
              if (failure) throw failure.error;
              retained = captured!;
              entryObservation = entry;
              retainedIdentity = observed!;
            }
          }
          await catalog.put(resolved, { start: sourceStart, size: retained.size, ...(entryObservation ? { entry: entryObservation } : {}), ...(retainedIdentity ? { identity: retainedIdentity } : {}) });
          return remember(resolved, retained);
        } catch (error) {
          signal.throwIfAborted();
          throw Object.assign(new Error("Input could not be read."), { code: error instanceof FsError && error.code === "EFBIG" ? "resource-limit"
            : error instanceof FsError && error.code === "EAGAIN" ? "stale-input" : "io-failure" });
        }
      });
      pending = work.then(() => undefined, () => undefined);
      return work;
    }
  });
  return { io, close,
    async snapshot(path: string, peer: FileStat) { check(); return (await catalog.get(path, peer))?.entry; },
    async *observations(peer: FileStat) { check(); for await (const [path, record] of catalog.entries(peer)) { check(); if (record.entry) yield { path, entry: record.entry, identity: record.identity }; } check(); }
  };
}
