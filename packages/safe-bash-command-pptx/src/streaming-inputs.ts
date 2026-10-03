import { PagedStorage } from "@poe-code/safe-fs/storage";
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

function sameRetainedIdentity(before: FileStat, after: FileStat): boolean {
  if (before.opaqueIdentity !== undefined || after.opaqueIdentity !== undefined) {
    const scope = before.identityScope;
    return ((typeof scope === "object" && scope !== null) || typeof scope === "symbol")
      && scope === after.identityScope && typeof before.opaqueIdentity === "string"
      && before.opaqueIdentity.length > 0 && before.opaqueIdentity.length <= 4096
      && before.opaqueIdentity === after.opaqueIdentity;
  }
  return compareCopyIdentity(before, after) === "same";
}

export function createPptxInputSession(context: CommandContext, snapshots: Map<string, FileStat>) {
  const { fs, signal } = context;
  const directory = pathOf(context, context.env.TMPDIR || context.cwd);
  const workingStorage = Object.freeze({ fs, directory });
  const storage = new PagedStorage({ fs, cwd: directory, env: {}, signal });
  const sources = new Map<string, PptxRetainedInput>();
  const identities = new Map<string, FileStat>();
  let pending: Promise<unknown> = Promise.resolve();
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { signal.throwIfAborted(); if (closed) throw new FsError("EBADF"); };
  const close = () => {
    closed = true;
    return closing ??= pending.then(() => storage.close());
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
          if (cached) { if (cached.size > maxBytes) throw new FsError("EFBIG"); return cached; }
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
            retained = source(start, size);
          } else {
            const capabilities = await fs.capabilitiesFor?.(resolved, { signal }) ?? fs.capabilities;
            check();
            if (!fs.openReadFile || capabilities.retainedRead !== true) throw new FsError("ENOTSUP");
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
              captured = source(start, observed.size);
            } catch (error) { failure = { error }; }
            try { await handle.close(); } catch (error) { failure ??= { error }; }
            check();
            if (failure) throw failure.error;
            retained = captured!;
            if (!snapshots.has(resolved)) snapshots.set(resolved, entry);
            identities.set(resolved, observed!);
          }
          sources.set(resolved, retained);
          return retained;
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
  return { io, identities, close };
}
