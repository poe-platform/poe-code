import { SsconvertError, type ByteSource, type ByteSink, type FileSystem } from "../contracts.js";
import { resourceUri } from "../resource-uri.js";
import { ioFailure } from "../io-errors.js";

export interface DescriptorBinding {
  /** Borrowed, consumptive input: repeated opens share the same cursor. */
  readonly source?: ByteSource;
  readonly sink?: ByteSink;
}
export interface ResourceIOOptions {
  readonly cwd: string;
  /** POSIX VFS paths, never host paths. */
  readonly filesystem: FileSystem;
  readonly descriptors?: Readonly<Record<number, DescriptorBinding>>;
  readonly adapters?: Readonly<Record<string, FileSystem>>;
  readonly transport?: {
    authorize(uri: string, direction: "read" | "write", signal: AbortSignal): Promise<void>;
    /** Must not follow redirects, use ambient credentials or perform other requests. */
    request(uri: string, direction: "read" | "write", bytes: Uint8Array | undefined,
      signal: AbortSignal): Promise<{ readonly source?: ByteSource; readonly redirect?: string }>;
    readonly redirects: number;
  };
}

function descriptor(uri: string): number | undefined {
  if (uri.slice(0, 5).toLowerCase() !== "fd://") return;
  const value = uri.endsWith("/") ? uri.slice(5, -1) : uri.slice(5);
  if (!value || !Array.from(value).every((c) => c >= "0" && c <= "9")) return;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 2147483647 ? number : undefined;
}

function filePath(uri: string, direction: "read" | "write"): string {
  try {
    const location = uri.slice(uri.indexOf(":") + 1).split("?")[0]!.split("#")[0]!;
    if (!location.startsWith("/") || (location.startsWith("//") && location.indexOf("/", 2) < 0))
      throw new Error("Invalid file URI");
    // WHATWG file URLs treat backslashes as separators; POSIX/Gnumeric do not.
    const url = new URL(uri.split("\\").join("%5C"));
    if (url.username || url.password || url.port || url.pathname.toLowerCase().includes("%2f"))
      throw new Error("Invalid file URI");
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith("/") || path.includes("\0")) throw new Error("Invalid file URI");
    return path;
  } catch { throw new SsconvertError("io", direction === "read" ? "E Operation not supported" :
    `E Can't open '${uri}' for writing: Operation not supported`); }
}

