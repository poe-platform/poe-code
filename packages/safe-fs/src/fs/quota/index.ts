import type { FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import { FsError } from "../../contracts/errors.js";
import type { ByteSource } from "../../contracts/io.js";
import { openRetainedReadFile, quotaCapabilities, retainedReadCapabilities } from "../capabilities.js";
import { admitDirectoryEntries } from "../directory-admission.js";

export interface FileSystemQuotaOptions {
  readonly maxBytes: number;
  readonly maxScanEntries?: number;
  readonly maxScanDepth?: number;
}

export class FileSystemQuotaError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Filesystem quota exceeded (${maxBytes} bytes)`);
    this.name = "FileSystemQuotaError";
  }
}

async function usedBytes(fs: FileSystem, limits: { maxScanEntries: number; maxScanDepth: number }, options?: FsOptions, change?: { path: string; stat: FileStat; delta: number }): Promise<number> {
  let total = 0;
  let possibleAliases = 0;
  let remaining = limits.maxScanEntries;
  const pending = [{ path: "/", depth: 0 }];
  while (pending.length) {
    options?.signal?.throwIfAborted();
    const directory = pending.pop();
    if (!directory) break;
    const signal = options?.signal;
    const entries = await fs.readdir(directory.path, { ...options, ...(signal ? { signal } : {}), maxEntries: remaining });
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
        const stat = await fs.lstat(path, options);
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
  const mutate = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };
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
      if (property === "canonicalizeMissingTarget") return undefined;
      if (property === "capabilities") return quotaCapabilities(retainedReadCapabilities(fs));
      if (property === "capabilitiesFor") return async (path: string, fsOptions?: FsOptions) => {
        const capabilities = await fs.capabilitiesFor?.(path, fsOptions) ?? fs.capabilities;
        return quotaCapabilities(retainedReadCapabilities(fs, capabilities));
      };
      if (property === "openReadFile") return (path: string, fsOptions: FsOptions = {}) => openRetainedReadFile(fs, path, fsOptions);
      const replacement = Reflect.get(mutations, property) as unknown;
      if (typeof replacement === "function") return replacement;
      const original = Reflect.get(fs, property) as unknown;
      return typeof original === "function" ? original.bind(fs) : original;
    },
  });
}
