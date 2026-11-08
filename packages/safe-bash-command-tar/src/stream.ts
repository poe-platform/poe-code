import type { TarOptions } from "./options.js";
import { boundedCodec } from "safe-bash-compression-engine/bounded-codec";
import { codec,CodecReader } from "safe-bash-compression-engine/codec";
import { compressionDiagnostic } from "safe-bash-compression-engine/errors";
import { profiles as sharedProfiles } from "safe-bash-compression-engine/options";
import { xzProfile } from "safe-bash-command-xz/options";
const profiles = [...sharedProfiles, xzProfile];
import { readBytes,type ByteSource } from "safe-bash-contracts";
import { bounded,fail,type ArchiveLimits,type Budget } from "safe-bash-io-engine/commands/archive/internal";

export async function* compressed(source: ByteSource, decode: boolean, signal: AbortSignal, limits: ArchiveLimits, format: NonNullable<TarOptions["compression"]> = "gzip"): ByteSource {
  signal.throwIfAborted();
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const reader = new CodecReader(bounded(source, limits.maxArchiveBytes, combined, limits.chunkSize), combined);
  let hasFailure = false;
  let failure: unknown;
  try {
    const onFailure = (error: unknown) => {
        if (!hasFailure) { hasFailure = true; failure = error; controller.abort(error); }
    };
    const output = format === "gzip"
      ? codec(reader, { mode: decode ? "gunzip" : "gzip", chunkSize: limits.chunkSize, onFailure }, combined)
      : boundedCodec(reader, { format, decompress: decode, level: profiles.find(profile => profile.format === format)!.level, onFailure }, combined);
    yield* bounded(output, limits.maxArchiveBytes, combined, limits.chunkSize);
  } catch (error) {
    signal.throwIfAborted();
    throw compressionDiagnostic(hasFailure ? failure : error);
  } finally {
    controller.abort(new Error("archive compression finished"));
    await reader.close();
  }
}

export async function* autodetected(source: ByteSource, signal: AbortSignal, limits: ArchiveLimits): ByteSource {
  const iterator = readBytes(source, signal)[Symbol.asyncIterator]();
  try {
    const prefix = new Uint8Array(6);
    let size = 0;
    let remainder: Uint8Array | undefined;
    while (size < prefix.length) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = next.value;
      if (!chunk.length) continue;
      const take = Math.min(prefix.length - size, chunk.length);
      prefix.set(chunk.subarray(0, take), size);
      size += take;
      if (take < chunk.length) {
        remainder = chunk.subarray(take);
        break;
      }
    }
    const replay = (async function* (): ByteSource {
      yield prefix.subarray(0, size);
      if (remainder) yield remainder;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        if (next.value.length) yield next.value;
      }
    })();
    const format = size >= 2 && prefix[0] === 31 && prefix[1] === 139 ? "gzip"
      : size >= 3 && prefix[0] === 66 && prefix[1] === 90 && prefix[2] === 104 ? "bzip2"
      : size >= 4 && prefix[0] === 0x28 && prefix[1] === 0xb5 && prefix[2] === 0x2f && prefix[3] === 0xfd ? "zstd"
      : size === 6 && [253, 55, 122, 88, 90, 0].every((byte, index) => prefix[index] === byte) ? "xz" : undefined;
    yield* format ? compressed(replay, true, signal, limits, format) : replay;
  } finally {
    if (iterator.return) await iterator.return(undefined);
  }
}

export function recordPadding(size: number, recordSize: number, maximum: number): number {
  const padding = (recordSize - size % recordSize) % recordSize;
  if (!Number.isSafeInteger(size) || size < 0 || size > maximum || padding > maximum - size) fail("archive byte limit exceeded");
  return padding;
}

export async function* recorded(source: ByteSource, options: TarOptions, budget: Budget): ByteSource {
  let size = 0;
  for await (const chunk of readBytes(source, budget.context.signal)) {
    if (chunk.length > budget.limits.maxArchiveBytes - size) fail("archive byte limit exceeded");
    size += chunk.length;
    yield chunk;
  }
  let padding = recordPadding(size, options.recordSize, budget.limits.maxArchiveBytes);
  while (padding > 0) {
    budget.context.signal.throwIfAborted();
    const length = Math.min(padding, budget.limits.chunkSize);
    size += length;
    padding -= length;
    yield new Uint8Array(length);
  }
  if (options.totals) await budget.output(`Total bytes written: ${size}\n`, true);
}

export class Reader {
  position = 0;
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
    this.position += bytes.length;
    return bytes;
  }
  async exact(size: number): Promise<Uint8Array> {
    this.signal.throwIfAborted();
    if (this.chunk.length - this.offset >= size) {
      const bytes = this.chunk.subarray(this.offset, this.offset + size);
      this.offset += size;
      this.position += size;
      return bytes;
    }
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
    this.signal.throwIfAborted();
    if (size === 0) return;
    if (this.chunk.length - this.offset >= size) {
      this.offset += size;
      this.position += size;
      return;
    }
    for await (const ignoredChunk of this.body(size)) this.signal.throwIfAborted();
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
