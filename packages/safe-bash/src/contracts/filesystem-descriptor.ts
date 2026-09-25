import { FsError } from "@poe-code/safe-fs/core";
import type { FileDescriptor, FileDescriptorCapabilities, FsOptions, OpenFileOptions } from "@poe-code/safe-fs/core";
import { assertCountedFileOutput, writeFileOutputCounted, type FileOutputContext } from "./filesystem-output-budget.js";

const managedSignalSymbol = Symbol.for("safe-bash.managedSignal");
const managedWaitersSymbol = Symbol.for("safe-bash.managedWaiters");

export interface CommandFileDescriptor extends FileDescriptor {
  acknowledgeCloseFailure(reason: unknown): boolean;
}

const admittedCommandCapabilitiesCache = new WeakMap<FileDescriptorCapabilities, Map<string, FileDescriptorCapabilities>>();

function getAdmittedCommandCapabilities(descriptorCapabilities: FileDescriptorCapabilities, access: OpenFileOptions["access"], append: boolean | undefined, hasPosition: boolean): FileDescriptorCapabilities {
  let byKey = admittedCommandCapabilitiesCache.get(descriptorCapabilities);
  const key = `${access}:${append ? 1 : 0}:${hasPosition ? 1 : 0}`;
  if (byKey) {
    const cached = byKey.get(key);
    if (cached) return cached;
  } else {
    byKey = new Map();
    admittedCommandCapabilitiesCache.set(descriptorCapabilities, byKey);
  }
  const { delegateZeroLengthWrite, ...retainedCapabilities } = descriptorCapabilities;
  const position = retainedCapabilities.position === true && hasPosition;
  const admitted = Object.freeze({ ...retainedCapabilities,
    positionedRead: retainedCapabilities.positionedRead && access !== "write",
    positionedWrite: retainedCapabilities.positionedWrite && access !== "read"
      && (!append || retainedCapabilities.positionedAppendWrite === true),
    truncate: retainedCapabilities.truncate && access !== "read",
    ...(retainedCapabilities.position === undefined ? {} : { position }),
    ...(retainedCapabilities.positionedAppendWrite === undefined ? {} : {
      positionedAppendWrite: retainedCapabilities.positionedAppendWrite === true
        && retainedCapabilities.positionedWrite && access !== "read",
    }),
    ...(delegateZeroLengthWrite === undefined ? {} : {
      delegateZeroLengthWrite: delegateZeroLengthWrite === true && access !== "read",
    }),
  });
  byKey.set(key, admitted);
  return admitted;
}

/** descriptorCleanup: "caller" requires an already-enrolled owner that drains late
 * acquisitions and closes the returned descriptor; output accounting keeps the
 * original registerCleanup identity in either ownership mode. */
