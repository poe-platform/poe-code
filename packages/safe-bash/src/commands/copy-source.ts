import { FsError, type CommandContext, type FileReadHandle, type FileStat } from "../contracts/index.js";
import { compareCopyIdentity } from "./copy-identity.js";

export async function admitCopySource(context: CommandContext, source: string): Promise<void> {
  const capabilities = await context.fs.capabilitiesFor?.(source, { signal: context.signal }) ?? context.fs.capabilities;
  context.signal.throwIfAborted();
  if (!context.fs.openReadFile || capabilities.retainedRead !== true || !context.fs.writeStream) {
    throw new FsError("ENOTSUP", { path: source, message: "copy requires retained reads and streaming writes" });
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
    work = context.fs.writeStream!(target, bytes(), {
      flag: exclusive ? "wx" : "w", signal: context.signal,
      ...(capabilities.permissions === false ? {} : { mode: expected.mode & 0o7777 }),
    });
    await work;
    context.signal.throwIfAborted();
    if (!consumed) throw new FsError("EIO", { path: target, message: "copy writer did not consume source" });
  } finally { acquired(); await close(); }
}
