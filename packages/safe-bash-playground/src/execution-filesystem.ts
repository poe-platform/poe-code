import { FsError } from "./engine/index.js";
import type { FileSystem } from "./engine/index.js";

const methods = {
  readFile: 1, writeFile: 2, appendFile: 2, stat: 1, lstat: 1, readdir: 1,
  mkdir: 1, rm: 1, rmdir: 1, rename: 2, copyFile: 2, realpath: 1, access: 2,
  readlink: 1, symlink: 2, link: 2, chmod: 2, utimes: 3, truncate: 2, capabilitiesFor: 1
} as const;

export interface FileSystemDescription {
  capabilities: FileSystem["capabilities"];
  methods: string[];
}

export interface RemoteError {
  message: string;
  code?: ConstructorParameters<typeof FsError>[0];
  syscall?: string;
  path?: string;
  dest?: string;
}

export function encodeError(error: unknown): RemoteError {
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof FsError ? { code: error.code, syscall: error.syscall, path: error.path, dest: error.dest } : {})
  };
}

export function decodeError(error: RemoteError): Error {
  const decoded = error.code ? new FsError(error.code, {
    syscall: error.syscall, path: error.path, dest: error.dest
  }) : new Error(error.message);
  decoded.message = error.message;
  return decoded;
}

type Stream = {
  iterator: AsyncIterator<Uint8Array>;
  pending: boolean;
  closing?: Promise<IteratorResult<Uint8Array>>;
};

type Descriptor = {
  handle: object;
  callbacks: Record<string, (...args: unknown[]) => unknown>;
  pending: Set<Promise<unknown>>;
  closing?: Promise<void>;
};

function tracked<Value>(pending: Set<Promise<unknown>>, callback: () => Value | PromiseLike<Value>): Promise<Value> {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const operation = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
  pending.add(operation);
  try {
    Promise.resolve(callback()).then(
      value => { pending.delete(operation); resolve(value); },
      error => { pending.delete(operation); reject(error); }
    );
  } catch (error) { pending.delete(operation); reject(error); }
  return operation;
}

function retainedCapabilities(capabilities: FileSystem["capabilities"], available: readonly string[]): FileSystem["capabilities"] {
  return {
    ...capabilities,
    ...(!available.includes("openReadFile") ? { retainedRead: false } : {}),
    ...(!available.includes("openResizeFile") ? { retainedResize: false } : {})
  };
}

