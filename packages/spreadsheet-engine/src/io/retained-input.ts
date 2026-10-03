import type { FileSystem, FileReadHandle } from "@poe-code/safe-fs/core";
import { SsconvertError, type CapabilityContext, type RangeSource } from "../contracts.js";
import { ioFailure } from "../io-errors.js";

/** A retained resource can be decoded without copying it into writable scratch.
 * The handle keeps its original object identity even if its pathname is replaced. */
export function createVfsInput(fs: Pick<FileSystem, "capabilities" | "capabilitiesFor" | "openReadFile">) {
  return async (filename: string, context: CapabilityContext): Promise<RangeSource | undefined> => {
    const signal = context.signal;
    signal.throwIfAborted();
    const capabilities = await fs.capabilitiesFor?.(filename, { signal }) ?? fs.capabilities;
    signal.throwIfAborted();
    if (capabilities.retainedRead !== true || !fs.openReadFile) return undefined;
    const acquisition: { pending?: Promise<FileReadHandle> } = {};
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      const handle = await acquisition.pending?.catch(() => undefined);
      await handle?.close();
    })();
    const check = () => {
      signal.throwIfAborted();
      if (closing) throw new SsconvertError("invalid-request", "ssconvert file input is closed");
    };
    context.own(close);
    acquisition.pending = Promise.resolve().then(() => { check(); return fs.openReadFile!(filename, { signal }); });
    const handle = await acquisition.pending;
    check();
    const stat = await handle.stat({ signal });
    check();
    if (stat.type !== "file") { await close(); return undefined; }
    return {
      size: stat.size,
      async read(position, maximum, options = {}) {
        check();
        const operationSignal = options.signal && options.signal !== signal ? AbortSignal.any([signal, options.signal]) : signal;
        try {
          const bytes = await handle.read(position, Math.min(maximum, 16384), { signal: operationSignal });
          check(); operationSignal.throwIfAborted();
          return bytes;
        } catch (error) { check(); operationSignal.throwIfAborted(); ioFailure(error, filename, "read"); }
      }
    };
  };
}
