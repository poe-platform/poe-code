import { FsError, readBytes, toByteSource } from "poe-code/safe-fs";
import type { ByteSource, FsOptions } from "poe-code/safe-fs";
import type { CommandContext } from "../../contracts/command.js";
import { writeBytes } from "../../contracts/io.js";
import { openFileOutput, writeFileOutputCounted } from "../../contracts/filesystem-output.js";
import { openCommandFile } from "../../contracts/filesystem-descriptor.js";
import { yieldTurn } from "../../contracts/yield.js";
import { DdError } from "./options.js";

export interface DdFileRequest {
  readonly direction: "input" | "output";
  readonly path?: string;
  readonly flags: ReadonlySet<string>;
  readonly creation: "allow" | "exclusive" | "never";
  readonly truncate: boolean;
  readonly seek: bigint;
  readonly synchronization?: "data" | "all";
  readonly blockSize: number;
  readonly maxBufferBytes: number;
  readonly maxReadOperations: number;
}

export interface DdFileHandle {
  readonly size?: bigint;
  readonly type?: string;
  read?(size: number, options: FsOptions): Promise<Uint8Array>;
  write?(bytes: Uint8Array, options: FsOptions): Promise<number>;
  seek?(offset: bigint, options: FsOptions): Promise<void>;
  getSize?(options: FsOptions): Promise<bigint>;
  getPosition?(options: FsOptions): Promise<bigint>;
  truncate?(length: bigint, options: FsOptions): Promise<void>;
  sync?(dataOnly: boolean, options: FsOptions): Promise<void>;
  close(): Promise<void>;
  acknowledgeCloseFailure?(reason: unknown): boolean;
}

export type DdFileOpener = (context: CommandContext, request: DdFileRequest) => Promise<DdFileHandle>;

const countedHandles = new WeakSet<DdFileHandle>();

export async function writeDdOutput(context: CommandContext, handle: DdFileHandle, chunk: Uint8Array, options: FsOptions, named: boolean): Promise<number> {
  if (!handle.write) throw new FsError("EBADF");
  return named && !countedHandles.has(handle)
    ? writeFileOutputCounted(context, chunk, () => handle.write!(chunk, options)) : handle.write(chunk, options);
}

async function openDescriptor(context: CommandContext, path: string, request: DdFileRequest): Promise<DdFileHandle> {
  const input = request.direction === "input";
  const descriptor = await openCommandFile(context, path, {
    access: input ? "read" : "write",
    creation: input || request.creation === "never" ? "never" : request.creation === "exclusive" ? "exclusive" : "ifMissing",
    truncate: request.truncate,
    append: !input && request.flags.has("append"),
    ...(request.synchronization === undefined ? {} : { synchronization: request.synchronization }),
  });
  try {
    const stat = await descriptor.stat();
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new FsError("EIO", { path, syscall: "fstat" });
    const positioned = input ? descriptor.capabilities.positionedRead : descriptor.capabilities.positionedWrite;
    let position = 0;
    let closed = false;
    const handle: DdFileHandle = {
      size: BigInt(stat.size), type: stat.type,
      async getSize(options) {
        const current = await descriptor.stat(options);
        if (!Number.isSafeInteger(current.size) || current.size < 0) throw new FsError("EIO", { path, syscall: "fstat" });
        return BigInt(current.size);
      },
      ...(descriptor.capabilities.position === true && descriptor.getPosition ? {
        async getPosition(options: FsOptions) {
          const cursor = await descriptor.getPosition!(options);
          if (!Number.isSafeInteger(position) || position < 0) throw new FsError("EIO", { path, syscall: "getPosition" });
          return BigInt(positioned ? position : cursor);
        },
      } : {}),
      ...(input ? { async read(size: number, options: FsOptions) {
        const buffer = new Uint8Array(size);
        const count = await descriptor.read(buffer, positioned ? position : null, options);
        if (!Number.isSafeInteger(count) || count < 0 || count > size) throw new FsError("EIO", { path, syscall: "read" });
        position += count;
        return buffer.subarray(0, count);
      } } : { async write(chunk: Uint8Array, options: FsOptions) {
        const count = await descriptor.write(chunk, positioned ? position : null, options);
        position += count;
        return count;
      } }),
      ...(positioned ? { async seek(offset: bigint, options: FsOptions) {
        context.signal.throwIfAborted();
        options.signal?.throwIfAborted();
        if (closed) throw new FsError("EBADF", { path, syscall: "seek" });
        if (offset < 0n || offset > BigInt(Number.MAX_SAFE_INTEGER)) throw new DdError(`${input ? "input" : "output"} offset limit exceeded`);
        position = Number(offset);
      } } : {}),
      ...(descriptor.capabilities.truncate ? { async truncate(length: bigint, options: FsOptions) {
        if (length < 0n || length > BigInt(Number.MAX_SAFE_INTEGER)) throw new DdError("output offset limit exceeded");
        await descriptor.truncate(Number(length), options);
      } } : {}),
      ...(descriptor.capabilities.synchronization !== "none" ? { sync: descriptor.sync } : {}),
      close() { closed = true; return descriptor.close(); },
      acknowledgeCloseFailure: descriptor.acknowledgeCloseFailure,
    };
    if (!input) countedHandles.add(handle);
    return handle;
  } catch (error) {
    try { await descriptor.close(); } catch {}
    context.signal.throwIfAborted();
    throw error;
  }
}

