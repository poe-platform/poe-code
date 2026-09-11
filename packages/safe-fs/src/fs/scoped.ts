import type { FileStaging, FileReadHandle, FileResizeHandle, FileSystem, FsOptions, OpenResizeFileOptions, RenameOptions } from "../contracts/filesystem.js";
import { FsError } from "../contracts/errors.js";
import type { ByteSource } from "../contracts/io.js";
import { finishCleanup } from "../contracts/cleanup.js";
import { registerEntryView } from "./mount/comparison.js";
import { openRetainedResizeFile, retainedResizeCapabilities, ownedMutationCapabilities, requireOwnedMutation } from "./capabilities.js";

const originals = new WeakMap<FileSystem, { filesystem: FileSystem; signal: AbortSignal; cleanupCharge: () => void }>();
const operations = new Set<keyof FileSystem>([
  "writeFileConditional", "removeFileConditional", "createStagedFile", "publishStagedFile", "removeStagedFile", "prepareDirectory",
  "access", "appendFile", "canonicalizeMissingTarget", "capabilitiesFor", "chmod", "compareEntry",
  "copyFile", "link", "lstat", "mkdir", "openReadFile", "openResizeFile", "readFile", "readStream", "readdir",
  "readlink", "realpath", "rename", "resizeFile", "rm", "rmdir", "stat", "symlink", "truncate", "utimes",
  "writeFile", "writeStream",
]);

