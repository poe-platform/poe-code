import { inheritYieldCheckpoint, yieldTurn } from "../../../contracts/yield.js";
import { FsError, readBytes, type ByteSource } from "../../../contracts/index.js";
import type { CompressionOptions } from "./options.js";
import { zstdDecode } from "./zstd-decode.js";
import { gunzipMembers } from "./gunzip.js";
import { codec, CodecReader } from "./codec.js";
import { boundedCodec, type BoundedCodecOptions } from "./bounded-codec.js";

export const chunkBytes = 64 * 1024;
export const stagingLimit = Infinity;

async function* passthroughStream(reader: InstanceType<typeof CodecReader>, options: BoundedCodecOptions, signal: AbortSignal): ByteSource {
  const header = new Uint8Array(options.format === "xz" ? 13 : 4);
  let length = 0;
  while (length < header.length) {
    const bytes = await reader.chunk();
    if (!bytes) break;
    const count = Math.min(bytes.length, header.length - length);
    header.set(bytes.subarray(0, count), length);
    length += count;
    reader.restore(bytes.subarray(count));
  }
  // Probe once: force may copy unknown input, never recover from a codec failure.
  const view = new DataView(header.buffer);
  let recognized: boolean;
  if (options.format === "bzip2") {
    const magic = [0x42, 0x5a, 0x68];
    recognized = magic.every((byte, index) => index >= length || header[index] === byte) &&
      (length < 4 || (header[3]! >= 0x31 && header[3]! <= 0x39));
  } else if (options.format === "xz") {
    recognized = options.xzFormat !== "lzma" && length >= 6 && [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0].every((byte, index) => header[index] === byte);
    if (!recognized && length === 13 && options.xzFormat !== "xz") {
      // XZ auto-detection also recognizes legacy LZMA headers. Unsupported or
      // damaged recognized streams must still fail rather than become plaintext.
      const properties = header[0]!;
      const dictionary = view.getUint32(1, true);
      const dictionaryBase = dictionary % 3 === 0 ? dictionary / 3 : dictionary;
      const size = view.getBigUint64(5, true);
      recognized = properties < 225 && properties % 9 + Math.floor(properties / 9) % 5 <= 4 &&
        (dictionary === 0xffffffff || (dictionary > 0 && (dictionaryBase & (dictionaryBase - 1)) === 0)) &&
        (size <= 0x4000000000n || size === 0xffffffffffffffffn);
    }
  } else {
    const magic = view.getUint32(0, true);
    recognized = length === 4 && (
      (magic >= 0xfd2fb525 && magic <= 0xfd2fb528) || (magic & 0xfffffff0) === 0x184d2a50 ||
      (magic & 0xffff) === 0x8b1f || (magic & 0xffff) === 0x005d || magic === 0x587a37fd || magic === 0x184d2204
    );
  }
  if (!recognized && (length || options.format === "xz")) {
    yield header.subarray(0, length);
    for (;;) {
      const bytes = await reader.chunk();
      if (!bytes) return;
      yield bytes;
    }
  }
  const remainder = await reader.chunk();
  const restored = new Uint8Array(length + (remainder?.length ?? 0));
  restored.set(header.subarray(0, length));
  if (remainder) restored.set(remainder, length);
  reader.restore(restored);
  yield* (options.format === "zstd" && options.decompress ? zstdDecode : boundedCodec)(reader, options, signal);
}

export interface CompressionCommandOptions {
  /** Optional cumulative decoded bytes per invocation, including discarded and passthrough bytes. */
  readonly maxDecodedBytes?: number;
}

export class DecodedBudget {
  #size = 0;
  exceeded = false;

  constructor(readonly limit = Infinity) {}

  admit(bytes: number): void {
    if (bytes > this.limit - this.#size) {
      this.exceeded = true;
      throw new FsError("EFBIG", { message: "decompression decoded byte limit exceeded" });
    }
    this.#size += bytes;
  }
}