export async function openCommandFile(context: FileOutputContext & { readonly cleanupFailurePrioritySignal?: AbortSignal | undefined; readonly descriptorCleanup?: "caller" }, path: string, options: OpenFileOptions): Promise<CommandFileDescriptor> {
  const { cleanupFailurePrioritySignal } = context;
  let descriptor: FileDescriptor | undefined;
  let accepting = true;
  let acquiring = true;
  let closing: Promise<void> | undefined;
  let closeFailure: { reason: unknown; acknowledged: boolean; drained: boolean } | undefined;
  let work: Promise<void> = Promise.resolve();
  let acquisitionSettled: (() => void) | undefined;
  let acquired: Promise<void> | undefined;
  const settleAcquisition = (): void => {
    acquiring = false;
    acquisitionSettled?.();
  };
  let scope: AbortSignal | undefined;
  let scopeWaiters: Set<(reason: unknown) => void> | undefined;
  const close = (): Promise<void> => {
    accepting = false;
    closing ??= (async () => {
      if (acquiring) {
        acquired ??= new Promise<void>(resolve => { acquisitionSettled = resolve; });
        await acquired;
      }
      await work;
      const retained = descriptor;
      descriptor = undefined;
      try { await retained?.close(); }
      catch (reason) { closeFailure = { reason, acknowledged: false, drained: false }; throw reason; }
      finally {
        if (scopeWaiters) scopeWaiters.delete(aborted);
        else scope?.removeEventListener("abort", aborted);
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
  let defaultFsOptions!: { signal: AbortSignal };
  const run = <Result>(syscall: string, forwarded: FsOptions,
    action: (retained: FileDescriptor, options: FsOptions) => Promise<Result>): Promise<Result> => {
    const signal = forwarded.signal;
    try {
      check(signal);
      if (!accepting) throw new FsError("EBADF", { syscall, path });
    } catch (error) { return Promise.reject(error); }
    const operation = work.then(async () => {
      check(signal);
      const supplied = signal ? { signal: AbortSignal.any([scope!, signal]) } : defaultFsOptions;
      try {
        const result = await action(descriptor!, supplied);
        if (syscall !== "write" || !context.preserveWriteReceipt) check(signal);
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
    if (context.descriptorCleanup !== "caller") context.registerCleanup?.(async () => {
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
    if ((scope as unknown as Record<symbol, unknown>)[managedSignalSymbol]) {
      const rec = scope as unknown as Record<symbol, ((reason: unknown) => void) | Set<(reason: unknown) => void> | undefined>;
      const cur = rec[managedWaitersSymbol];
      scopeWaiters = typeof cur === "function" ? (rec[managedWaitersSymbol] = new Set([cur])) : (cur ?? (rec[managedWaitersSymbol] = new Set()));
      scopeWaiters.add(aborted);
    } else {
      scope.addEventListener("abort", aborted, { once: true });
    }
    check();
    if (!accepting) throw new FsError("EBADF", { syscall: "open", path });
    if (request.access !== "read") assertCountedFileOutput(context);
    const fsOptions = { signal: scope };
    defaultFsOptions = fsOptions;
    // Final-symlink admission belongs to the enforcing open, including dangling
    // and self-loop links that a following capability query cannot resolve.
    const capabilities = request.noFollow || request.creation === "exclusive" ? context.fs.capabilities
      : await context.fs.capabilitiesFor?.(path, { ...fsOptions, ...(request.creation === "ifMissing" ? { create: true } : {}) }) ?? context.fs.capabilities;
    check();
    if (!accepting) throw new FsError("EBADF", { syscall: "open", path });
    if (!context.fs.open || capabilities?.open === false) throw new FsError("ENOTSUP", { syscall: "open", path });
    descriptor = await context.fs.open(path, { ...request, signal: scope });
    settleAcquisition();
    check();
    if (!accepting) throw new FsError("EBADF", { syscall: "open", path });
    const descriptorCaps = descriptor.capabilities;
    const hasGetPosition = typeof descriptor.getPosition === "function";
    const position = descriptorCaps.position === true && hasGetPosition;
    const probeRead = descriptorCaps.readObservation === true ? descriptor.probeRead : undefined;
    if (descriptorCaps.readObservation === true && typeof probeRead !== "function") throw new FsError("ENOTSUP", { syscall: "probeRead", path });
    const admitted = Object.isFrozen(descriptorCaps)
      ? getAdmittedCommandCapabilities(descriptorCaps, request.access, request.append, hasGetPosition)
      : (() => {
          const { delegateZeroLengthWrite, ...retainedCapabilities } = descriptorCaps;
          return Object.freeze({ ...retainedCapabilities,
            positionedRead: retainedCapabilities.positionedRead && request.access !== "write",
            positionedWrite: retainedCapabilities.positionedWrite && request.access !== "read"
              && (!request.append || retainedCapabilities.positionedAppendWrite === true),
            truncate: retainedCapabilities.truncate && request.access !== "read",
            ...(retainedCapabilities.position === undefined ? {} : { position }),
            ...(retainedCapabilities.positionedAppendWrite === undefined ? {} : {
              positionedAppendWrite: retainedCapabilities.positionedAppendWrite === true
                && retainedCapabilities.positionedWrite && request.access !== "read",
            }),
            ...(delegateZeroLengthWrite === undefined ? {} : {
              delegateZeroLengthWrite: delegateZeroLengthWrite === true && request.access !== "read",
            }),
          });
        })();
    check();
    if (!accepting) throw new FsError("EBADF", { syscall: "open", path });
    return {
      capabilities: admitted,
      ...(probeRead === undefined ? {} : { probeRead: (forwarded: FsOptions = {}) => run("probeRead", forwarded, async (retained, supplied) => {
        const readiness = await probeRead.call(retained, supplied);
        if (readiness !== "ready" && readiness !== "blocked" && readiness !== "unknown") throw new FsError("EIO", { syscall: "probeRead", path });
        return readiness;
      }) }),
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
        return writeFileOutputCounted(supplied.signal === context.signal ? context : { ...context, signal: supplied.signal! }, buffer, () => retained.write(buffer, position, supplied));
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
    settleAcquisition();
    try { await close(); } catch {}
    check();
    throw error;
  }
}