export function scopeFileSystem(filesystem: FileSystem, charge: () => void, signal: AbortSignal, cleanupCharge = charge): FileSystem {
  const original = originals.get(filesystem)?.filesystem ?? filesystem;
  const methods = new Map<PropertyKey, { original: unknown; scoped: unknown }>();
  const assertOpen = (options?: FsOptions): void => {
    signal.throwIfAborted();
    options?.signal?.throwIfAborted();
  };
  const admit = (options?: FsOptions): void => {
    assertOpen(options);
    charge();
  };
  const wrapHandle = (handle: FileReadHandle): FileReadHandle => {
    let closed = false;
    const close = handle.close.bind(handle);
    return {
      async stat(options) { admit(options); return handle.stat(options); },
      async read(position, maxBytes, options) { admit(options); return handle.read(position, maxBytes, options); },
      get seekEnd() {
        const seek = handle.seekEnd;
        if (typeof seek !== "function") return undefined;
        return async (options: FsOptions = {}) => {
          assertOpen(options);
          if (closed) throw new FsError("EBADF");
          admit(options);
          assertOpen(options);
          if (closed) throw new FsError("EBADF");
          try {
            const result = await Reflect.apply(seek, handle, [resizeOptions(options)]);
            assertOpen(options);
            return result;
          } catch (error) { assertOpen(options); throw error; }
        };
      },
      close() { closed = true; return close(); },
    };
  };
  const resizeOptions = <Options extends FsOptions>(options: Options): Options => {
    const scopedOptions = {
      ...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
    };
    scopedOptions.signal.throwIfAborted();
    return scopedOptions;
  };
  const wrapResizeHandle = (handle: FileResizeHandle): FileResizeHandle => {
    let closing: Promise<void> | undefined;
    const admitOperation = (options: FsOptions): FsOptions => {
      assertOpen(options);
      if (closing) throw new FsError("EBADF");
      admit(options);
      assertOpen(options);
      if (closing) throw new FsError("EBADF");
      return resizeOptions(options);
    };
    return {
      async stat(options = {}) {
        try {
          const result = await handle.stat(admitOperation(options));
          assertOpen(options);
          return result;
        } catch (error) { assertOpen(options); throw error; }
      },
      async truncate(length, options = {}) {
        try {
          await handle.truncate(length, admitOperation(options));
          assertOpen(options);
        } catch (error) { assertOpen(options); throw error; }
      },
      get seekEnd() {
        const seek = handle.seekEnd;
        if (typeof seek !== "function") return undefined;
        return async (options: FsOptions = {}) => {
          try {
            const result = await Reflect.apply(seek, handle, [admitOperation(options)]);
            assertOpen(options);
            return result;
          } catch (error) { assertOpen(options); throw error; }
        };
      },
      close: () => closing ??= Promise.resolve().then(() => handle.close()),
    };
  };
  const wrapStream = (source: ByteSource, options?: FsOptions): ByteSource => ({
    [Symbol.asyncIterator]() {
      assertOpen(options);
      const iterator = source[Symbol.asyncIterator]();
      let closing: Promise<IteratorResult<Uint8Array>> | undefined;
      const close = (value?: unknown): Promise<IteratorResult<Uint8Array>> => closing ??= Promise.resolve().then(
        () => iterator.return ? iterator.return(value) : { done: true, value: undefined },
      );
      const advance = async (operation: () => Promise<IteratorResult<Uint8Array>>): Promise<IteratorResult<Uint8Array>> => {
        try {
          assertOpen(options);
          if (closing) { await closing; return { done: true, value: undefined }; }
          const result = await operation();
          assertOpen(options);
          if (closing) { await closing; return { done: true, value: undefined }; }
          return result;
        } catch (error) {
          await finishCleanup(close, true);
          throw error;
        }
      };
      return {
        next: () => advance(() => iterator.next()),
        return: close,
        ...(iterator.throw ? { throw: (error?: unknown) => advance(() => iterator.throw!(error)) } : {}),
      };
    },
  });
  const view = new Proxy(Object.create(original) as FileSystem, {
    set(_target, property, value) {
      return Reflect.set(original, property, value, original);
    },
    get(_target, property) {
      if (property === "capabilities") return ownedMutationCapabilities(original, retainedResizeCapabilities(original));
      const method: unknown = Reflect.get(original, property, original);
      if (typeof method !== "function") return method;
      const cached = methods.get(property);
      if (cached?.original === method) return cached.scoped;
      const dispatch = (...args: unknown[]): unknown => {
        if (operations.has(property as keyof FileSystem)) {
          const options = args.at(-1);
          admit(options && typeof options === "object" && "signal" in options ? options as FsOptions : undefined);
        }
        if (["writeFileConditional", "removeFileConditional", "createStagedFile", "publishStagedFile", "removeStagedFile", "prepareDirectory"].includes(String(property))) return (async () => {
          const path = typeof args[0] === "string" ? args[0] : (args[0] as FileStaging).directory.path;
          const options = args[property === "createStagedFile" ? 3 : property === "publishStagedFile" || property === "writeFileConditional" ? 2 : 1] as FsOptions | undefined;
          const create = property === "createStagedFile" || (property === "writeFileConditional" || property === "prepareDirectory") && options !== undefined && "expected" in options && options.expected === null;
          await requireOwnedMutation(original, path, property === "prepareDirectory" ? "atomicDirectoryMetadata" : property === "writeFileConditional" || property === "removeFileConditional" ? "atomicFileMutation" : "atomicFileStaging", options ?? {}, create);
          assertOpen(options);
          return Reflect.apply(method, original, args);
        })();
        if (property === "compareEntry") {
          const peer = args[1] as FileSystem;
          args[1] = originals.get(peer)?.filesystem ?? peer;
        }
        if (property === "rename" && (args[2] as RenameOptions | undefined)?.noReplace) return (async () => {
          const options = args[2] as RenameOptions;
          const capabilities = await original.capabilitiesFor?.(args[1] as string, options) ?? original.capabilities;
          assertOpen(options);
          if (capabilities.atomicRenameNoReplace !== true) throw new FsError("ENOTSUP", {
            syscall: "rename", path: args[0] as string, dest: args[1] as string,
          });
          return Reflect.apply(method, original, args);
        })();
        return Reflect.apply(method, original, args);
      };
      const scoped = property === "openResizeFile"
        ? async (path: string, options: OpenResizeFileOptions = {}) => {
          admit(options);
          assertOpen(options);
          return wrapResizeHandle(await openRetainedResizeFile(original, path, resizeOptions(options)));
        }
        : property === "capabilitiesFor"
          ? async (...args: unknown[]) => ownedMutationCapabilities(original, retainedResizeCapabilities(original, await dispatch(...args) as FileSystem["capabilities"]))
          : property === "openReadFile"
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
  originals.set(view, { filesystem: original, signal, cleanupCharge });
  registerEntryView(view, async (path, options) => {
    assertOpen(options);
    return { filesystem: original, path };
  });
  return view;
}

export interface RetainedFileSystemCleanupView {
  readonly removeFileConditional?: NonNullable<FileSystem["removeFileConditional"]>;
  readonly removeStagedFile?: NonNullable<FileSystem["removeStagedFile"]>;
  readonly lstat: FileSystem["lstat"];
  readonly realpath: FileSystem["realpath"];
  readonly rm: (path: string, options?: FsOptions) => Promise<void>;
  readonly rmdir?: NonNullable<FileSystem["rmdir"]>;
}

export interface RetainedFileSystemCleanupOptions {
  readonly maxOperations?: number;
}

export function retainFileSystemCleanup(
  filesystem: FileSystem,
  cleanupCallback: (view: RetainedFileSystemCleanupView) => void | PromiseLike<void>,
  options?: RetainedFileSystemCleanupOptions,
): () => Promise<void> {
  const maximum = options?.maxOperations === undefined ? 256 : options.maxOperations;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 4096) throw new RangeError("cleanup maxOperations must be an integer between 0 and 4096");
  if (typeof cleanupCallback !== "function") throw new TypeError("cleanup callback must be a function");
  const scope = originals.get(filesystem);
  scope?.signal.throwIfAborted();
  const backing = scope?.filesystem ?? filesystem;
  const pending = new Set<Promise<PromiseSettledResult<void>>>();
  let operations = 0;
  let active = false;
  let closing: Promise<void> | undefined;
  const invoke = (method: keyof RetainedFileSystemCleanupView, input: string | FileStaging, settings?: FsOptions): Promise<unknown> => {
    const path = typeof input === "string" ? input : input.directory.path;
    if (!active) {
      const rejected = Promise.reject(new FsError("EBADF", { syscall: method, path, message: "cleanup callback is not active" }));
      void rejected.catch(() => {});
      return rejected;
    }
    let result: Promise<unknown>;
    try {
      settings?.signal?.throwIfAborted();
      if (operations >= maximum) throw new FsError("EFBIG", { syscall: method, path, message: "cleanup operation limit exceeded" });
      operations++;
      scope?.cleanupCharge();
      settings?.signal?.throwIfAborted();
      const operation = backing[method];
      if (typeof operation !== "function") throw new FsError("ENOTSUP", { syscall: method, path });
      const parameters = method === "rm" ? { ...settings, recursive: false, force: false } : settings;
      result = method === "removeStagedFile" || method === "removeFileConditional"
        ? requireOwnedMutation(backing, path, method === "removeFileConditional" ? "atomicFileMutation" : "atomicFileStaging", settings ?? {}).then(() => Reflect.apply(operation, backing, [input, parameters]))
        : Promise.resolve(Reflect.apply(operation, backing, [input, parameters]));
    } catch (error) {
      result = Promise.reject(error);
      void result.catch(() => {});
      return result;
    }
    const completion = result.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
      () => { pending.delete(completion); return { status: "fulfilled", value: undefined }; },
      error => { pending.delete(completion); return { status: "rejected", reason: error }; },
    );
    pending.add(completion);
    return result;
  };
  const view: RetainedFileSystemCleanupView = Object.freeze(Object.assign(Object.create(null) as RetainedFileSystemCleanupView, {
    ...(typeof backing.removeFileConditional === "function" ? { removeFileConditional: invoke.bind(undefined, "removeFileConditional") as NonNullable<RetainedFileSystemCleanupView["removeFileConditional"]> } : {}),
    ...(typeof backing.removeStagedFile === "function" ? { removeStagedFile: invoke.bind(undefined, "removeStagedFile") as NonNullable<RetainedFileSystemCleanupView["removeStagedFile"]> } : {}),
    lstat: invoke.bind(undefined, "lstat") as RetainedFileSystemCleanupView["lstat"],
    realpath: invoke.bind(undefined, "realpath") as RetainedFileSystemCleanupView["realpath"],
    rm: invoke.bind(undefined, "rm") as RetainedFileSystemCleanupView["rm"],
    ...(typeof backing.rmdir === "function" ? { rmdir: invoke.bind(undefined, "rmdir") as NonNullable<RetainedFileSystemCleanupView["rmdir"]> } : {}),
  }));
  scope?.signal.throwIfAborted();
  return () => {
    if (!closing) {
      closing = Promise.resolve().then(async () => {
        active = true;
        let callbackFailed = false;
        let callbackFailure: unknown;
        try {
          const result = cleanupCallback(view);
          if (result !== undefined) await result;
        } catch (error) { callbackFailed = true; callbackFailure = error; }
        finally { active = false; }
        const outcomes = await Promise.all(pending);
        if (callbackFailed) throw callbackFailure;
        const failures: unknown[] = [];
        for (const outcome of outcomes) if (outcome.status === "rejected") failures.push(outcome.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "retained filesystem cleanup failed");
      });
      void closing.catch(() => {});
    }
    return closing;
  };
}
