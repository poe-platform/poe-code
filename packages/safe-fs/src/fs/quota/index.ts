import type { FileDescriptor, FileResizeHandle, FileStat, FileSystem, FsOptions, OpenReadFileOptions, OpenResizeFileOptions } from "../../contracts/filesystem.js";
import { FsError } from "../../contracts/errors.js";
import { finishCleanup } from "../../contracts/cleanup.js";
import type { ByteSource } from "../../contracts/io.js";
import { openRetainedReadFile, openRetainedResizeFile, quotaCapabilities, retainedReadCapabilities, retainedResizeCapabilities } from "../capabilities.js";
import { admitDirectoryEntries } from "../directory-admission.js";
import { forwardFileDescriptor, openFileDescriptor } from "../descriptor.js";

export interface FileSystemQuotaOptions {
  readonly maxBytes: number;
  readonly maxScanEntries?: number;
  readonly maxScanDepth?: number;
}

export class FileSystemQuotaError extends Error {
  readonly code = "ENOSPC";
  constructor(readonly maxBytes: number) {
    super(`Filesystem quota exceeded (${maxBytes} bytes)`);
    this.name = "FileSystemQuotaError";
  }
}

function completeIdentity(stat: FileStat): boolean {
  return (typeof stat.identityScope === "symbol" || typeof stat.identityScope === "object" && stat.identityScope !== null)
    && [stat.dev, stat.ino].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function namespaceMetadata<Value>(metadata: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) return metadata;
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    metadata.then(
      value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
    if (signal.aborted) abort();
  });
}

async function scanUsedBytes(fs: FileSystem, limits: { maxScanEntries: number; maxScanDepth: number }, options?: FsOptions, change?: { path: string; stat: FileStat; delta: number; retained?: boolean }, retained = change?.retained === true): Promise<number> {
  let total = 0;
  let retainedTotal = 0n;
  let shrinkCredited = false;
  let possibleAliases = 0;
  let remaining = limits.maxScanEntries;
  const pending = [{ path: "/", depth: 0 }];
  while (pending.length) {
    options?.signal?.throwIfAborted();
    const directory = pending.pop();
    if (!directory) break;
    const signal = options?.signal;
    const listing = fs.readdir(directory.path, { ...options, ...(signal ? { signal } : {}), maxEntries: remaining });
    const entries = await (retained ? namespaceMetadata(listing, signal) : listing);
    options?.signal?.throwIfAborted();
    const count = entries.length;
    admitDirectoryEntries(count, remaining, directory.path);
    remaining -= count;
    let processed = 0;
    for (const entry of entries) {
      options?.signal?.throwIfAborted();
      if (processed >= count) {
        admitDirectoryEntries(1, remaining, directory.path);
        remaining--;
      }
      processed++;
      const path = `${directory.path === "/" ? "" : directory.path}/${entry.name}`;
      if (entry.type === "directory") {
        const depth = directory.depth + 1;
        if (depth > limits.maxScanDepth) throw new FsError("EFBIG", { syscall: "readdir", path, message: "quota scan depth limit exceeded" });
        pending.push({ path, depth });
      }
      else {
        const metadata = fs.lstat(path, options);
        const stat = await (retained ? namespaceMetadata(metadata, signal) : metadata);
        if (retained) {
          options?.signal?.throwIfAborted();
          if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new FsError("EIO", { syscall: "lstat", path, message: "invalid quota entry size" });
          retainedTotal += BigInt(stat.size);
          if (!change || stat.type !== "file") continue;
          const known = completeIdentity(stat);
          const same = known && change.stat.identityScope === stat.identityScope && change.stat.dev === stat.dev && change.stat.ino === stat.ino;
          const nextBytes = change.stat.size + change.delta;
          if (same) {
            possibleAliases++;
            retainedTotal += BigInt(Math.max(0, nextBytes - stat.size));
            if (!shrinkCredited && change.delta < 0) {
              retainedTotal -= BigInt(Math.max(0, Math.min(stat.size, change.stat.size) - nextBytes));
              shrinkCredited = true;
            }
          } else if (!known) {
            possibleAliases++;
            retainedTotal += BigInt(Math.max(0, change.delta, nextBytes - stat.size));
          }
          continue;
        }
        total += stat.size;
        if (!change || stat.type !== "file") continue;
        const scope = change.stat.identityScope;
        const comparable = [scope, stat.identityScope].every(value => typeof value === "symbol" || typeof value === "object" && value !== null)
          && [change.stat.dev, change.stat.ino, stat.dev, stat.ino].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
        const compare = comparable ? undefined : fs.compareEntry;
        const comparison = comparable
          ? scope === stat.identityScope && change.stat.dev === stat.dev && change.stat.ino === stat.ino ? "same" : "distinct"
          : compare === undefined ? "unknown" : await compare.call(fs, change.path, fs, path, options);
        options?.signal?.throwIfAborted();
        if (comparison !== "same" && comparison !== "distinct" && comparison !== "unknown") throw new FsError("EIO", { syscall: "compareEntry", path: change.path, dest: path, message: "invalid entry comparison" });
        if (comparison === "same") { total += change.delta; possibleAliases++; }
        else if (comparison !== "distinct") { total += Math.max(0, change.delta); possibleAliases++; }
      }
    }
  }
  if (retained) {
    if (change && possibleAliases === 0) retainedTotal += BigInt(Math.max(0, change.delta));
    return Number(retainedTotal);
  }
  if (change && possibleAliases === 0) total += Math.max(0, change.delta);
  return total;
}

