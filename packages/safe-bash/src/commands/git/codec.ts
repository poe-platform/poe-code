import { createInflate } from "node:zlib";
import type { Session } from "./io.js";
import { ConsumerClosed, GIT_LIMITS, GitFailure, demand } from "./limits.js";

export interface GitObject { readonly type: "blob" | "tree" | "commit" | "tag"; readonly bytes: Buffer }

export async function inflatePackedFrame(session: Session, compressed: Uint8Array, declaredBytes: number): Promise<Buffer> {
  demand(Number.isSafeInteger(declaredBytes) && declaredBytes >= 0 && declaredBytes <= GIT_LIMITS.maxObjectBytes, "Git packed body size exceeded");
  const body = session.allocate(declaredBytes);
  let codec: ReturnType<typeof createInflate> | undefined;
  let closing: Promise<void> | undefined;
  let written: Promise<void> | undefined;
  let codecError: unknown, hasCodecError = false, reserved = false, success = false;
  const close = async (): Promise<void> => {
    if (!codec) return;
    closing ??= new Promise<void>(resolve => {
      if (codec!.closed) { resolve(); return; }
      codec!.once("close", resolve);
      codec!.destroy();
    });
    await closing;
  };
  try {
    session.reserve(GIT_LIMITS.maxChunkBytes * 2);
    reserved = true;
    const stream = await session.operation.acquire(() => {
      codec = createInflate({ chunkSize: GIT_LIMITS.maxChunkBytes });
      codec.on("error", error => { if (!hasCodecError) { hasCodecError = true; codecError = error; } });
      return codec;
    }, close);
    const write = async (): Promise<void> => {
      try {
        for (let offset = 0; offset < compressed.length; offset += 4096) {
          const part = compressed.subarray(offset, offset + 4096);
          await session.step(part.length);
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error | null): void => {
              if (settled) return;
              settled = true;
              stream.removeListener("close", closed);
              if (error) reject(error); else resolve();
            };
            const closed = (): void => finish(new GitFailure("Git packed codec closed during write"));
            if (stream.destroyed) { closed(); return; }
            stream.once("close", closed);
            stream.write(part, finish);
          });
          if (stream.readableEnded) break;
        }
        stream.end();
      } catch (error) { stream.destroy(); throw error; }
    };
    written = write();
    void written.catch(() => {});
    let produced = 0;
    for await (const chunk of stream) {
      session.check();
      demand(chunk instanceof Uint8Array && chunk.length <= GIT_LIMITS.maxChunkBytes, "invalid Git packed codec chunk");
      session.charge("maxInflatedBytes", chunk.length);
      demand(chunk.length <= declaredBytes - produced, "Git packed body exceeds declared size");
      await session.copyInto(body, chunk, produced);
      produced += chunk.length;
    }
    await written;
    demand(produced === declaredBytes, "truncated Git packed body");
    demand(stream.bytesWritten === compressed.length, "trailing Git packed zlib input");
    success = true;
    return body;
  } catch (error) {
    session.context.signal.throwIfAborted();
    if (session.operation.signal.aborted) session.check();
    if (hasCodecError && error === codecError) throw new GitFailure("invalid Git packed zlib frame");
    throw error;
  } finally {
    await close();
    await written?.catch(() => {});
    if (!success) session.release(body);
    if (reserved) session.unreserve(GIT_LIMITS.maxChunkBytes * 2);
  }
}

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
