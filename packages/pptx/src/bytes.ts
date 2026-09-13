import type {
  BinaryInput,
  ByteContext,
  ByteLimits,
  ByteSink,
  ByteSource,
  ReadOptions,
  WriteOptions
} from "./contracts.js";
import { OfficeError } from "./errors.js";

function admitLimits(context: ByteContext, options: ReadOptions, output: boolean): ByteLimits {
  if (!context || !context.limits || !options || typeof options !== "object") {
    throw new OfficeError("invalid-type", "Explicit byte limits are required.", "usage");
  }
  for (const key of Object.keys(options)) {
    if (!["maxBytes", "chunkBytes", output ? "close" : "maxReads"].includes(key)) {
      throw new OfficeError("invalid-value", "Unknown byte option.", "usage");
    }
  }
  const limits = { ...context.limits };
  for (const key of ["maxBytes", "maxReads", "chunkBytes"] as const) {
    const ceiling = context.limits[key];
    const value = options[key] === undefined ? ceiling : options[key];
    if (
      !Number.isSafeInteger(ceiling) ||
      ceiling < 1 ||
      !Number.isSafeInteger(value) ||
      value < 1
    ) {
      throw new OfficeError(
        "invalid-value",
        "Byte limits must be positive safe integers.",
        "usage"
      );
    }
    if (value > ceiling) {
      throw new OfficeError("resource-limit", "Byte option exceeds its host ceiling.", "usage");
    }
    limits[key] = value;
  }
  return limits;
}

function checkCancellation(signal: AbortSignal | undefined, phase: "admit" | "publish"): void {
  if (signal?.aborted) throw new OfficeError("cancelled", "Operation cancelled.", phase);
}

export async function readBinary(
  input: BinaryInput,
  context: ByteContext,
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
  if (!input || typeof input !== "object") {
    throw new OfficeError(
      "invalid-type",
      "Expected bytes or an explicit input capability.",
      "usage"
    );
  }
  let source: ByteSource;
  if ("path" in input) {
    if (
      typeof input.path !== "string" ||
      input.path.length === 0 ||
      !input.capability ||
      typeof input.capability.openRead !== "function"
    ) {
      throw new OfficeError("invalid-type", "Expected a capability-scoped path.", "usage");
    }
    try {
      source = await input.capability.openRead(input.path, signal);
    } catch {
      checkCancellation(signal, "admit");
      throw new OfficeError("io-failure", "Byte input failed.", "admit");
    }
    checkCancellation(signal, "admit");
  } else {
    source = input;
  }
  if (!source || typeof source.read !== "function") {
    throw new OfficeError("invalid-type", "Expected a byte source.", "admit");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let reads = 0; reads < limits.maxReads; reads++) {
    checkCancellation(signal, "admit");
    const request = Math.min(limits.chunkBytes, Math.max(1, limits.maxBytes - size));
    let chunk: Uint8Array | null;
    try {
      chunk = await source.read(request, signal);
    } catch {
      checkCancellation(signal, "admit");
      throw new OfficeError("io-failure", "Byte input failed.", "admit");
    }
    checkCancellation(signal, "admit");
    if (chunk === null) {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const retained of chunks) {
        bytes.set(retained, offset);
        offset += retained.byteLength;
      }
      return bytes;
    }
    if (!(chunk instanceof Uint8Array)) {
      throw new OfficeError("invalid-type", "Byte source returned an invalid chunk.", "admit");
    }
    if (chunk.byteLength > request || chunk.byteLength > limits.maxBytes - size) {
      throw new OfficeError("resource-limit", "Byte input exceeds its limit.", "admit");
    }
    if (chunk.byteLength > 0) {
      chunks.push(new Uint8Array(chunk));
      size += chunk.byteLength;
    }
  }
  throw new OfficeError("resource-limit", "Byte source exceeded its read limit.", "admit");
}

export async function writeBinary(
  bytes: Uint8Array,
  sink: ByteSink,
  context: ByteContext,
  options: WriteOptions = {}
): Promise<void> {
  const limits = admitLimits(context, options, true);
  const signal = context.signal;
  if (
    !(bytes instanceof Uint8Array) ||
    !sink ||
    typeof sink.write !== "function" ||
    typeof sink.close !== "function"
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
    if (close) await sink.close();
    checkCancellation(signal, "publish");
  } catch {
    checkCancellation(signal, "publish");
    throw new OfficeError("io-failure", "Byte output failed.", "publish");
  }
}
