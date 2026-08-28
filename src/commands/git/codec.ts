import { createInflate } from "node:zlib";
import type { Session } from "./io.js";
import { ConsumerClosed, GIT_LIMITS, GitFailure, demand } from "./limits.js";

export interface GitObject { readonly type: "blob" | "tree" | "commit" | "tag"; readonly bytes: Buffer }

export async function inflateObject(session: Session, compressed: Buffer, oid: string): Promise<GitObject> {
  session.reserve(GIT_LIMITS.maxChunkBytes * 2);
  const header = session.allocate(128);
  let closing: Promise<void> | undefined;
  let codecError: unknown;
  let hasCodecError = false;
  let disposed = false;
  const codec = await session.operation.acquire(() => {
    const stream = createInflate({ chunkSize: GIT_LIMITS.maxChunkBytes });
    stream.on("error", error => { if (!hasCodecError) { hasCodecError = true; codecError = error; } });
    return stream;
  }, async stream => {
    closing ??= new Promise<void>(resolve => {
      if (stream.closed) { resolve(); return; }
      stream.once("close", resolve);
      disposed = true;
      stream.destroy();
    });
    await closing;
  });
  let written: Promise<void> | undefined;
  let body: Buffer | undefined;
  let headerLength = 0;
  let length = 0;
  let type: GitObject["type"] | undefined;
  let success = false;
  const writer = async (): Promise<void> => {
    try {
      for (let offset = 0; offset < compressed.length; offset += 4096) {
        session.check();
        await session.step(Math.min(4096, compressed.length - offset));
        await new Promise<void>((resolve, reject) => {
          const closed = (): void => finish(hasCodecError ? codecError : new GitFailure("Git codec closed during write"));
          const finish = (error?: unknown): void => {
            codec.removeListener("close", closed);
            if (error !== undefined) reject(error); else resolve();
          };
          if (codec.destroyed) { closed(); return; }
          codec.once("close", closed);
          codec.write(compressed.subarray(offset, offset + 4096), error => finish(error ?? undefined));
        });
        if (codec.readableEnded) break;
      }
      codec.end();
    } catch (error) { codec.destroy(error instanceof Error ? error : new Error("Git codec writer stopped")); throw error; }
  };
  try {
    written = writer();
    void written.catch(() => {});
    for await (const value of codec) {
      session.check();
      const chunk = value as Buffer;
      demand(chunk instanceof Uint8Array && chunk.length <= GIT_LIMITS.maxChunkBytes, "invalid Git codec chunk");
      session.charge("maxInflatedBytes", chunk.length);
      await session.step(chunk.length);
      let offset = 0;
      while (!body && offset < chunk.length) {
        demand(headerLength < header.length, "Git object header limit exceeded");
        const byte = chunk[offset++]!;
        header[headerLength++] = byte;
        if (byte === 0) {
          const text = header.subarray(0, headerLength - 1).toString("ascii");
          demand(header.subarray(0, headerLength - 1).every(character => character < 128), "non-ASCII Git object header");
          const match = /^(blob|tree|commit|tag) (0|[1-9][0-9]{0,7})$/.exec(text);
          demand(match, "invalid canonical Git object header");
          const size = Number(match[2]);
          demand(size <= GIT_LIMITS.maxObjectBytes, "Git object size exceeded");
          type = match[1] as GitObject["type"];
          body = session.allocate(size);
        }
      }
      if (body) {
        demand(chunk.length - offset <= body.length - length, "Git object exceeds declared length");
        body.set(chunk.subarray(offset), length);
        length += chunk.length - offset;
      }
    }
    await written;
    demand(body && type && body.length === length, "truncated Git object body");
    demand(codec.bytesWritten === compressed.length, "trailing Git zlib input");
    demand(await session.hash(body, type) === oid, "Git object hash mismatch");
    success = true;
    return { type, bytes: body };
  } catch (error) {
    session.context.signal.throwIfAborted();
    if (error instanceof GitFailure || error instanceof ConsumerClosed) throw error;
    if (disposed && session.operation.signal.aborted) session.check();
    if (hasCodecError && error === codecError) throw new GitFailure("invalid Git zlib object");
    throw error;
  } finally {
    codec.destroy();
    await written?.catch(() => {});
    if (!codec.closed) await new Promise<void>(resolve => codec.once("close", resolve));
    if (!success && body) session.release(body);
    session.release(header);
    session.unreserve(GIT_LIMITS.maxChunkBytes * 2);
  }
}