export function hostFileSystem(fs: FileSystem, signal: AbortSignal) {
  const streams = new Map<number, Stream>();
  const descriptors = new Map<number, Descriptor>();
  const scopes = new Map<object | symbol, number>();
  const pending = new Set<Promise<unknown>>();
  const admitted = new Set<Promise<unknown>>();
  let nextStream = 0;
  let nextDescriptor = 0;
  let acquiring = 0;
  let closed = false;
  let closing: Promise<void> | undefined;
  let cleanupFailure: { error: unknown } | undefined;
  const available = [...Object.keys(methods), "compareEntry", "readStream", "writeStream", "openReadFile", "openResizeFile"]
    .filter(method => typeof Reflect.get(fs, method) === "function");
  const description: FileSystemDescription = {
    capabilities: retainedCapabilities(fs.capabilities, available),
    methods: available
  };
  function checkAdmission(): void {
    signal.throwIfAborted();
    if (closed) throw new FsError("ECANCELED");
  }
  function encodeStat(result: unknown): unknown {
    const { identityScope, ...stat } = result as Awaited<ReturnType<FileSystem["stat"]>>;
    if (identityScope === undefined) return stat;
    let identity = scopes.get(identityScope);
    if (identity === undefined) {
      if (scopes.size >= 10_000) throw new Error("Filesystem identity limit exceeded");
      identity = scopes.size + 1;
      scopes.set(identityScope, identity);
    }
    return { ...stat, identity };
  }
  function closeDescriptor(identity: number, descriptor: Descriptor): Promise<void> {
    return descriptor.closing ??= Promise.resolve().then(async () => {
      try {
        await Promise.allSettled(descriptor.pending);
        await Reflect.apply(descriptor.callbacks.close!, descriptor.handle, []);
      } catch (error) {
        if (closed) cleanupFailure ??= { error };
        throw error;
      } finally {
        descriptors.delete(identity);
      }
    });
  }
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    signal.removeEventListener("abort", onAbort);
    return closing = Promise.resolve().then(async () => {
      await Promise.allSettled([
        ...[...streams.values()].map(closeStream),
        ...[...descriptors].map(([identity, descriptor]) => closeDescriptor(identity, descriptor))
      ]);
      await Promise.allSettled(admitted);
      streams.clear();
      scopes.clear();
      if (cleanupFailure) throw cleanupFailure.error;
    });
  }
  function onAbort(): void { void close().catch(() => undefined); }
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  function closeStream(stream: Stream): Promise<IteratorResult<Uint8Array>> {
    return stream.closing ??= Promise.resolve().then(() => stream.iterator.return?.() ?? { done: true, value: undefined });
  }
  async function invoke(method: string, args: unknown[]): Promise<unknown> {
    if (method === "handle-open-read" || method === "handle-open-resize") {
      checkAdmission();
      const openMethod = method === "handle-open-read" ? "openReadFile" : "openResizeFile";
      if (!available.includes(openMethod)) throw new FsError("ENOTSUP");
      if (descriptors.size + acquiring >= 64) throw new Error("Retained handle limit exceeded");
      acquiring++;
      try {
        const open = Reflect.get(fs, openMethod);
        checkAdmission();
        if (typeof open !== "function") throw new FsError("ENOTSUP");
        const handle: object = await Reflect.apply(open, fs, [args[0], { ...args[1] as object, signal }]);
        const closeHandle = Reflect.get(handle, "close");
        if (typeof closeHandle !== "function") throw new Error("Invalid retained handle close");
        const descriptor: Descriptor = { handle, callbacks: { close: closeHandle }, pending: new Set() };
        const identity = ++nextDescriptor;
        descriptors.set(identity, descriptor);
        try {
          for (const callback of ["stat", openMethod === "openReadFile" ? "read" : "truncate", "seekEnd"]) {
            checkAdmission();
            const operation = Reflect.get(handle, callback);
            checkAdmission();
            if (callback === "seekEnd" && operation === undefined) continue;
            if (typeof operation !== "function") throw new Error(`Invalid retained handle ${callback}`);
            descriptor.callbacks[callback] = operation;
          }
          checkAdmission();
          return { identity, seekEnd: typeof descriptor.callbacks.seekEnd === "function" };
        } catch (error) {
          await closeDescriptor(identity, descriptor).catch(() => undefined);
          throw error;
        }
      } finally { acquiring--; }
    }
    if (["handle-stat", "handle-read", "handle-truncate", "handle-seekEnd"].includes(method)) {
      checkAdmission();
      const descriptor = descriptors.get(args[0] as number);
      if (!descriptor || descriptor.closing) throw new FsError("EBADF");
      const operation = method.slice("handle-".length);
      const callback = descriptor.callbacks[operation];
      if (!callback) throw new FsError("ENOTSUP");
      if (operation === "read") {
        if (!Number.isSafeInteger(args[1]) || (args[1] as number) < 0 || !Number.isSafeInteger(args[2]) || (args[2] as number) < 0) {
          throw new FsError("EINVAL", { syscall: "read" });
        }
        args[2] = Math.min(args[2] as number, 64 * 1024);
      }
      return tracked(descriptor.pending, async () => {
        const parameters = operation === "read" ? [args[1], args[2], { signal }]
          : operation === "truncate" ? [args[1], { signal }] : [{ signal }];
        const result: unknown = await Reflect.apply(callback, descriptor.handle, parameters);
        checkAdmission();
        return operation === "stat" ? encodeStat(result) : result instanceof Uint8Array ? result.slice() : result;
      });
    }
    if (method === "stream-open") {
      if (!fs.readStream || streams.size >= 64) throw new Error("Read stream limit exceeded");
      const iterator = fs.readStream(args[0] as string, { ...args[1] as object, signal })[Symbol.asyncIterator]();
      const identity = ++nextStream;
      streams.set(identity, { iterator, pending: false });
      return identity;
    }
    if (method === "stream-next" || method === "stream-close") {
      const identity = args[0] as number;
      const stream = streams.get(identity);
      if (!stream) return { done: true, value: undefined };
      if (method === "stream-close") {
        await closeStream(stream);
        streams.delete(identity);
        return { done: true, value: undefined };
      }
      if (stream.pending) throw new Error("Concurrent stream pull");
      stream.pending = true;
      try {
        const result = await stream.iterator.next();
        if (result.done || stream.closing || closed) {
          await closeStream(stream);
          streams.delete(identity);
          return { done: true, value: undefined };
        }
        return { done: false, value: result.value.slice() };
      } catch (error) {
        await closeStream(stream).catch(() => undefined);
        streams.delete(identity);
        throw error;
      } finally {
        stream.pending = false;
      }
    }
    if (method === "compareEntry") {
      return fs.compareEntry?.(args[0] as string, fs, args[1] as string, { signal }) ?? "unknown";
    }
    if (!Object.hasOwn(methods, method) || !description.methods.includes(method)) {
      throw new Error(`Unsupported filesystem operation: ${method}`);
    }
    const optionIndex = methods[method as keyof typeof methods];
    const parameters = args.slice(0, optionIndex);
    parameters[optionIndex] = { ...args[optionIndex] as object, signal };
    const callback = Reflect.get(fs, method);
    signal.throwIfAborted();
    const result: unknown = await Reflect.apply(callback, fs, parameters);
    if (method === "capabilitiesFor") {
      checkAdmission();
      return retainedCapabilities(result as FileSystem["capabilities"], available);
    }
    if ((method === "stat" || method === "lstat") && result && typeof result === "object") {
      return encodeStat(result);
    }
    return result instanceof Uint8Array ? result.slice() : result;
  }
  return {
    description,
    dispatch(method: string, args: unknown[]): Promise<unknown> {
      if (method === "handle-close") {
        const identity = args[0] as number;
        const descriptor = descriptors.get(identity);
        return descriptor ? closeDescriptor(identity, descriptor) : Promise.resolve();
      }
      if (closed || signal.aborted) return Promise.reject(new FsError("ECANCELED"));
      if (pending.size >= 64) return Promise.reject(new Error("Filesystem request limit exceeded"));
      return tracked(pending, () => method === "capabilitiesFor" ? invoke(method, args) : tracked(admitted, () => invoke(method, args)));
    },
    close
  };
}

