import { inheritYieldCheckpoint, yieldTurn } from "../../../contracts/yield.js";
import { FsError, readBytes, type ByteSource } from "../../../contracts/index.js";
import type { CompressionOptions } from "./options.js";
import { gunzipMembers } from "./gunzip.js";
import { codec, CodecReader } from "./codec.js";
import { boundedCodec } from "./bounded-codec.js";

export const chunkBytes = 64 * 1024;
export const stagingLimit = 256 * 1024 * 1024;

async function* zstdcatStream(reader: InstanceType<typeof CodecReader>, options: CompressionOptions, signal: AbortSignal, fail: (error: unknown) => void): ByteSource {
  const header = new Uint8Array(4);
  let length = 0;
  while (length < header.length) {
    const bytes = await reader.chunk();
    if (!bytes) break;
    const count = Math.min(bytes.length, header.length - length);
    header.set(bytes.subarray(0, count), length);
    length += count;
    reader.restore(bytes.subarray(count));
  }
  // Native zstdcat only copies unrecognized input; recognized frames must decode.
  const magic = new DataView(header.buffer).getUint32(0, true);
  const recognized = length === 4 && (
    magic === 0xfd2fb528 || (magic & 0xfffffff0) === 0x184d2a50 ||
    (magic & 0xffff) === 0x8b1f || (magic & 0xffff) === 0x005d || magic === 0x587a37fd || magic === 0x184d2204
  );
  if (length && !recognized) {
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
  yield* boundedCodec(reader, { format: "zstd", decompress: true, level: options.level, zstd: options.zstd, onFailure: fail }, signal);
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
  const transformed = options.passthrough && options.decompress && !options.test
    ? zstdcatStream(reader!, options, signal, fail)
    : options.format !== "gzip"
    ? boundedCodec(reader!, { format: options.format, decompress: options.decompress, level: options.level, extreme: options.extreme ?? false, small: options.small, zstd: options.zstd, onFailure: fail }, signal)
    : reader ? codec(reader, { mode: "gzip", level: options.level, onFailure: fail }, signal) : prepared;
  let consumed = false;
  const output = (async function* (): AsyncGenerator<Uint8Array> {
    let size = 0;
    try {
      for await (const chunk of readBytes(transformed, signal)) {
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
