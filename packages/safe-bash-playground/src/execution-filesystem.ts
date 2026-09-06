import { FsError } from "./engine/index.js";
import type { FileSystem } from "./engine/index.js";

const methods = {
  readFile: 1, writeFile: 2, appendFile: 2, stat: 1, lstat: 1, readdir: 1,
  mkdir: 1, rm: 1, rmdir: 1, rename: 2, copyFile: 2, realpath: 1, access: 2,
  readlink: 1, symlink: 2, link: 2, chmod: 2, utimes: 3, truncate: 2
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

export function hostFileSystem(fs: FileSystem, signal: AbortSignal) {
  const streams = new Map<number, Stream>();
  const scopes = new Map<object | symbol, number>();
  const pending = new Set<Promise<unknown>>();
  let nextStream = 0;
  let closed = false;
  const description: FileSystemDescription = {
    capabilities: { ...fs.capabilities },
    methods: [...Object.keys(methods), "compareEntry", "readStream", "writeStream"]
      .filter((method) => typeof Reflect.get(fs, method) === "function")
  };
  function closeStream(stream: Stream): Promise<IteratorResult<Uint8Array>> {
    return stream.closing ??= Promise.resolve().then(() => stream.iterator.return?.() ?? { done: true, value: undefined });
  }
  async function invoke(method: string, args: unknown[]): Promise<unknown> {
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
    const result: unknown = await Reflect.apply(Reflect.get(fs, method), fs, parameters);
    if ((method === "stat" || method === "lstat") && result && typeof result === "object") {
      const { identityScope, ...stat } = result as Awaited<ReturnType<FileSystem["stat"]>>;
      if (identityScope !== undefined) {
        let identity = scopes.get(identityScope);
        if (identity === undefined) {
          if (scopes.size >= 10_000) throw new Error("Filesystem identity limit exceeded");
          identity = scopes.size + 1;
          scopes.set(identityScope, identity);
        }
        return { ...stat, identity };
      }
      return stat;
    }
    return result instanceof Uint8Array ? result.slice() : result;
  }
  return {
    description,
    dispatch(method: string, args: unknown[]): Promise<unknown> {
      if (closed || signal.aborted) return Promise.reject(new FsError("ECANCELED"));
      if (pending.size >= 64) return Promise.reject(new Error("Filesystem request limit exceeded"));
      const operation = invoke(method, args);
      pending.add(operation);
      void operation.finally(() => pending.delete(operation)).catch(() => undefined);
      return operation;
    },
    async close(): Promise<void> {
      closed = true;
      await Promise.allSettled([...streams.values()].map(closeStream));
      await Promise.allSettled(pending);
      streams.clear();
      scopes.clear();
    }
  };
}

export function remoteFileSystem(
  description: FileSystemDescription,
  request: (method: string, args: unknown[]) => Promise<unknown>
): FileSystem {
  const scopes = new Map<number, object>();
  const fs = { capabilities: Object.freeze(description.capabilities) } as FileSystem;
  for (const [method, optionIndex] of Object.entries(methods)) {
    if (!description.methods.includes(method)) continue;
    Reflect.set(fs, method, async (...args: unknown[]) => {
      const { signal, ...options } = (args[optionIndex] ?? {}) as { signal?: AbortSignal };
      signal?.throwIfAborted();
      args[optionIndex] = options;
      const result = await request(method, args);
      signal?.throwIfAborted();
      if ((method === "stat" || method === "lstat") && result && typeof result === "object") {
        const { identity, ...stat } = result as { identity?: number };
        if (identity !== undefined) {
          if (!scopes.has(identity)) scopes.set(identity, Object.freeze({}));
          return { ...stat, identityScope: scopes.get(identity) };
        }
        return stat;
      }
      return result;
    });
  }
  if (description.methods.includes("compareEntry")) {
    fs.compareEntry = async (path, peer, peerPath, options) => {
      options?.signal?.throwIfAborted();
      return peer === fs ? await request("compareEntry", [path, peerPath]) as "same" | "distinct" | "unknown" : "unknown";
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
          if (identity) await request("stream-close", [await identity]);
          return { done: true, value: undefined };
        })();
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (closing) return closing;
            if (pending) throw new Error("Concurrent stream pull");
            pending = true;
            try {
              signal?.throwIfAborted();
              identity ??= request("stream-open", [path, readOptions]);
              const result = await request("stream-next", [await identity]) as IteratorResult<Uint8Array>;
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
