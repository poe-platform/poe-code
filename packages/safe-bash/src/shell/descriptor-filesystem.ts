import { FsError, normalizePath, type FileSystem, type FileSystemCapabilities, type FsOptions } from "../contracts/index.js";
import { collectBytes, pipeBytes, readBytes, writeBytes } from "../contracts/io.js";
import { budgetedFileOutput } from "../contracts/filesystem-output-budget.js";
import { registerEntryView } from "@poe-code/safe-fs/runtime-core";
import type { Descriptor, IO } from "./runtime.js";

export function descriptorPath(target: string): number | undefined {
  if (target === "/dev/stdin") return 0;
  if (target === "/dev/stdout") return 1;
  if (target === "/dev/stderr") return 2;
  const name = target.startsWith("/dev/fd/") ? target.slice(8) : "";
  return name.length > 0 && [...name].every(character => character >= "0" && character <= "9") ? Number(name) : undefined;
}

/** File operands borrow the invocation's streams; closing an operand must not close its descriptor. */
export function descriptorFileSystem(fs: FileSystem, io: IO, maxInputBytes: number): FileSystem {
  const descriptor = (path: string, options?: FsOptions): Descriptor | undefined => {
    options?.signal?.throwIfAborted();
    const number = descriptorPath(normalizePath(path));
    if (number === undefined) return undefined;
    const entry = io.descriptors ? io.descriptors.get(number) : (number === 0 ? { input: io.stdin }
      : number === 1 ? { output: io.stdout } : number === 2 ? { output: io.stderr } : undefined);
    if (!entry || entry.closed) throw new FsError("ENOENT", { path });
    return entry;
  };
  const input = (entry: Descriptor, path: string) => {
    if (!entry.input) throw new FsError("EBADF", { path, syscall: "read" });
    return entry.input;
  };
  const output = (entry: Descriptor, path: string, flag?: string) => {
    if (flag === "wx" || flag === "ax") throw new FsError("EEXIST", { path });
    if (!entry.output) throw new FsError("EBADF", { path, syscall: "write" });
    return entry.output;
  };
  const capabilities: FileSystemCapabilities = {
    readOnly: false, read: true, write: true, append: true, stat: true, access: true, realpath: true,
    streamingRead: true, streamingWrite: true, streamingAppend: true, descriptorWriteStream: true,
    exclusiveCreate: true, open: false, retainedRead: false, retainedResize: false,
  };
  const overrides: Partial<FileSystem> = {
    async capabilitiesFor(path, options) {
      return descriptor(path, options) ? capabilities : await fs.capabilitiesFor?.(path, options) ?? fs.capabilities;
    },
    async readFile(path, options) {
      const entry = descriptor(path, options);
      if (!entry) return fs.readFile(path, options);
      return collectBytes(input(entry, path), { ...options, maxBytes: Math.min(options?.maxBytes ?? Infinity, maxInputBytes) });
    },
    readStream(path, options) {
      const entry = descriptor(path, options);
      if (!entry) {
        if (fs.readStream) return fs.readStream(path, options);
        throw new FsError("ENOTSUP", { path, syscall: "readStream" });
      }
      if (options?.start || options?.endExclusive !== undefined) throw new FsError("ESPIPE", { path, syscall: "readStream" });
      return readBytes(input(entry, path), options?.signal);
    },
    async writeFile(path, bytes, options) {
      const entry = descriptor(path, options);
      if (!entry) return fs.writeFile(path, bytes, options);
      await writeBytes(output(entry, path, options?.flag), bytes, options?.signal);
    },
    async appendFile(path, bytes, options) {
      const entry = descriptor(path, options);
      if (!entry) return fs.appendFile(path, bytes, options);
      await writeBytes(output(entry, path), bytes, options?.signal);
    },
    async writeStream(path, source, options) {
      const entry = descriptor(path, options);
      if (!entry) {
        if (fs.writeStream) return fs.writeStream(path, source, options);
        throw new FsError("ENOTSUP", { path, syscall: "writeStream" });
      }
      await pipeBytes(source, output(entry, path, options?.flag), options?.signal);
    },
    async stat(path, options) {
      const entry = descriptor(path, options);
      if (!entry) return fs.stat(path, options);
      if (entry.file) return entry.file.stat(options);
      return { type: "character", size: 0, mode: 0o020600, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 };
    },
    async access(path, mode = 0, options) {
      const entry = descriptor(path, options);
      if (!entry) return fs.access(path, mode, options);
      if (mode & 1 || mode & 4 && !entry.input || mode & 2 && !entry.output) throw new FsError("EACCES", { path });
    },
    async realpath(path, options) {
      return descriptor(path, options) ? normalizePath(path) : fs.realpath(path, options);
    },
  };
  const methods = new Map<PropertyKey, unknown>();
  const view = new Proxy(fs, {
    get(target, key) {
      if (key === budgetedFileOutput) return (path: string) => descriptorPath(normalizePath(path)) !== undefined;
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (!methods.has(key)) methods.set(key, value.bind(target));
      return methods.get(key);
    },
  });
  registerEntryView(view, async (path, options) => descriptor(path, options)
    ? { filesystem: view, path, stat: await overrides.stat!(path, options) }
    : { filesystem: fs, path });
  return view;
}