export function errorMessage(error: unknown): string {
  const descriptions: Readonly<Record<string, string>> = {
    ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted",
    EEXIST: "File exists", EISDIR: "Is a directory", ENOTDIR: "Not a directory", ELOOP: "Too many levels of symbolic links",
    EIO: "Input/output error", ENOTSUP: "Operation not supported", EROFS: "Read-only file system",
    EFBIG: "File too large", ENOSPC: "No space left on device", EPIPE: "Broken pipe", EINVAL: "Invalid argument",
    EAGAIN: "Resource temporarily unavailable", ESPIPE: "Illegal seek", EBADF: "Bad file descriptor",
  };
  if (error instanceof DdError) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) {
    const description = descriptions[String(error.code)];
    if (description) return description;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function openDdFile(context: CommandContext, request: DdFileRequest): Promise<DdFileHandle> {
  const signal = context.signal;
  signal.throwIfAborted();
  for (const flag of request.flags) {
    if (["binary", "text", "noctty", "count_bytes", "skip_bytes", "seek_bytes", "fullblock"].includes(flag)) continue;
    if (flag === "append") continue;
    if (request.path === undefined && flag === "nofollow") continue;
    throw new DdError(`${flag}: Operation not supported by the filesystem stream adapter`);
  }
  const path = request.path === undefined || request.path === "" ? request.path
    : request.path.startsWith("/") ? request.path : `${context.cwd}/${request.path}`;
  if (path !== undefined && context.fs.open) {
    const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
    if (capabilities.open !== false && (request.direction !== "input" || (await context.fs.stat(path, { signal })).type !== "directory")) return openDescriptor(context, path, request);
  }
  if (request.synchronization) throw new DdError(`${request.synchronization === "all" ? "fsync" : "fdatasync"}: Operation not supported by the filesystem stream adapter`);
  if (request.direction === "output" && request.flags.has("append") && request.truncate) throw new DdError("append with truncation: Operation not supported by the filesystem stream adapter");
  if (request.direction === "input") {
    const stat = path === undefined ? undefined : await context.fs.stat(path, { signal });
    if (path !== undefined) await context.fs.access(path, 4, { signal });
    let position = 0n;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let pending = new Uint8Array();
    let consumed = 0;
    let pulls = 0;
    let closed = false;
    const capabilities = path === undefined ? undefined : await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
    const streaming = path !== undefined && context.fs.readStream && capabilities?.streamingRead !== false;
    const source = (): ByteSource => {
      if (path === undefined) return context.stdin;
      if (stat?.type === "directory") return { async *[Symbol.asyncIterator]() { yield* []; throw new FsError("EISDIR", { path }); } };
      if (streaming) return context.fs.readStream!(path, { signal, start: Number(position), chunkSize: request.blockSize });
      return { async *[Symbol.asyncIterator]() {
        const value = await context.fs.readFile(path, { signal, maxBytes: request.maxBufferBytes });
        yield* toByteSource(value);
      } };
    };
    const closeIterator = async (): Promise<void> => {
      const current = iterator;
      iterator = undefined;
      pending = new Uint8Array();
      consumed = 0;
      await current?.return?.();
    };
    return {
      ...(stat === undefined ? {} : { size: BigInt(stat.size), type: stat.type }),
      async read(size) {
        signal.throwIfAborted();
        if (closed) throw new FsError("EBADF");
        iterator ??= readBytes(source(), signal)[Symbol.asyncIterator]();
        while (consumed === pending.length) {
          if (++pulls > request.maxReadOperations) throw new DdError("input operation limit exceeded");
          const result = await iterator.next();
          if (result.done) return new Uint8Array();
          if (result.value.byteLength > request.maxBufferBytes) throw new DdError("input buffer limit exceeded");
          pending = new Uint8Array(result.value);
          consumed = 0;
          if (pending.length === 0) await yieldTurn(signal);
        }
        const count = Math.min(size, pending.length - consumed);
        const result = new Uint8Array(pending.subarray(consumed, consumed + count));
        consumed += count;
        position += BigInt(count);
        return result;
      },
      ...(streaming && stat?.type === "file" ? { async seek(offset: bigint) {
        signal.throwIfAborted();
        if (offset < 0n || offset > BigInt(Number.MAX_SAFE_INTEGER)) throw new DdError("input offset limit exceeded");
        await closeIterator();
        position = offset;
      } } : {}),
      async close() { closed = true; await closeIterator(); },
    };
  }

  if (request.seek !== 0n || path !== undefined && (!request.truncate && !request.flags.has("append") || request.creation === "never")) {
    throw new DdError("positioned or existing-only output: Operation not supported by the filesystem stream adapter");
  }
  if (path === undefined) return {
    async write(chunk) { await writeBytes(context.stdout, chunk, signal); return chunk.length; },
    async close() {},
  };
  const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
  const flag = request.creation === "exclusive" ? request.flags.has("append") ? "ax" : "wx" : request.flags.has("append") ? "a" : "w";
  if (!context.fs.writeStream || capabilities.streamingWrite === false) throw new DdError("streaming output: Operation not supported by the filesystem");
  if (request.creation === "exclusive" && capabilities.exclusiveCreate !== true) throw new DdError("exclusive creation: Operation not supported by the filesystem");
  if (request.flags.has("append") && capabilities.streamingAppend === false) throw new DdError("streaming append: Operation not supported by the filesystem");
  const fs = new Proxy(context.fs, { get(target, property) {
    if (property === "writeStream") return (destination: string, source: ByteSource, options: FsOptions) => target.writeStream!(destination, source, { ...options, flag });
    if (property === "appendFile" || property === "writeFile") return () => { throw new FsError("ENOTSUP", { path }); };
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const target = await openFileOutput({ ...context, fs }, path, request.creation === "exclusive" ? { flag: "wx" } : request.flags.has("append") ? "a" : "w");
  let closed: Promise<void> | undefined;
  let failed: { reason: unknown } | undefined;
  const handle: DdFileHandle = {
    async write(chunk) {
      signal.throwIfAborted();
      if (closed) throw new FsError("EBADF");
      try { await target.sink.write(chunk); }
      catch (reason) { failed ??= { reason }; throw reason; }
      return chunk.length;
    },
    close() {
      closed ??= signal.aborted ? target.abort(signal.reason) : failed ? target.abort(failed.reason) : target.finish();
      return closed;
    },
  };
  countedHandles.add(handle);
  return handle;
}
