import { Readable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setImmediate } from "node:timers/promises";
import { createGzip } from "node:zlib";
import { FsError, readBytes } from "../../../contracts/index.js";
import { gunzipMembers } from "./gunzip.js";
export const chunkBytes = 64 * 1024;
export const stagingLimit = 256 * 1024 * 1024;
async function* split(source, signal) {
    let emptyChunks = 0;
    for await (const chunk of readBytes(source, signal)) {
        if (!chunk.byteLength) {
            if (++emptyChunks >= 64) {
                await setImmediate(undefined, { signal });
                emptyChunks = 0;
            }
            continue;
        }
        emptyChunks = 0;
        for (let offset = 0; offset < chunk.byteLength; offset += chunkBytes) {
            signal.throwIfAborted();
            yield chunk.slice(offset, offset + chunkBytes);
        }
    }
}
export async function transform(source, consume, options, parentSignal, maxOutput = Infinity) {
    const controller = new AbortController();
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    let failure;
    const fail = (error) => {
        if (!controller.signal.aborted) {
            failure = error;
            controller.abort(error);
        }
    };
    let prepared = split(typeof source === "function" ? source(signal) : source, signal);
    let warned = false;
    if (options.decompress)
        prepared = gunzipMembers(prepared, signal, options.force, () => { warned = true; });
    const readable = Readable.from((async function* () {
        try {
            yield* prepared;
        }
        catch (error) {
            fail(error);
            throw error;
        }
    })(), { objectMode: false, highWaterMark: chunkBytes });
    const zlibOptions = { level: options.level, chunkSize: chunkBytes, highWaterMark: chunkBytes };
    const codec = options.decompress ? new PassThrough({ highWaterMark: chunkBytes }) : createGzip(zlibOptions);
    codec.on("error", fail);
    let consuming;
    try {
        await pipeline(readable, codec, async (output) => {
            let consumed = false;
            let size = 0;
            try {
                consuming = consume((async function* () {
                    for await (const chunk of readBytes(output, signal)) {
                        if (chunk.length > maxOutput - size)
                            throw new FsError("EFBIG", { message: `staged output exceeds ${maxOutput} bytes` });
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
                if (!consumed)
                    throw new FsError("EIO", { message: "output consumer did not consume the complete stream" });
            }
            catch (error) {
                fail(error);
                throw error;
            }
        }, { signal });
    }
    catch (error) {
        parentSignal.throwIfAborted();
        throw failure ?? error;
    }
    finally {
        controller.abort();
        readable.destroy();
        codec.destroy();
        await consuming?.catch(() => { });
    }
    return warned;
}
//# sourceMappingURL=stream.js.map