import { collectBytes, dirname, FsError, type CommandContext, type FileReadHandle, type FileStat, type FileSystemCapabilities } from "../contracts/index.js";
import { compareCopyIdentity } from "./copy-identity.js";
import { codeOf } from "./internal.js";

export async function admitCopySource(context: CommandContext, source: string): Promise<void> {
  const capabilities = await context.fs.capabilitiesFor?.(source, { signal: context.signal }) ?? context.fs.capabilities;
  context.signal.throwIfAborted();
  if (!context.fs.openReadFile || capabilities.retainedRead !== true) {
    throw new FsError("ENOTSUP", { path: source, message: "copy requires retained reads" });
  }
}

function selectCopyDestination(context: CommandContext, target: string, capabilities: FileSystemCapabilities, exclusive: boolean): "stream" | "buffer" {
  if (capabilities.readOnly === true) throw new FsError("EROFS", { path: target });
  if (context.fs.writeStream && capabilities.streamingWrite !== false) return "stream";
  if (exclusive && capabilities.exclusiveCreate === true) return "buffer";
  throw new FsError("ENOTSUP", { path: target, message: "copy requires streaming writes or exclusive creation" });
}

export async function admitCopyDestination(context: CommandContext, target: string, exclusive: boolean): Promise<"stream" | "buffer"> {
  let candidate = target;
  while (true) {
    try {
      const capabilities = await context.fs.capabilitiesFor?.(candidate, {
        signal: context.signal, ...(exclusive ? { creation: "exclusive" as const } : {}),
      }) ?? context.fs.capabilities;
      context.signal.throwIfAborted();
      return selectCopyDestination(context, target, capabilities, exclusive);
    } catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) !== "ENOENT" || candidate === "/") throw error;
      candidate = dirname(candidate);
    }
  }
}

export async function copyCheckedSource(context: CommandContext, source: string, target: string,
  expected: FileStat, exclusive: boolean): Promise<void> {
  let acquisition: Promise<FileReadHandle> | undefined;
  let closing: Promise<void> | undefined;
  let work: Promise<void> | undefined;
  let accepting = true;
  let acquired!: () => void;
  const acquisitionSettled = new Promise<void>(resolve => { acquired = resolve; });
  const close = (): Promise<void> => {
    accepting = false;
    return closing ??= (async () => {
      await acquisitionSettled;
      const reader = await acquisition?.catch(() => undefined);
      await work?.catch(() => undefined);
      await reader?.close();
    })();
  };
  let primaryError: unknown;
  context.registerCleanup?.(close);
  try {
    context.signal.throwIfAborted();
    if (!accepting) throw new FsError("EBADF", { path: source });
    acquisition = context.fs.openReadFile!(source, { signal: context.signal });
    const reader = await acquisition;
    acquired();
    context.signal.throwIfAborted();
    if (!accepting) throw new FsError("EBADF", { path: source });
    const observation = reader.stat({ signal: context.signal });
    work = observation.then(() => {}, () => {});
    const retained = await observation;
    context.signal.throwIfAborted();
    if (!accepting) throw new FsError("EBADF", { path: source });
    const identity = compareCopyIdentity(expected, retained);
    if (identity !== "same") throw new FsError(identity === "distinct" ? "EBUSY" : "ENOTSUP", {
      path: source, message: "copy reader is not bound to the inspected source identity",
    });
    const capabilityQuery = Promise.resolve(context.fs.capabilitiesFor?.(target, {
      signal: context.signal, ...(exclusive ? { creation: "exclusive" as const } : {}),
    }) ?? context.fs.capabilities);
    work = capabilityQuery.then(() => {}, () => {});
    const capabilities = await capabilityQuery;
    context.signal.throwIfAborted();
    if (!accepting) throw new FsError("EBADF", { path: source });
    let consumed = false;
    const bytes = async function* () {
      let position = 0;
      while (true) {
        context.signal.throwIfAborted();
        const chunk = await reader.read(position, 64 * 1024, { signal: context.signal });
        if (!chunk.length) { consumed = true; return; }
        position += chunk.length;
        yield chunk;
      }
    };
    const options = {
      flag: exclusive ? "wx" as const : "w" as const, signal: context.signal,
      ...(capabilities.permissions === true ? { mode: expected.mode & 0o7777 } : {}),
    };
    if (selectCopyDestination(context, target, capabilities, exclusive) === "buffer") {
      const size = retained.size;
      const maxMemoryBytes = size * 3 + 64 * 1024;
      if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(maxMemoryBytes)) {
        throw new FsError("EFBIG", { path: source, message: "copy source exceeds bounded collection capacity" });
      }
      context.inputBudget?.check(size);
      if (size > (context.inputBudget?.maxBytes ?? Infinity)) throw new FsError("EFBIG", {
        path: source, message: "copy source exceeds input budget",
      });
      work = (async () => {
        const data = await collectBytes(bytes(), { maxBytes: size, maxMemoryBytes, signal: context.signal });
        context.signal.throwIfAborted();
        if (!accepting) throw new FsError("EBADF", { path: source });
        if (data.byteLength !== size) throw new FsError("EBUSY", { path: source, message: "copy source size changed" });
        await context.fs.writeFile(target, data, { ...options, flag: "wx" });
      })();
    } else work = context.fs.writeStream!(target, bytes(), options);
    await work;
    context.signal.throwIfAborted();
    if (!consumed) throw new FsError("EIO", { path: target, message: "copy writer did not consume source" });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    acquired();
    try {
      await close();
    } catch (closeError) {
      if (primaryError === undefined) throw closeError;
      closing = Promise.resolve();
    }
  }
}