async function existingBytes(fs: FileSystem, path: string, options?: FsOptions): Promise<number> {
  try {
    const stat = await fs.stat(path, options);
    return stat.type === "directory" ? 0 : stat.size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

export function withFileSystemQuota(fs: FileSystem, options: FileSystemQuotaOptions): FileSystem {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) throw new RangeError("maxBytes must be a nonnegative safe integer");
  const scanLimits = {
    maxScanEntries: options.maxScanEntries === undefined ? 4096 : options.maxScanEntries,
    maxScanDepth: options.maxScanDepth === undefined ? 64 : options.maxScanDepth,
  };
  for (const [name, value] of Object.entries(scanLimits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
  let queue: Promise<unknown> = Promise.resolve();
  let reservedBytes = 0;
  const usedBytes = async (...args: Parameters<typeof scanUsedBytes>): Promise<number> => await scanUsedBytes(...args) + reservedBytes;
  const mutate = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };
  const resizeBackend = new Proxy(Object.create(fs) as FileSystem, {
    get(_target, property) {
      const original: unknown = Reflect.get(fs, property);
      if (property === "openResizeFile" && typeof original === "function") return async (path: string, resizeOptions: OpenResizeFileOptions) => {
        resizeOptions.signal?.throwIfAborted();
        if (resizeOptions.create) {
          const total = await usedBytes(fs, scanLimits, resizeOptions, undefined, true);
          resizeOptions.signal?.throwIfAborted();
          if (total > options.maxBytes) throw new FileSystemQuotaError(options.maxBytes);
        }
        resizeOptions.signal?.throwIfAborted();
        return Reflect.apply(original as NonNullable<FileSystem["openResizeFile"]>, fs, [path, resizeOptions]);
      };
      return typeof original === "function" ? original.bind(fs) : original;
    },
  });
  const assertDelta = async (path: string, nextBytes: number, fsOptions?: FsOptions): Promise<void> => {
    fsOptions?.signal?.throwIfAborted();
    let current: FileStat | undefined;
    try { current = await fs.stat(path, fsOptions); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const projected = current?.type === "file" && nextBytes > current.size
      ? await usedBytes(fs, scanLimits, fsOptions, { path, stat: current, delta: nextBytes - current.size })
      : await usedBytes(fs, scanLimits, fsOptions) - (current?.type === "directory" ? 0 : current?.size ?? 0) + nextBytes;
    fsOptions?.signal?.throwIfAborted();
    if (projected > options.maxBytes) throw new FileSystemQuotaError(options.maxBytes);
  };
  const mutations: Partial<FileSystem> = {
    open(path, openOptions) {
      return openFileDescriptor<FileDescriptor>(path, openOptions, {
        positionedRead: true, positionedWrite: true, truncate: true, synchronization: "storage",
      }, admitted => mutate(async () => {
        admitted.signal?.throwIfAborted();
        const open = fs.open;
        const capabilities = admitted.creation === "exclusive" ? fs.capabilities : await fs.capabilitiesFor?.(path, admitted) ?? fs.capabilities;
        admitted.signal?.throwIfAborted();
        if (!open || capabilities.open === false) throw new FsError("ENOTSUP", { syscall: "open", path });
        admitted.signal?.throwIfAborted();
        const descriptor = await open.call(fs, path, admitted);
        try {
          admitted.signal?.throwIfAborted();
          const pinned = admitted.access === "read" ? undefined : { ...await descriptor.stat(admitted) };
          const conditional = descriptor.capabilities.publication === "conditional" && pinned !== undefined;
          let publishedSize = pinned?.size ?? 0;
          let reserved = 0;
          const reserve = (size: number): void => {
            const next = Math.max(0, size - publishedSize);
            reservedBytes += next - reserved;
            reserved = next;
          };
          admitted.signal?.throwIfAborted();
          if (pinned && (pinned.type !== "file" || !completeIdentity(pinned))) {
            throw new FsError("ENOTSUP", { syscall: "open", path, message: "quota requires complete retained file identity" });
          }
          if (pinned && (!Number.isSafeInteger(pinned.size) || pinned.size < 0)) {
            throw new FsError("EIO", { syscall: "fstat", path, message: "invalid retained file size" });
          }
          const current = async (operationOptions: FsOptions): Promise<FileStat> => {
            const stat = { ...await descriptor.stat(operationOptions) };
            operationOptions.signal?.throwIfAborted();
            if (!pinned || stat.type !== "file" || !completeIdentity(stat)
              || !conditional && (stat.identityScope !== pinned.identityScope || stat.dev !== pinned.dev || stat.ino !== pinned.ino)
              || !Number.isSafeInteger(stat.size) || stat.size < 0) {
              throw new FsError("EIO", { syscall: "fstat", path, message: "invalid retained quota identity or size" });
            }
            return stat;
          };
          const admitSize = async (stat: FileStat, nextBytes: number, operationOptions: FsOptions): Promise<void> => {
            if (!Number.isSafeInteger(nextBytes) || nextBytes < 0) throw new FsError("EFBIG", { syscall: "write", path });
            const projected = conditional
              ? await usedBytes(fs, scanLimits, operationOptions) - reserved + Math.max(0, nextBytes - publishedSize)
              : await usedBytes(fs, scanLimits, operationOptions, { path, stat, delta: nextBytes - stat.size, retained: true });
            operationOptions.signal?.throwIfAborted();
            if (projected > options.maxBytes) throw new FileSystemQuotaError(options.maxBytes);
            if (conditional) reserve(Math.max(nextBytes, publishedSize + reserved));
          };
          const forwarded = forwardFileDescriptor(descriptor, (syscall, operationOptions, action) => syscall === "close" && !conditional ? action() : mutate(async () => {
            try {
              operationOptions.signal?.throwIfAborted();
              const result = await action();
              if (conditional && (syscall === "fsync" || syscall === "fdatasync")) {
                publishedSize = (await current(operationOptions)).size;
                reserve(publishedSize);
              }
              return result;
            } finally {
              if (syscall === "close") { reservedBytes -= reserved; reserved = 0; }
            }
          }));
          return {
            ...forwarded,
            write: (retained, buffer, position, operationOptions) => mutate(async () => {
              operationOptions.signal?.throwIfAborted();
              if (buffer.byteLength === 0) return retained.write(buffer, position, operationOptions);
              const stat = await current(operationOptions);
              let offset = position;
              if (offset === null) {
                if (admitted.append) offset = stat.size;
                else {
                  if (forwarded.capabilities?.position !== true || !forwarded.getPosition) {
                    throw new FsError("ENOTSUP", { syscall: "getPosition", path });
                  }
                  offset = await retained.getPosition!(operationOptions);
                  operationOptions.signal?.throwIfAborted();
                }
              }
              if (!Number.isSafeInteger(offset) || offset < 0) throw new FsError("EIO", { syscall: "getPosition", path });
              await admitSize(stat, Math.max(stat.size, offset + buffer.byteLength), operationOptions);
              const count = await retained.write(buffer, position, operationOptions);
              if (conditional) {
                const size = (await current(operationOptions)).size;
                if (admitted.synchronization !== undefined) publishedSize = size;
                reserve(size);
              }
              return count;
            }),
            truncate: (retained, length, operationOptions) => mutate(async () => {
              operationOptions.signal?.throwIfAborted();
              await admitSize(await current(operationOptions), length, operationOptions);
              await retained.truncate(length, operationOptions);
              if (conditional) {
                if (admitted.synchronization !== undefined) publishedSize = length;
                reserve(length);
              }
            }),
          };
        } catch (error) {
          await finishCleanup(() => descriptor.close(), true);
          admitted.signal?.throwIfAborted();
          throw error;
        }
      }));
    },
    openResizeFile(path, resizeOptions = {}) {
      return mutate(async () => {
        let retained: FileResizeHandle | undefined;
        try {
          retained = await openRetainedResizeFile(resizeBackend, path, resizeOptions);
          const pinned = { ...await retained.stat(resizeOptions) };
          resizeOptions.signal?.throwIfAborted();
          if (pinned.type !== "file" || !completeIdentity(pinned)) throw new FsError("ENOTSUP", { syscall: "openResizeFile", path, message: "quota requires complete retained file identity" });
          if (!Number.isSafeInteger(pinned.size) || pinned.size < 0) throw new FsError("EIO", { syscall: "stat", path, message: "invalid retained file size" });
          const handle = retained;
          const seekEnd = handle.seekEnd;
          resizeOptions.signal?.throwIfAborted();
          let pending: Promise<unknown> = Promise.resolve();
          let closing: Promise<void> | undefined;
          const admit = <Result>(operation: () => Promise<Result>, operationOptions?: FsOptions): Promise<Result> => {
            if (closing) return Promise.reject(new FsError("EBADF", { path }));
            const result = mutate(async () => {
              operationOptions?.signal?.throwIfAborted();
              const value = await operation();
              operationOptions?.signal?.throwIfAborted();
              return value;
            });
            pending = result.catch(() => undefined);
            return result;
          };
          const current = async (operationOptions?: FsOptions): Promise<FileStat> => {
            const stat = { ...await handle.stat(operationOptions) };
            operationOptions?.signal?.throwIfAborted();
            if (stat.type !== "file" || !completeIdentity(stat) || stat.identityScope !== pinned.identityScope || stat.dev !== pinned.dev || stat.ino !== pinned.ino
              || !Number.isSafeInteger(stat.size) || stat.size < 0) throw new FsError("EIO", { syscall: "stat", path, message: "invalid retained quota identity or size" });
            return stat;
          };
          return {
            stat(operationOptions) { return admit(() => current(operationOptions), operationOptions); },
            ...(typeof seekEnd === "function" ? {
              seekEnd(operationOptions?: FsOptions) {
                return admit(() => Reflect.apply(seekEnd, handle, [operationOptions]), operationOptions);
              },
            } : {}),
            truncate(length, operationOptions) {
              return admit(async () => {
                if (!Number.isSafeInteger(length) || length < 0) throw new FsError("EINVAL", { syscall: "truncate", path });
                const stat = await current(operationOptions);
                const projected = await usedBytes(fs, scanLimits, operationOptions, { path, stat, delta: length - stat.size, retained: true });
                operationOptions?.signal?.throwIfAborted();
                if (projected > options.maxBytes) throw new FileSystemQuotaError(options.maxBytes);
                await handle.truncate(length, operationOptions);
              }, operationOptions);
            },
            close() {
              closing ??= pending.then(() => handle.close());
              return closing;
            },
          };
        } catch (error) {
          if (retained) await finishCleanup(() => retained!.close(), true);
          resizeOptions.signal?.throwIfAborted();
          throw error;
        }
      });
    },
    writeFile(path, data, writeOptions) {
      return mutate(async () => {
        const append = writeOptions?.flag === "a" || writeOptions?.flag === "ax";
        const current = append ? await existingBytes(fs, path, writeOptions) : 0;
        await assertDelta(path, current + data.length, writeOptions);
        await fs.writeFile(path, data, writeOptions);
      });
    },
    appendFile(path, data, appendOptions) {
      return mutate(async () => {
        await assertDelta(path, await existingBytes(fs, path, appendOptions) + data.length, appendOptions);
        await fs.appendFile(path, data, appendOptions);
      });
    },
    async rename(source, destination, renameOptions) {
      if (renameOptions?.noReplace) {
        renameOptions.signal?.throwIfAborted();
        const capabilities = await fs.capabilitiesFor?.(destination, renameOptions) ?? fs.capabilities;
        renameOptions?.signal?.throwIfAborted();
        if (capabilities.atomicRenameNoReplace !== true) throw new FsError("ENOTSUP", { syscall: "rename", path: source, dest: destination });
      }
      await fs.rename(source, destination, renameOptions);
    },
    copyFile(source, destination, copyOptions) {
      return mutate(async () => {
        await assertDelta(destination, (await fs.stat(source, copyOptions)).size, copyOptions);
        await fs.copyFile(source, destination, copyOptions);
      });
    },
    truncate(path, length = 0, truncateOptions) {
      return mutate(async () => {
        await assertDelta(path, length, truncateOptions);
        await fs.truncate!(path, length, truncateOptions);
      });
    },
    link(source, destination, linkOptions) {
      return mutate(async () => {
        await assertDelta(destination, (await fs.lstat(source, linkOptions)).size, linkOptions);
        await fs.link!(source, destination, linkOptions);
      });
    },
    symlink(target, path, linkOptions) {
      return mutate(async () => {
        await assertDelta(path, new TextEncoder().encode(target).length, linkOptions);
        await fs.symlink!(target, path, linkOptions);
      });
    },
    writeStream(path, source, writeOptions) {
      return mutate(async () => {
        const append = writeOptions?.flag === "a" || writeOptions?.flag === "ax";
        if (!append) await fs.writeFile(path, new Uint8Array(), writeOptions);
        for await (const chunk of source as ByteSource) {
          await assertDelta(path, await existingBytes(fs, path, writeOptions) + chunk.length, writeOptions);
          await fs.appendFile(path, chunk, writeOptions);
        }
      });
    },
  };
  // Backend descriptors may be frozen. An independent view lets us adapt
  // capabilities and methods without violating invariants on own properties.
  return new Proxy(Object.create(fs) as FileSystem, {
    get(_target, property) {
      if (property === "removeEntryConditional" || property === "writeFileConditional" || property === "removeFileConditional" || property === "resizeFile" || property === "canonicalizeMissingTarget" || property === "createStagedFile" || property === "publishStagedFile" || property === "removeStagedFile" || property === "prepareDirectory") return undefined;
      if (property === "capabilities") return quotaCapabilities({ ...retainedResizeCapabilities(fs, retainedReadCapabilities(fs)), ...(typeof fs.open === "function" ? {} : { open: false }) });
      if (property === "capabilitiesFor") return async (path: string, fsOptions?: FsOptions) => {
        const capabilities = await fs.capabilitiesFor?.(path, fsOptions) ?? fs.capabilities;
        return quotaCapabilities({ ...retainedResizeCapabilities(fs, retainedReadCapabilities(fs, capabilities)), ...(typeof fs.open === "function" ? {} : { open: false }) });
      };
      if (property === "openReadFile") return (path: string, fsOptions: OpenReadFileOptions = {}) => openRetainedReadFile(fs, path, fsOptions);
      const replacement = Reflect.get(mutations, property) as unknown;
      if (typeof replacement === "function") return replacement;
      const original = Reflect.get(fs, property) as unknown;
      return typeof original === "function" ? original.bind(fs) : original;
    },
  });
}