export function remoteFileSystem(
  description: FileSystemDescription,
  request: (method: string, args: unknown[]) => Promise<unknown>
): FileSystem {
  const scopes = new Map<number, object>();
  const pending = new Set<Promise<unknown>>();
  let handles = 0;
  async function send(method: string, args: unknown[], cleanup = false): Promise<unknown> {
    if (cleanup) {
      while (pending.size >= 64) await Promise.race([...pending].map(operation => operation.catch(() => undefined)));
    } else if (pending.size >= 63) throw new Error("Filesystem request limit exceeded");
    return tracked(pending, () => request(method, args));
  }
  function decodeStat(result: unknown): Awaited<ReturnType<FileSystem["stat"]>> {
    const { identity, ...stat } = result as Awaited<ReturnType<FileSystem["stat"]>> & { identity?: number };
    if (identity === undefined) return stat;
    if (!scopes.has(identity)) {
      if (scopes.size >= 10_000) throw new Error("Filesystem identity limit exceeded");
      scopes.set(identity, Object.freeze({}));
    }
    return { ...stat, identityScope: scopes.get(identity)! };
  }
  const fs = { capabilities: Object.freeze(retainedCapabilities(description.capabilities, description.methods)) } as FileSystem;
  for (const method of ["openReadFile", "openResizeFile"] as const) {
    if (!description.methods.includes(method)) continue;
    Reflect.set(fs, method, async (path: string, options: { signal?: AbortSignal } = {}) => {
      const { signal, ...settings } = options;
      signal?.throwIfAborted();
      if (handles >= 64) throw new Error("Retained handle limit exceeded");
      handles++;
      let descriptor: { identity: number; seekEnd: boolean } | undefined;
      try {
        descriptor = await send(method === "openReadFile" ? "handle-open-read" : "handle-open-resize", [path, settings]) as typeof descriptor;
        signal?.throwIfAborted();
      } catch (error) {
        if (descriptor) await send("handle-close", [descriptor.identity], true).catch(() => undefined);
        handles--;
        throw error;
      }
      const identity = descriptor!.identity;
      const operations = new Set<Promise<unknown>>();
      let closing: Promise<void> | undefined;
      function invoke(operation: string, args: unknown[], options: { signal?: AbortSignal } = {}): Promise<unknown> {
        try {
          options.signal?.throwIfAborted();
          if (closing) throw new FsError("EBADF");
          return tracked(operations, async () => {
            const result = await send(`handle-${operation}`, [identity, ...args]);
            options.signal?.throwIfAborted();
            return operation === "stat" ? decodeStat(result) : result;
          });
        } catch (error) { return Promise.reject(error); }
      }
      return {
        stat: (options?: { signal?: AbortSignal }) => invoke("stat", [], options),
        ...(method === "openReadFile"
          ? { read: (position: number, maxBytes: number, options?: { signal?: AbortSignal }) => invoke("read", [position, maxBytes], options) }
          : { truncate: (length: number, options?: { signal?: AbortSignal }) => invoke("truncate", [length], options) }),
        ...(descriptor!.seekEnd ? { seekEnd: (options?: { signal?: AbortSignal }) => invoke("seekEnd", [], options) } : {}),
        close: () => closing ??= Promise.resolve().then(async () => {
          try { await send("handle-close", [identity], true); }
          finally { await Promise.allSettled(operations); handles--; }
        })
      };
    });
  }
  for (const [method, optionIndex] of Object.entries(methods)) {
    if (!description.methods.includes(method)) continue;
    Reflect.set(fs, method, async (...args: unknown[]) => {
      const { signal, ...options } = (args[optionIndex] ?? {}) as { signal?: AbortSignal };
      signal?.throwIfAborted();
      args[optionIndex] = options;
      const result = await send(method, args);
      signal?.throwIfAborted();
      if (method === "capabilitiesFor") return retainedCapabilities(result as FileSystem["capabilities"], description.methods);
      if ((method === "stat" || method === "lstat") && result && typeof result === "object") {
        return decodeStat(result);
      }
      return result;
    });
  }
  if (description.methods.includes("compareEntry")) {
    fs.compareEntry = async (path, peer, peerPath, options) => {
      options?.signal?.throwIfAborted();
      return peer === fs ? await send("compareEntry", [path, peerPath]) as "same" | "distinct" | "unknown" : "unknown";
    };
  }
  if (description.methods.includes("readStream")) {
    fs.readStream = (path, options) => ({
      [Symbol.asyncIterator]() {
        const { signal, ...readOptions } = options ?? {};
        let identity: Promise<unknown> | undefined;
        let closing: Promise<IteratorResult<Uint8Array>> | undefined;
        let pending = false;
        const close = (): Promise<IteratorResult<Uint8Array>> => closing ??= (async () => {
          if (identity) await send("stream-close", [await identity], true);
          return { done: true, value: undefined };
        })();
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (closing) return closing;
            if (pending) throw new Error("Concurrent stream pull");
            pending = true;
            try {
              signal?.throwIfAborted();
              identity ??= send("stream-open", [path, readOptions]);
              const result = await send("stream-next", [await identity]) as IteratorResult<Uint8Array>;
              signal?.throwIfAborted();
              if (closing) return closing;
              if (result.done) await close();
              return result;
            } catch (error) {
              await close().catch(() => undefined);
              throw error;
            } finally {
              pending = false;
            }
          },
          return: close
        };
      }
    });
  }
  if (description.methods.includes("writeStream")) {
    fs.writeStream = async (path, source, options) => {
      await fs.writeFile(path, new Uint8Array(), options);
      for await (const chunk of source) await fs.appendFile(path, chunk, options);
    };
  }
  return fs;
}
