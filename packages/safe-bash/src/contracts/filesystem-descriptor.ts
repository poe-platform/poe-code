import { FsError } from "poe-code/safe-fs";
import type { FileDescriptor, FsOptions, OpenFileOptions } from "poe-code/safe-fs";
import { assertCountedFileOutput, writeFileOutputCounted, type FileOutputContext } from "./filesystem-output.js";

export interface CommandFileDescriptor extends FileDescriptor {
  acknowledgeCloseFailure(reason: unknown): boolean;
}

export async function openCommandFile(context: FileOutputContext & { readonly cleanupFailurePrioritySignal?: AbortSignal | undefined }, path: string, options: OpenFileOptions): Promise<CommandFileDescriptor> {
  const { cleanupFailurePrioritySignal } = context;
  let descriptor: FileDescriptor | undefined;
  let accepting = true;
  let closing: Promise<void> | undefined;
  let closeFailure: { reason: unknown; acknowledged: boolean; drained: boolean } | undefined;
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
      catch (reason) { closeFailure = { reason, acknowledged: false, drained: false }; throw reason; }
      finally {
        scope?.removeEventListener("abort", aborted);
        if (closeFailure) closeFailure.drained = true;
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
    context.registerCleanup?.(async () => {
      try { await close(); }
      catch (reason) {
        if (!closeFailure?.drained || !closeFailure.acknowledged || !Object.is(reason, closeFailure.reason)) {
          if (cleanupFailurePrioritySignal === undefined) check();
          else cleanupFailurePrioritySignal.throwIfAborted();
          throw reason;
        }
      }
      check();
    });
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
    const position = descriptor.capabilities.position === true && typeof descriptor.getPosition === "function";
    const admitted = Object.freeze({ ...descriptor.capabilities,
      positionedRead: descriptor.capabilities.positionedRead && request.access !== "write",
      positionedWrite: descriptor.capabilities.positionedWrite && request.access !== "read" && !request.append,
      truncate: descriptor.capabilities.truncate && request.access !== "read",
      ...(descriptor.capabilities.position === undefined ? {} : { position }),
    });
    return {
      capabilities: admitted,
      ...(position ? { getPosition: (forwarded: FsOptions = {}) => run("getPosition", forwarded, async (retained, supplied) => {
        if (retained.capabilities.position !== true || typeof retained.getPosition !== "function") throw new FsError("ENOTSUP", { syscall: "getPosition", path });
        const cursor = await retained.getPosition(supplied);
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new FsError("EIO", { syscall: "getPosition", path });
        return cursor;
      }) } : {}),
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
      acknowledgeCloseFailure: (reason: unknown): boolean => {
        if (!closeFailure || !Object.is(reason, closeFailure.reason)) return false;
        if (closeFailure.acknowledged) return true;
        if (context.signal.aborted || scope?.aborted) return false;
        closeFailure.acknowledged = true;
        return true;
      },
    };
  } catch (error) {
    acquisitionSettled();
    try { await close(); } catch {}
    check();
    throw error;
  }
}
