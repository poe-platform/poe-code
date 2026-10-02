import type {
  BinaryInput,
  ByteContext,
  ByteLimits,
  ByteSink,
  ByteSource,
  ReadOptions,
  WriteOptions
} from "./contracts.js";
import { OfficeError, PackageNotFoundError } from "./errors.js";
import { resourceContext } from "./resource-limits.js";

function admitLimits(context: ByteContext, options: ReadOptions, output: boolean): ByteLimits {
  if (!context || !options || typeof options !== "object") {
    throw new OfficeError("invalid-type", "Explicit byte limits are required.", "usage");
  }
  for (const key of Object.keys(options)) {
    if (!["maxBytes", "chunkBytes", output ? "close" : "maxReads"].includes(key)) {
      throw new OfficeError("invalid-value", "Unknown byte option.", "usage");
    }
  }
  const limits = { ...resourceContext(context).limits };
  for (const key of ["maxBytes", "maxReads", "chunkBytes"] as const) {
    const value = options[key] === undefined ? limits[key] : options[key];
    if (
      (value !== Infinity && !Number.isSafeInteger(value)) ||
      (key === "chunkBytes" && !Number.isSafeInteger(value)) ||
      value < 1
    ) {
      throw new OfficeError(
        "invalid-value",
        "Byte limits must be positive safe integers.",
        "usage"
      );
    }
    limits[key] = value;
  }
  return limits;
}

function checkCancellation(signal: AbortSignal | undefined, phase: "admit" | "publish"): void {
  if (signal?.aborted) throw new OfficeError("cancelled", "Operation cancelled.", phase);
}

export function binarySource(
  input: Exclude<BinaryInput, Uint8Array>,
  signal: AbortSignal | undefined,
  maxBytes: number
): ByteSource {
  if (!input || typeof input !== "object") {
    throw new OfficeError(
      "invalid-type",
      "Expected bytes or an explicit input capability.",
      "usage"
    );
  }
  if ("path" in input) {
    if (
      typeof input.path !== "string" ||
      input.path.length === 0 ||
      !input.fs ||
      typeof input.fs.readFile !== "function"
    ) {
      throw new OfficeError("invalid-type", "Expected a capability-scoped path.", "usage");
    }
    return (async function* () {
      const options = { maxBytes, ...(signal === undefined ? {} : { signal }) };
      if (input.fs.readStream) {
        let emitted = false;
        try {
          for await (const chunk of input.fs.readStream(input.path, options)) {
            if (chunk.byteLength) emitted = true;
            yield chunk;
          }
          return;
        } catch (error) {
          checkCancellation(signal, "admit");
          if (
            emitted ||
            !error ||
            typeof error !== "object" ||
            !("code" in error) ||
            error.code !== "ENOTSUP"
          )
            throw error;
        }
      }
      yield await input.fs.readFile(input.path, options);
    })();
  }
  if (typeof input[Symbol.asyncIterator] !== "function") {
    throw new OfficeError("invalid-type", "Expected a byte source.", "admit");
  }
  return input;
}

export async function readBinary(
  input: BinaryInput,
  context: ByteContext = {},
  options: ReadOptions = {}
): Promise<Uint8Array> {
  const limits = admitLimits(context, options, false);
  const signal = context.signal;
  checkCancellation(signal, "admit");
  if (input instanceof Uint8Array) {
    if (input.byteLength > limits.maxBytes) {
      throw new OfficeError("resource-limit", "Byte input exceeds its limit.", "admit");
    }
    return new Uint8Array(input);
  }
  const source = binarySource(input, signal, limits.maxBytes);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let iterator: AsyncIterator<Uint8Array>;
  try {
    iterator = source[Symbol.asyncIterator]();
  } catch {
    checkCancellation(signal, "admit");
    throw new OfficeError("io-failure", "Byte input failed.", "admit");
  }
  let exhausted = false;
  try {
    for (let reads = 0; reads < limits.maxReads; reads++) {
      checkCancellation(signal, "admit");
      let item: IteratorResult<Uint8Array>;
      try {
        item = await iterator.next();
      } catch (error) {
        checkCancellation(signal, "admit");
        if (error && typeof error === "object" && "code" in error) {
          if (error.code === "ENOENT") throw new PackageNotFoundError();
          if (error.code === "EFBIG")
            throw new OfficeError("resource-limit", "Byte input exceeds its limit.", "admit");
        }
        throw new OfficeError("io-failure", "Byte input failed.", "admit");
      }
      checkCancellation(signal, "admit");
      if (item.done) {
        exhausted = true;
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const retained of chunks) {
          bytes.set(retained, offset);
          offset += retained.byteLength;
        }
        return bytes;
      }
      const chunk = item.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new OfficeError("invalid-type", "Byte source returned an invalid chunk.", "admit");
      }
      if (chunk.byteLength > limits.maxBytes - size) {
        throw new OfficeError("resource-limit", "Byte input exceeds its limit.", "admit");
      }
      if (chunk.byteLength > 0) {
        chunks.push(new Uint8Array(chunk));
        size += chunk.byteLength;
      }
    }
    throw new OfficeError("resource-limit", "Byte source exceeded its read limit.", "admit");
  } finally {
    if (!exhausted) {
      // Cleanup must not replace the admission failure or leak host diagnostics.
      try {
        await iterator.return?.();
      } catch {
        /* primary failure wins */
      }
    }
  }
}

export async function writeBinary(
  bytes: Uint8Array,
  sink: ByteSink,
  context: ByteContext = {},
  options: WriteOptions = {}
): Promise<void> {
  const limits = admitLimits(context, options, true);
  const signal = context.signal;
  if (
    !(bytes instanceof Uint8Array) ||
    !sink ||
    typeof sink.write !== "function" ||
    (sink.close !== undefined && typeof sink.close !== "function")
  ) {
    throw new OfficeError("invalid-type", "Expected bytes and an explicit byte sink.", "usage");
  }
  if (options.close !== undefined && typeof options.close !== "boolean") {
    throw new OfficeError("invalid-type", "Close must be a boolean.", "usage");
  }
  const close = options.close === true;
  checkCancellation(signal, "publish");
  if (bytes.byteLength > limits.maxBytes) {
    throw new OfficeError("resource-limit", "Byte output exceeds its limit.", "publish");
  }
  const owned = new Uint8Array(bytes);
  try {
    for (let offset = 0; offset < owned.byteLength; offset += limits.chunkBytes) {
      checkCancellation(signal, "publish");
      await sink.write(owned.slice(offset, offset + limits.chunkBytes), signal);
      checkCancellation(signal, "publish");
    }
    if (close) await sink.close?.();
    checkCancellation(signal, "publish");
  } catch {
    checkCancellation(signal, "publish");
    throw new OfficeError("io-failure", "Byte output failed.", "publish");
  }
}
