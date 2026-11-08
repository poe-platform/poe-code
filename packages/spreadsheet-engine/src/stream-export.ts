import { SsconvertError, type ByteSource, type CapabilityContext, type Destination, type FileOutput } from "./contracts.js";
import { CodecWriteFailure } from "./codecs/write-failure.js";
import { ioFailure } from "./io-errors.js";
import { resourceUri } from "./resource-uri.js";

/** One borrowed codec chunk in flight; output transactions publish only after EOF. */
export async function publishExportStream(acquire: () => ByteSource, destination: Destination, output: FileOutput | undefined,
  context: CapabilityContext, maximumBytes: number, check: () => void): Promise<number> {
  let bytes = 0, work = 0, complete = false, sourceComplete = false;
  let iterator: AsyncIterator<Uint8Array> | Iterator<Uint8Array> | undefined;
  let closed: Promise<void> | undefined;
  let exportFailure: CodecWriteFailure | undefined;
  const close = () => closed ??= Promise.resolve().then(async () => { if (!sourceComplete) await iterator?.return?.(); });
  context.own(close);
  const measured = (async function* () {
    check();
    const source = acquire();
    iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
    while (true) {
      check();
      let next: IteratorResult<Uint8Array>;
      try { next = await iterator.next(); }
      catch (error) {
        if (!(error instanceof CodecWriteFailure)) throw error;
        exportFailure = error;
        next = { done: false, value: error.bytes };
      }
      check();
      if (next.done) { sourceComplete = true; complete = true; break; }
      if (++work > (context.limits.workbookWork ?? Infinity))
        throw new SsconvertError("resource-limit", "ssconvert output chunks limit exceeded");
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) throw new TypeError("ssconvert exporter chunks must be Uint8Array");
      if (!Number.isSafeInteger(bytes + chunk.byteLength) || chunk.byteLength > maximumBytes - bytes)
        throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
      bytes += chunk.byteLength;
      // Bound each downstream write, including when an optional legacy writer emits a large chunk.
      for (let offset = 0; offset < chunk.byteLength; offset += 64 * 1024) {
        check();
        yield chunk.subarray(offset, offset + 64 * 1024);
        check();
      }
      if (exportFailure) { complete = true; break; }
    }
  })();
  try {
    if (destination.kind === "stream") {
      for await (const chunk of measured) { await destination.sink.write(chunk); check(); }
    } else {
      await output!.writeStream!(measured);
    }
    check();
    if (!complete) throw new SsconvertError("io", "ssconvert output returned without consuming the exporter");
    await close();
    check();
    await output?.close();
    check();
  } catch (error) {
    const failures: unknown[] = [error];
    try { await measured.return(); await close(); } catch (cleanup) { if (cleanup !== error) failures.push(cleanup); }
    try { await output?.abort(); } catch (cleanup) { if (cleanup !== error) failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, "ssconvert export and cleanup failed");
    check();
    if (destination.kind === "resource") ioFailure(error, resourceUri(destination.uri, context.environment.cwd ?? context.environment.env.PWD ?? "/"), "write");
    throw error;
  }
  if (exportFailure) throw exportFailure;
  return bytes;
}
