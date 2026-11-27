import { collectBytes, FsError, pipeBytes, readBytes, writeBytes } from "../contracts/index.js";
import type { FileSystem } from "../contracts/index.js";
import type { Descriptor, IO } from "./runtime.js";
import { chargeRuntimeFileSystemOperation, getRuntimeBackingFileSystem, registerRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";

export function descriptorPath(target: string): number | undefined {
  if (target === "/dev/stdin") return 0;
  if (target === "/dev/stdout") return 1;
  if (target === "/dev/stderr") return 2;
  const name = target.startsWith("/dev/fd/") ? target.slice(8) : "";
  return name.length > 0 && [...name].every(character => character >= "0" && character <= "9") ? Number(name) : undefined;
}

/** Descriptor paths belong to an invocation, never to the backing filesystem. */
export function descriptorFileSystem(fs: FileSystem, io: IO, signal: AbortSignal): FileSystem {
  const descriptor = (path: string): Descriptor | undefined => {
    signal.throwIfAborted();
    const number = descriptorPath(path);
    if (number === undefined) return undefined;
    const entry = io.descriptors?.get(number) ?? (number === 0 ? { input: io.stdin }
      : number === 1 ? { output: io.stdout } : number === 2 ? { output: io.stderr } : undefined);
    if (!entry || entry.closed) throw new FsError("EBADF", { path });
    return entry;
  };
  const overrides: Partial<FileSystem> = {
    async capabilitiesFor(path, options) {
      options?.signal?.throwIfAborted();
      const entry = descriptor(path);
      return entry ? { open: false, read: true, write: true, streamingRead: true,
        streamingWrite: true, streamingAppend: true, descriptorWriteStream: true }
        : await fs.capabilitiesFor?.(path, options) ?? fs.capabilities;
    },
    async access(path, mode, options) {
      options?.signal?.throwIfAborted();
      const entry = descriptor(path);
      if (!entry) return fs.access(path, mode, options);
      if (((mode ?? 0) & 4) && !entry.input || ((mode ?? 0) & 2) && !entry.output) throw new FsError("EBADF", { path });
    },
    readStream(path, options) {
      options?.signal?.throwIfAborted();
      const entry = descriptor(path);
      if (!entry) return fs.readStream ? fs.readStream(path, options) : (async function* () { yield await fs.readFile(path, options); })();
      if (!entry.input) throw new FsError("EBADF", { path });
      return readBytes(entry.input, options?.signal ?? signal);
    },
    async readFile(path, options) {
      if (!descriptor(path)) return fs.readFile(path, options);
      return collectBytes(overrides.readStream!(path, options), { ...options, signal: options?.signal ?? signal });
    },
    async writeStream(path, source, options) {
      options?.signal?.throwIfAborted();
      const entry = descriptor(path);
      if (!entry) {
        if (!fs.writeStream) throw new FsError("ENOTSUP", { path });
        return fs.writeStream(path, source, options);
      }
      if (!entry.output) throw new FsError("EBADF", { path });
      if (options?.flag === "wx" || options?.flag === "ax") throw new FsError("EEXIST", { path });
      await pipeBytes(source, entry.output, options?.signal ?? signal);
    },
    async writeFile(path, data, options) {
      options?.signal?.throwIfAborted();
      const entry = descriptor(path);
      if (!entry) return fs.writeFile(path, data, options);
      if (!entry.output) throw new FsError("EBADF", { path });
      if (options?.flag === "wx" || options?.flag === "ax") throw new FsError("EEXIST", { path });
      await writeBytes(entry.output, data, options?.signal ?? signal);
    },
    async appendFile(path, data, options) {
      if (!descriptor(path)) return fs.appendFile(path, data, options);
      await overrides.writeFile!(path, data, options);
    },
  };
  const view = new Proxy(fs, { get(target, property) {
    const override = Reflect.get(overrides, property);
    if (override !== undefined) return override;
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const backing = getRuntimeBackingFileSystem(fs);
  if (backing) registerRuntimeBackingFileSystem(view, backing, () => chargeRuntimeFileSystemOperation(fs));
  return view;
}