/** Resolve names without ambient cwd, network, credentials or descriptor access. */
export function createResourceIO(options: ResourceIOOptions): FileSystem {
  const { cwd, filesystem } = options;
  if (!cwd.startsWith("/") || cwd.includes("\0"))
    throw new TypeError("ssconvert cwd must be an absolute VFS path");
  const descriptors = new Map<number, { source?: ByteSource; iterator?: AsyncIterator<Uint8Array> | Iterator<Uint8Array>; sink?: ByteSink }>();
  for (const [key, binding] of Object.entries(options.descriptors ?? {})) {
    const source = binding.source;
    descriptors.set(Number(key), {
      ...(source === undefined ? {} : { source }),
      ...(binding.sink === undefined ? {} : { sink: binding.sink })
    });
  }
  const adapters = { ...options.adapters };
  const transport = options.transport === undefined ? undefined : {
    authorize: options.transport.authorize.bind(options.transport),
    request: options.transport.request.bind(options.transport),
    redirects: options.transport.redirects
  };
  if (transport && (!Number.isSafeInteger(transport.redirects) || transport.redirects < 0))
    throw new TypeError("Invalid ssconvert redirect limit");
  async function access(name: string, direction: "read" | "write", signal: AbortSignal,
    bytes?: Uint8Array): Promise<ByteSource> {
    signal.throwIfAborted();
    if (name.includes("\0")) throw new SsconvertError("invalid-request", "Invalid resource name");
    const fd = descriptor(name);
    if (fd !== undefined) {
      const binding = descriptors.get(fd);
      if (direction === "write") {
        if (!binding?.sink) throw new SsconvertError("io", `E Can't open '${name}' for writing: Unable to write to ${name}`);
        await binding.sink.write(bytes!);
        signal.throwIfAborted();
        return [];
      }
      if (!binding?.source) throw new SsconvertError("io", `E Unable to read from ${name}`);
      return { async *[Symbol.asyncIterator]() {
        signal.throwIfAborted();
        const source = binding.source!;
        const iterator = binding.iterator ??= Symbol.asyncIterator in source
          ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
        while (true) {
          signal.throwIfAborted();
          const next = await iterator.next();
          signal.throwIfAborted();
          if (next.done) return;
          yield next.value;
        }
      } };
    }
    const uri = resourceUri(name, cwd);
    const scheme = uri.slice(0, uri.indexOf(":")).toLowerCase();
    if (scheme === "file") {
      const path = filePath(uri, direction);
      try {
        if (direction === "read") return await filesystem.read(path, signal);
        await filesystem.write(path, bytes!, signal);
      } catch (error) {
        signal.throwIfAborted();
        ioFailure(error, direction === "read" ? path : resourceUri(path, cwd), direction);
      }
      signal.throwIfAborted();
      return [];
    }
    if (Object.hasOwn(adapters, scheme)) {
      const adapter = adapters[scheme]!;
      if (direction === "read") return adapter.read(uri, signal);
      await adapter.write(uri, bytes!, signal);
      signal.throwIfAborted();
      return [];
    }
    if ((scheme === "http" || scheme === "https") && transport) {
      let current = uri;
      for (let hop = 0; ; hop++) {
        let url: URL;
        try { url = new URL(current); }
        catch { throw new SsconvertError("invalid-request", "Invalid remote URI"); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          throw new SsconvertError("capability-denied", "Remote URI capability denied");
        signal.throwIfAborted();
        await transport.authorize(current, direction, signal);
        signal.throwIfAborted();
        const response = await transport.request(current, direction, bytes, signal);
        signal.throwIfAborted();
        if (response.redirect === undefined) return response.source ?? [];
        if (hop >= transport.redirects) throw new SsconvertError("resource-limit", "ssconvert redirect limit exceeded");
        try { current = new URL(response.redirect, current).href; }
        catch { throw new SsconvertError("invalid-request", "Invalid remote URI"); }
      }
    }
    if (scheme === "http" || scheme === "https")
      throw new SsconvertError("capability-denied", `URI access capability disabled: ${uri}`);
    throw new SsconvertError("io", direction === "read" ? "E Operation not supported" :
      `E Can't open '${uri}' for writing: Operation not supported`);
  }
  return {
    async openOutput(name, context) {
      context.signal.throwIfAborted();
      if (name.includes("\0")) throw new SsconvertError("invalid-request", "Invalid resource name");
      if (descriptor(name) !== undefined) return undefined;
      const uri = resourceUri(name, cwd);
      const scheme = uri.slice(0, uri.indexOf(":")).toLowerCase();
      if (scheme === "file") return filesystem.openOutput?.(filePath(uri, "write"), context);
      if (Object.hasOwn(adapters, scheme)) return adapters[scheme]!.openOutput?.(uri, context);
      return undefined;
    },
    async read(name, signal) {
      const source = await access(name, "read", signal);
      return { [Symbol.asyncIterator]() {
        signal.throwIfAborted();
        const iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
        let completed = false;
        let closing: Promise<IteratorResult<Uint8Array>> | undefined;
        const close = (): Promise<IteratorResult<Uint8Array>> => {
          if (closing) return closing;
          if (completed) return Promise.resolve({ done: true, value: undefined });
          completed = true;
          closing = Promise.resolve().then(() => iterator.return?.() ?? { done: true, value: undefined });
          return closing;
        };
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            try {
              signal.throwIfAborted();
              if (completed) return { done: true, value: undefined };
              const next = await iterator.next();
              signal.throwIfAborted();
              if (next.done) completed = true;
              return next;
            } catch (error) {
              try { await close(); }
              catch (cleanup) {
                if (cleanup !== error) throw new AggregateError([error, cleanup], "ssconvert source and cleanup failed");
              }
              throw error;
            }
          },
          return: close
        };
      } };
    },
    async write(name, bytes, signal) { await access(name, "write", signal, bytes); }
  };
}
