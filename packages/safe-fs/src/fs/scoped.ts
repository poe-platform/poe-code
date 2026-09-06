import type { FileReadHandle, FileSystem, FsOptions } from "../contracts/filesystem.js";
import type { ByteSource } from "../contracts/io.js";
import { registerEntryView } from "./mount/comparison.js";

const originals = new WeakMap<FileSystem, FileSystem>();
const operations = new Set<keyof FileSystem>([
  "access", "appendFile", "canonicalizeMissingTarget", "capabilitiesFor", "chmod", "compareEntry",
  "copyFile", "link", "lstat", "mkdir", "openReadFile", "readFile", "readStream", "readdir",
  "readlink", "realpath", "rename", "rm", "rmdir", "stat", "symlink", "truncate", "utimes",
  "writeFile", "writeStream",
]);

export function scopeFileSystem(filesystem: FileSystem, charge: () => void, signal: AbortSignal): FileSystem {
  const original = originals.get(filesystem) ?? filesystem;
  const methods = new Map<PropertyKey, { original: unknown; scoped: unknown }>();
  const assertOpen = (options?: FsOptions): void => {
    signal.throwIfAborted();
    options?.signal?.throwIfAborted();
  };
  const admit = (options?: FsOptions): void => {
    assertOpen(options);
    charge();
  };
  const wrapHandle = (handle: FileReadHandle): FileReadHandle => ({
    async stat(options) { admit(options); return handle.stat(options); },
    async read(position, maxBytes, options) { admit(options); return handle.read(position, maxBytes, options); },
    close: handle.close.bind(handle),
  });
  const wrapStream = (source: ByteSource, options?: FsOptions): ByteSource => ({
    async *[Symbol.asyncIterator]() {
      assertOpen(options);
      for await (const chunk of source) {
        assertOpen(options);
        yield chunk;
        assertOpen(options);
      }
      assertOpen(options);
    },
  });
  const view = new Proxy(Object.create(original) as FileSystem, {
    set(_target, property, value) {
      return Reflect.set(original, property, value, original);
    },
    get(_target, property) {
      const method: unknown = Reflect.get(original, property, original);
      if (typeof method !== "function") return method;
      const cached = methods.get(property);
      if (cached?.original === method) return cached.scoped;
      const dispatch = (...args: unknown[]): unknown => {
        if (operations.has(property as keyof FileSystem)) {
          const options = args.at(-1);
          admit(options && typeof options === "object" && "signal" in options ? options as FsOptions : undefined);
        }
        if (property === "compareEntry") {
          const peer = args[1] as FileSystem;
          args[1] = originals.get(peer) ?? peer;
        }
        return Reflect.apply(method, original, args);
      };
      const scoped = property === "openReadFile"
        ? async (...args: unknown[]) => wrapHandle(await dispatch(...args) as FileReadHandle)
        : property === "readStream"
          ? (...args: unknown[]) => wrapStream(dispatch(...args) as ByteSource, args[1] as FsOptions | undefined)
        : operations.has(property as keyof FileSystem) && property !== "canonicalizeMissingTarget"
          ? async (...args: unknown[]) => dispatch(...args)
          : dispatch;
      methods.set(property, { original: method, scoped });
      return scoped;
    },
  });
  originals.set(view, original);
  registerEntryView(view, async (path, options) => {
    assertOpen(options);
    return { filesystem: original, path };
  });
  return view;
}
