import { Readable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setImmediate } from "node:timers/promises";
import { createGunzip, createGzip } from "node:zlib";
import { FsError, readBytes, type ByteSource } from "../../../contracts/index.js";
import type { CompressionOptions } from "./options.js";

export const chunkBytes = 64 * 1024;
export const stagingLimit = 256 * 1024 * 1024;

async function* split(source: ByteSource, signal: AbortSignal): ByteSource {
  let emptyChunks = 0;
  for await (const chunk of readBytes(source, signal)) {
    if (!chunk.byteLength) {
      if (++emptyChunks >= 64) { await setImmediate(undefined, { signal }); emptyChunks = 0; }
      continue;
    }
    emptyChunks = 0;
    for (let offset = 0; offset < chunk.byteLength; offset += chunkBytes) {
      signal.throwIfAborted();
      yield chunk.slice(offset, offset + chunkBytes);
    }
  }
}

export async function transform(
  source: ByteSource | ((signal: AbortSignal) => ByteSource),
  consume: (output: ByteSource, signal: AbortSignal) => Promise<void>,
  options: CompressionOptions,
  parentSignal: AbortSignal,
  maxOutput = Infinity,
): Promise<void> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  let failure: unknown;
  const fail = (error: unknown): void => {
    if (!controller.signal.aborted) { failure = error; controller.abort(error); }
  };
  let prepared: ByteSource = split(typeof source === "function" ? source(signal) : source, signal);
  let passthrough = false;
  if (options.decompress && options.force && !options.test) {
    const iterator = readBytes(prepared, signal);
    const prefix: Uint8Array[] = [];
    let size = 0;
    try {
      while (size < 2) {
        const next = await iterator.next();
        if (next.done) break;
        prefix.push(next.value);
        size += next.value.length;
      }
    } catch (error) {
      fail(error);
      await iterator.return(undefined);
      throw error;
    }
    const first = prefix[0];
    passthrough = first?.[0] !== 0x1f || (first.length > 1 ? first[1] : prefix[1]?.[0]) !== 0x8b;
    prepared = (async function* (): ByteSource {
      try {
        yield* prefix;
        yield* iterator;
      } finally { await iterator.return(undefined); }
    })();
  }
  const readable = Readable.from((async function* (): ByteSource {
    try { yield* prepared; }
    catch (error) { fail(error); throw error; }
  })(), { objectMode: false, highWaterMark: chunkBytes });
  const zlibOptions = { level: options.level, chunkSize: chunkBytes, highWaterMark: chunkBytes };
  const codec = passthrough ? new PassThrough({ highWaterMark: chunkBytes })
    : options.decompress ? createGunzip(zlibOptions) : createGzip(zlibOptions);
  codec.on("error", fail);
  let consuming: Promise<void> | undefined;
  try {
    await pipeline(readable, codec, async (output: AsyncIterable<Uint8Array>) => {
      let consumed = false;
      let size = 0;
      try {
        consuming = consume((async function* (): ByteSource {
          for await (const chunk of readBytes(output, signal)) {
            if (chunk.length > maxOutput - size) throw new FsError("EFBIG", { message: `staged output exceeds ${maxOutput} bytes` });
            let bytes = chunk;
            if (!options.decompress && size <= 9 && size + chunk.length > 9) {
              bytes = chunk.slice();
              bytes[9 - size] = 255;
            }
            size += chunk.length;
            yield bytes;
          }
          consumed = true;
        })(), signal);
        await consuming;
        if (!consumed) throw new FsError("EIO", { message: "output consumer did not consume the complete stream" });
      } catch (error) { fail(error); throw error; }
    }, { signal });
  } catch (error) {
    parentSignal.throwIfAborted();
    throw failure ?? error;
  } finally {
    controller.abort();
    readable.destroy();
    codec.destroy();
    await consuming?.catch(() => {});
  }
}
