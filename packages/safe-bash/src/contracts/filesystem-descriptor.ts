import { FsError } from "poe-code/safe-fs";
import type { FileDescriptor, FsOptions, OpenFileOptions } from "poe-code/safe-fs";
import { assertCountedFileOutput, writeFileOutputCounted, type FileOutputContext } from "./filesystem-output.js";

export async function openCommandFile(context: FileOutputContext, path: string, options: OpenFileOptions): Promise<FileDescriptor> {
  let descriptor: FileDescriptor | undefined;
  let accepting = true;
  let closing: Promise<void> | undefined;
  let work: Promise<void> = Promise.resolve();
  let acquisitionSettled!: () => void;
  const acquired = new Promise<void>(resolve => { acquisitionSettled = resolve; });
  let scope: AbortSignal | undefined;
  const close = (): Promise<void> => {
    accepting = false;
    closing ??= (async () => {
      await acquired;
      await work;
      const retained = descriptor;
      descriptor = undefined;
      try { await retained?.close(); }
      finally {
        scope?.removeEventListener("abort", aborted);
      }
    })();
    void closing.catch(() => {});
    return closing;
  };
  const aborted = (): void => { void close().catch(() => {}); };
  const check = (signal?: AbortSignal): void => {
    context.signal.throwIfAborted();
    scope?.throwIfAborted();
    signal?.throwIfAborted();
  };
  const run = <Result>(syscall: string, forwarded: FsOptions,
    action: (retained: FileDescriptor, options: FsOptions) => Promise<Result>): Promise<Result> => {
    const signal = forwarded.signal;
    try {
      check(signal);
      if (!accepting) throw new FsError("EBADF", { syscall, path });
    } catch (error) { return Promise.reject(error); }
    const operation = work.then(async () => {
      check(signal);
      const local = signal ? AbortSignal.any([scope!, signal]) : scope!;
      try {
        const result = await action(descriptor!, { signal: local });
        check(signal);
        return result;
      } catch (error) {
        check(signal);
        throw error;
      }
    });
    work = operation.then(() => {}, () => {});
    return operation;
  };
  try {
    context.registerCleanup?.(close);
    const request = { ...options };
    scope = request.signal ? AbortSignal.any([context.signal, request.signal]) : context.signal;
    scope.addEventListener("abort", aborted, { once: true });
    check();
    if (!accepting) throw new FsError("EBADF", { syscall: "open", path });
    if (request.access !== "read") assertCountedFileOutput(context);
    const fsOptions = { signal: scope };
    const capabilities = await context.fs.capabilitiesFor?.(path, fsOptions) ?? context.fs.capabilities;
    check();
    if (!accepting) throw new FsError("EBADF", { syscall: "open", path });
    if (!context.fs.open || capabilities.open === false) throw new FsError("ENOTSUP", { syscall: "open", path });
    descriptor = await context.fs.open(path, { ...request, signal: scope });
    acquisitionSettled();
    check();
    if (!accepting) throw new FsError("EBADF", { syscall: "open", path });
    const admitted = Object.freeze({ ...descriptor.capabilities,
      positionedRead: descriptor.capabilities.positionedRead && request.access !== "write",
      positionedWrite: descriptor.capabilities.positionedWrite && request.access !== "read" && !request.append,
      truncate: descriptor.capabilities.truncate && request.access !== "read",
    });
    return {
      capabilities: admitted,
      stat: (forwarded = {}) => run("fstat", forwarded, (retained, supplied) => retained.stat(supplied)),
      read: (buffer, position, forwarded = {}) => run("read", forwarded, async (retained, supplied) => {
        if (request.access === "write") throw new FsError("EBADF", { syscall: "read", path });
        return retained.read(buffer, position, supplied);
      }),
      write: (buffer, position, forwarded = {}) => run("write", forwarded, async (retained, supplied) => {
        if (request.access === "read") throw new FsError("EBADF", { syscall: "write", path });
        return writeFileOutputCounted({ ...context, signal: supplied.signal! }, buffer, () => retained.write(buffer, position, supplied));
      }),
      truncate: (length, forwarded = {}) => run("ftruncate", forwarded, async (retained, supplied) => {
        if (request.access === "read") throw new FsError("EBADF", { syscall: "ftruncate", path });
        await retained.truncate(length, supplied);
      }),
      sync: (dataOnly, forwarded = {}) => run(dataOnly ? "fdatasync" : "fsync", forwarded, (retained, supplied) => retained.sync(dataOnly, supplied)),
      close,
    };
  } catch (error) {
    acquisitionSettled();
    try { await close(); } catch {}
    check();
    throw error;
  }
}