async function* split(source: ByteSource, signal: AbortSignal, fail: (error: unknown) => void, prefetch = true): ByteSource {
  signal.throwIfAborted();
  const sourceIterator = source[Symbol.asyncIterator]();
  const iterator = readBytes({
    [Symbol.asyncIterator]() {
      return {
        next() {
          try {
            return Promise.resolve(sourceIterator.next()).catch(error => { fail(error); throw error; });
          } catch (error) { fail(error); throw error; }
        },
        ...(sourceIterator.return ? { return: sourceIterator.return.bind(sourceIterator) } : {}),
      };
    },
  }, signal);
  let pending = iterator.next();
  void pending.catch(() => {});
  let emptyChunks = 0;
  try {
    for (;;) {
      const next = await pending;
      if (next.done) return;
      const chunk = next.value;
      if (!chunk.byteLength) {
        if (++emptyChunks >= 64) { await yieldTurn(signal); emptyChunks = 0; }
        pending = iterator.next();
        void pending.catch(() => {});
        continue;
      }
      emptyChunks = 0;
      for (let offset = 0; offset < chunk.byteLength; offset += chunkBytes) {
        signal.throwIfAborted();
        const bytes = new Uint8Array(chunk.subarray(offset, offset + chunkBytes));
        if (prefetch && offset + chunkBytes >= chunk.byteLength) {
          pending = iterator.next();
          void pending.catch(() => {});
        }
        yield bytes;
        if (!prefetch && offset + chunkBytes >= chunk.byteLength) {
          pending = iterator.next();
          void pending.catch(() => {});
        }
      }
    }
  } finally { await iterator.return(undefined); }
}

export async function transform(
  source: ByteSource | ((signal: AbortSignal) => ByteSource),
  consume: (output: ByteSource, signal: AbortSignal) => Promise<void>,
  options: CompressionOptions,
  parentSignal: AbortSignal,
  maxOutput = Infinity,
  decodedBudget = new DecodedBudget(stagingLimit),
): Promise<boolean> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  inheritYieldCheckpoint(parentSignal, signal);
  let failure: unknown;
  let hasFailure = false;
  const fail = (error: unknown): void => {
    if (!controller.signal.aborted) { hasFailure = true; failure = error; controller.abort(error); }
  };
  let prepared: ByteSource = split(typeof source === "function" ? source(signal) : source, signal, fail, options.asyncIO !== false);
  let warned = false;
  if (options.format === "gzip" && options.decompress) prepared = gunzipMembers(prepared, signal, options.force, () => { warned = true; });
  const reader = options.format === "gzip" && options.decompress ? undefined : new CodecReader(prepared, signal);
  const nativeTransform = options.decompress && !options.test && (options.passthrough || (options.force && options.stdout && options.passthrough !== false))
    ? passthroughStream : options.format === "zstd" && options.decompress ? zstdDecode : boundedCodec;
  const transformed = options.format !== "gzip"
    ? nativeTransform(reader!, { format: options.format, decompress: options.decompress, level: options.level, extreme: options.extreme ?? false, xzFormat: options.xzFormat, xzCheck: options.xzCheck, xzIgnoreCheck: options.xzIgnoreCheck, xzDecompressMemory: options.xzDecompressMemory, small: options.small, zstd: options.zstd, singleMember: options.singleStream === true, onFailure: fail }, signal)
    : reader ? codec(reader, { mode: "gzip", level: options.level, onFailure: fail }, signal) : prepared;
  let consumed = false;
  const output = (async function* (): AsyncGenerator<Uint8Array> {
    let size = 0;
    try {
      for await (const chunk of readBytes(transformed, signal)) {
        if (options.decompress) decodedBudget.admit(chunk.byteLength);
        if (chunk.length > maxOutput - size) throw new FsError("EFBIG", { message: `staged output exceeds ${maxOutput} bytes` });
        let bytes = chunk;
        if (options.format === "gzip" && !options.decompress && size <= 9 && size + chunk.length > 9) {
          bytes = chunk.slice();
          bytes[9 - size] = 255;
        }
        size += chunk.length;
        yield bytes;
      }
      consumed = true;
    } catch (error) { fail(error); throw error; }
  })();
  let consuming: Promise<void> | undefined;
  try {
    consuming = consume(output, signal);
    await consuming;
    if (!consumed) throw new FsError("EIO", { message: "output consumer did not consume the complete stream" });
  } catch (error) {
    fail(error);
    parentSignal.throwIfAborted();
    throw hasFailure ? failure : error;
  } finally {
    controller.abort();
    await output.return(undefined);
    await reader?.close();
    await consuming?.catch(() => {});
  }
  return warned;
}
