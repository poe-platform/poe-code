const __v9 = globalThis.__gitAdapterV9;
import { createInflate } from "node:zlib";
import { ConsumerClosed, GIT_LIMITS, GitFailure, demand } from "./limits.js";
export async function inflateObject(session, compressed, oid) {
    session.reserve(GIT_LIMITS.maxChunkBytes * 2);
    const header = session.allocate(128);
    let closing;
    let codecError;
    let hasCodecError = false;
    let disposed = false;
    const codec = await session.operation.acquire(() => {
        const stream = createInflate({ chunkSize: GIT_LIMITS.maxChunkBytes });
        __v9("stream-created", session.context, stream);
        stream.on("error", error => { if (!hasCodecError) {
            hasCodecError = true;
            codecError = error;
        } });
        return stream;
    }, async (stream) => {
        closing ??= new Promise(resolve => {
            if (stream.closed) {
                resolve();
                return;
            }
            __v9("acquire-close-hook", stream, resolve);
            stream.once("close", resolve);
            disposed = true;
            stream.destroy();
        });
        await closing;
        __v9("acquire-close-joined", stream, closing);
    });
    __v9("codec-acquired", codec);
    let written;
    let body;
    let headerLength = 0;
    let length = 0;
    let type;
    let success = false;
    const writer = async () => {
        try {
            for (let offset = 0; offset < compressed.length; offset += 4096) {
                session.check();
                await session.step(Math.min(4096, compressed.length - offset));
                await new Promise((resolve, reject) => {
                    const closed = () => { __v9("writer-close-delivered", codec, closed); finish(hasCodecError ? codecError : new GitFailure("Git codec closed during write")); };
                    const finish = (error) => {
                        __v9("writer-finish-attempt", codec, closed, error);
                        codec.removeListener("close", closed);
                        if (error !== undefined)
                            reject(error);
                        else
                            resolve();
                    };
                    if (codec.destroyed) {
                        closed();
                        return;
                    }
                    __v9("writer-close-hook", codec, closed);
                    codec.once("close", closed);
                    codec.write(compressed.subarray(offset, offset + 4096), error => { __v9("raw-write-callback", codec, closed, error); finish(error ?? undefined); });
                });
                if (codec.readableEnded)
                    break;
            }
            codec.end();
        }
        catch (error) {
            codec.destroy(error instanceof Error ? error : new Error("Git codec writer stopped"));
            throw error;
        }
    };
    try {
        written = writer();
        __v9("writer-start", codec, written);
        void written.catch(() => { });
        for await (const value of codec) {
            __v9("reader-yield", codec);
            session.check();
            const chunk = value;
            demand(chunk instanceof Uint8Array && chunk.length <= GIT_LIMITS.maxChunkBytes, "invalid Git codec chunk");
            session.charge("maxInflatedBytes", chunk.length);
            await session.step(chunk.length);
            let offset = 0;
            while (!body && offset < chunk.length) {
                demand(headerLength < header.length, "Git object header limit exceeded");
                const byte = chunk[offset++];
                header[headerLength++] = byte;
                if (byte === 0) {
                    const text = header.subarray(0, headerLength - 1).toString("ascii");
                    demand(header.subarray(0, headerLength - 1).every(character => character < 128), "non-ASCII Git object header");
                    const match = /^(blob|tree|commit|tag) (0|[1-9][0-9]{0,7})$/.exec(text);
                    demand(match, "invalid canonical Git object header");
                    const size = Number(match[2]);
                    demand(size <= GIT_LIMITS.maxObjectBytes, "Git object size exceeded");
                    type = match[1];
                    body = session.allocate(size);
                }
            }
            if (body) {
                demand(chunk.length - offset <= body.length - length, "Git object exceeds declared length");
                body.set(chunk.subarray(offset), length);
                length += chunk.length - offset;
            }
        }
        __v9("reader-done", codec);
        await written;
        __v9("writer-normal-joined", codec, written);
        demand(body && type && body.length === length, "truncated Git object body");
        demand(codec.bytesWritten === compressed.length, "trailing Git zlib input");
        demand(await session.hash(body, type) === oid, "Git object hash mismatch");
        success = true;
        return { type, bytes: body };
    }
    catch (error) {
        session.context.signal.throwIfAborted();
        if (error instanceof GitFailure || error instanceof ConsumerClosed)
            throw error;
        if (disposed && session.operation.signal.aborted)
            session.check();
        if (hasCodecError && error === codecError) {
            __v9("codec-primary-mapped", codec, error);
            throw new GitFailure("invalid Git zlib object");
        }
        throw error;
    }
    finally {
        __v9("codec-finalizer-enter", codec);
        codec.destroy();
        await written?.catch(() => { });
        if (written !== undefined)
            __v9("writer-joined", codec, written);
        if (!codec.closed)
            await new Promise(resolve => { __v9("finalizer-close-hook", codec, resolve); codec.once("close", resolve); });
        __v9("codec-finalizer-joined", codec);
        if (!success && body)
            session.release(body);
        session.release(header);
        session.unreserve(GIT_LIMITS.maxChunkBytes * 2);
    }
}
