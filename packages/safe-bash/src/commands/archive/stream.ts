import { createGunzip, createGzip } from "node:zlib";
import { readBytes, type ByteSource } from "../../contracts/index.js";
import { bounded, fail, wait, type ArchiveLimits } from "./internal.js";

export async function* compressed(source: ByteSource, decode: boolean, signal: AbortSignal, limits: ArchiveLimits): ByteSource {
  signal.throwIfAborted();
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const streamOptions = { chunkSize: limits.chunkSize, highWaterMark: limits.chunkSize };
  const transform = decode ? createGunzip(streamOptions) : createGzip(streamOptions);
  transform.on("error", () => {});
  const destroy = () => { transform.destroy(new Error("archive compression cancelled")); };
  combined.addEventListener("abort", destroy, { once: true });
  const pump = (async () => {
    try {
      for await (const chunk of bounded(source, limits.maxArchiveBytes, combined, limits.chunkSize)) {
        await wait(combined, () => new Promise<void>((resolve, reject) => {
          transform.write(chunk, error => error ? reject(error) : resolve());
        }));
      }
      combined.throwIfAborted();
      transform.end();
    } catch (error) {
      transform.destroy(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  })();
  void pump.catch(() => {});
  try {
    yield* bounded(transform, limits.maxArchiveBytes, combined, limits.chunkSize);
    await pump;
  } finally {
    controller.abort(new Error("archive compression finished"));
    combined.removeEventListener("abort", destroy);
    transform.destroy();
    await pump.catch(() => {});
  }
}

export class Reader {
  readonly iterator: AsyncIterator<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  constructor(source: ByteSource, readonly signal: AbortSignal) {
    this.iterator = readBytes(source, signal)[Symbol.asyncIterator]();
  }
  async take(maximum: number): Promise<Uint8Array | undefined> {
    this.signal.throwIfAborted();
    while (this.offset === this.chunk.length) {
      const result = await this.iterator.next();
      if (result.done) return undefined;
      this.chunk = result.value;
      this.offset = 0;
    }
    const end = Math.min(this.chunk.length, this.offset + maximum);
    const bytes = this.chunk.subarray(this.offset, end);
    this.offset = end;
    return bytes;
  }
  async exact(size: number): Promise<Uint8Array> {
    const result = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const bytes = await this.take(size - offset);
      if (!bytes) fail("truncated archive");
      result.set(bytes, offset);
      offset += bytes.length;
    }
    return result;
  }
  async *body(size: number): ByteSource {
    let remaining = size;
    while (remaining > 0) {
      const bytes = await this.take(remaining);
      if (!bytes) fail("truncated archive body");
      remaining -= bytes.length;
      yield bytes;
    }
  }
  async discard(size: number): Promise<void> {
    for await (const _chunk of this.body(size)) this.signal.throwIfAborted();
  }
  async padding(size: number): Promise<void> { await this.discard((512 - size % 512) % 512); }
  async finish(): Promise<void> {
    let trailing = 0;
    while (true) {
      const bytes = await this.take(64 * 1024);
      if (!bytes) break;
      if (bytes.some(byte => byte !== 0)) fail("nonzero trailing archive data or concatenated archive is unsupported");
      trailing += bytes.length;
    }
    if (trailing % 512 !== 0) fail("truncated archive trailing record");
  }
  async close(): Promise<void> {
    if (this.iterator.return) await this.iterator.return();
  }
}
