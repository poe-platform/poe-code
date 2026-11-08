import { dirname, FsError, type CommandContext, type FileReadHandle, type FileStat, type FileSystemCapabilities } from "safe-bash-contracts";
import { compareCopyIdentity } from "safe-bash-contracts/filesystem-identity";
import { codeOf } from "../internal.js";

export async function admitCopySource(context: CommandContext, source: string): Promise<void> {
  const capabilities = await context.fs.capabilitiesFor?.(source, { signal: context.signal }) ?? context.fs.capabilities;
  context.signal.throwIfAborted();
  if (!context.fs.openReadFile || capabilities.retainedRead !== true) {
    throw new FsError("ENOTSUP", { path: source, message: "copy requires retained reads" });
  }
}

function selectCopyDestination(context: CommandContext, target: string, capabilities: FileSystemCapabilities, exclusive: boolean): "stream" | "descriptor" {
  if (capabilities.readOnly === true) throw new FsError("EROFS", { path: target });
  if (context.fs.writeStream && capabilities.streamingWrite !== false) return "stream";
  if (exclusive && capabilities.exclusiveCreate === true && capabilities.open === true && capabilities.randomAccessWrite === true && context.fs.open) return "descriptor";
  throw new FsError("ENOTSUP", { path: target, message: "copy requires streaming writes or exclusive retained descriptor writes" });
}

export async function admitCopyDestination(context: CommandContext, target: string, exclusive: boolean): Promise<"stream" | "descriptor"> {
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
  let destination: Awaited<ReturnType<NonNullable<CommandContext["fs"]["open"]>>> | undefined;
  let closing: Promise<void> | undefined;
  let work: Promise<void> | undefined;
  let reading: Promise<Uint8Array> | undefined;
  let accepting = true;
  let acquired!: () => void;
  const acquisitionSettled = new Promise<void>(resolve => { acquired = resolve; });
  const close = (): Promise<void> => {
    accepting = false;
    return closing ??= (async () => {
      await acquisitionSettled;
      const reader = await acquisition?.catch(() => undefined);
      await work?.catch(() => undefined);
      // Drain the admitted read before releasing the retained source.
      await reading?.catch(() => undefined);
      try { await destination?.close(); }
      finally { await reader?.close(); }
    })();
  };
  let failed = false;
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
        reading = Promise.resolve().then(() => {
          context.signal.throwIfAborted();
          if (!accepting) throw new FsError("EBADF", { path: source });
          return reader.read(position, 64 * 1024, { signal: context.signal });
        });
        const chunk = await reading;
        context.signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || chunk.byteLength > 65536) throw new FsError("EIO", { path: source, message: "invalid retained read size" });
        if (!chunk.length) {
          if (destination && position !== retained.size) throw new FsError("EBUSY", { path: source, message: "copy source size changed" });
          consumed = true; return;
        }
        if (destination && chunk.length > retained.size - position) throw new FsError("EBUSY", { path: source, message: "copy source size changed" });
        position += chunk.length;
        context.inputBudget?.check(position);
        if (position > (context.inputBudget?.maxBytes ?? Infinity)) throw new FsError("EFBIG", {
          path: source, message: "copy source exceeds input budget",
        });
        yield chunk;
      }
    };
    const options = {
      flag: exclusive ? "wx" as const : "w" as const, signal: context.signal,
      ...(capabilities.permissions === true ? { mode: expected.mode & 0o7777 } : {}),
    };
    if (selectCopyDestination(context, target, capabilities, exclusive) === "descriptor") {
      const size = retained.size;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new FsError("EFBIG", { path: source, message: "copy source exceeds bounded collection capacity" });
      }
      context.inputBudget?.check(size);
      if (size > (context.inputBudget?.maxBytes ?? Infinity)) throw new FsError("EFBIG", {
        path: source, message: "copy source exceeds input budget",
      });
      work = (async () => {
        destination = await context.fs.open!(target, { access: "write", creation: "exclusive", signal: context.signal,
          ...(options.mode === undefined ? {} : { mode: options.mode }),
        });
        for await (const chunk of bytes()) {
          let offset = 0;
          while (offset < chunk.length) {
            context.signal.throwIfAborted();
            if (!accepting) throw new FsError("EBADF", { path: source });
            const count = await destination.write(chunk.subarray(offset), null, { signal: context.signal });
            if (!Number.isSafeInteger(count) || count <= 0 || count > chunk.length - offset) throw new FsError("EIO", { path: target });
            offset += count;
          }
        }
      })();
    } else work = context.fs.writeStream!(target, bytes(), options);
    await work;
    context.signal.throwIfAborted();
    if (!consumed) throw new FsError("EIO", { path: target, message: "copy writer did not consume source" });
  } catch (error) {
    failed = true;
    primaryError = context.signal.aborted ? context.signal.reason : error;
  }
  acquired();
  try {
    await close();
  } catch (closeError) {
    if (!failed) throw closeError;
    closing = Promise.resolve();
  }
  if (failed) throw primaryError;
}
