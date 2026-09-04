import type { FileSystem, FsOptions } from "../../contracts/filesystem.js";
import type { ByteSource } from "../../contracts/io.js";

export interface FileSystemQuotaOptions {
  readonly maxBytes: number;
}

export class FileSystemQuotaError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Filesystem quota exceeded (${maxBytes} bytes)`);
    this.name = "FileSystemQuotaError";
  }
}

async function usedBytes(fs: FileSystem, options?: FsOptions): Promise<number> {
  let total = 0;
  const pending = ["/"];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await fs.readdir(directory, options)) {
      const path = `${directory === "/" ? "" : directory}/${entry.name}`;
      if (entry.type === "directory") pending.push(path);
      else total += (await fs.lstat(path, options)).size;
    }
  }
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
  let queue: Promise<unknown> = Promise.resolve();
  const mutate = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };
  const assertDelta = async (path: string, nextBytes: number, fsOptions?: FsOptions): Promise<void> => {
    const current = await existingBytes(fs, path, fsOptions);
    if (await usedBytes(fs, fsOptions) - current + nextBytes > options.maxBytes) throw new FileSystemQuotaError(options.maxBytes);
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
  return new Proxy(fs, {
    get(target, property) {
      const replacement = Reflect.get(mutations, property) as unknown;
      if (typeof replacement === "function") return replacement;
      const original = Reflect.get(target, property) as unknown;
      return typeof original === "function" ? original.bind(target) : original;
    },
  });
}
