import type { ByteSource } from "safe-bash-contracts";
import { fail } from "safe-bash-io-engine/commands/archive/internal";

/** Caller-owned retained storage. read must return owned bytes for the range. */
export interface ZipReadSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** One bounded metadata window; payload streams never populate the cache. */
export class ZipRanges {
  readonly length: number;
  private start = 0;
  private cache: Uint8Array = new Uint8Array();
  constructor(readonly source: ZipReadSource, readonly signal: AbortSignal, readonly chunkSize: number) {
    this.length = source.size;
  }
  slice(start: number, end = this.length): ZipReadSource {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > this.length) fail("ZIP invalid range span");
    return { size: end - start, read: (offset, length) => this.subarray(start + offset, Math.min(end, start + offset + length)) };
  }
  async subarray(start: number, end = this.length): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > this.length) fail("ZIP truncated range");
    const result = new Uint8Array(end - start);
    let offset = start;
    while (offset < end) {
      this.signal.throwIfAborted();
      const size = Math.min(this.chunkSize, end - offset);
      const bytes = await this.source.read(offset, size);
      if (!bytes.length || bytes.length > size) fail("ZIP truncated range");
      result.set(bytes, offset - start);
      offset += bytes.length;
    }
    return result;
  }
  async view(offset: number, width: number): Promise<DataView> {
    if (offset < this.start || offset + width > this.start + this.cache.length) {
      const window = Math.min(this.chunkSize, 4096);
      const start = Math.floor(offset / window) * window;
      const cache = await this.subarray(start, Math.min(this.length, start + window + 8));
      this.start = start;
      this.cache = cache;
    }
    if (offset < 0 || offset + width > this.length) fail("ZIP truncated numeric field");
    return new DataView(this.cache.buffer, this.cache.byteOffset + offset - this.start, width);
  }
  async getUint16(offset: number, little: boolean): Promise<number> { return (await this.view(offset, 2)).getUint16(0, little); }
  async getUint32(offset: number, little: boolean): Promise<number> { return (await this.view(offset, 4)).getUint32(0, little); }
  async getBigUint64(offset: number, little: boolean): Promise<bigint> { return (await this.view(offset, 8)).getBigUint64(0, little); }
  async *stream(start: number, length: number): ByteSource {
    const end = start + length;
    if (!Number.isSafeInteger(end) || start < 0 || end > this.length) fail("ZIP invalid payload span");
    while (start < end) {
      this.signal.throwIfAborted();
      const bytes = await this.subarray(start, Math.min(end, start + this.chunkSize));
      start += bytes.length;
      yield bytes;
    }
  }
}

/** Concatenate retained spans and small owned metadata without copying payloads. */
export function joinZipSources(parts: readonly (ZipReadSource | Uint8Array)[]): ZipReadSource {
  const starts: number[] = [];
  let size = 0;
  for (const part of parts) { starts.push(size); size += part instanceof Uint8Array ? part.length : part.size; }
  if (!Number.isSafeInteger(size)) fail("ZIP unsafe archive length");
  return { size, async read(offset, length) {
    const index = starts.findLastIndex(start => start <= offset);
    if (index < 0 || offset >= size) return new Uint8Array();
    const part = parts[index]!;
    const local = offset - starts[index]!;
    const available = (part instanceof Uint8Array ? part.length : part.size) - local;
    return part instanceof Uint8Array ? part.slice(local, local + Math.min(length, available)) : part.read(local, Math.min(length, available));
  } };
}

export function patchZipSource(source: ZipReadSource, patches: readonly { offset: number; bytes: Uint8Array }[]): ZipReadSource {
  const sorted = [...patches].sort((a, b) => a.offset - b.offset);
  return { size: source.size, async read(offset, length) {
    const bytes = new Uint8Array(await source.read(offset, length));
    let low = 0, high = sorted.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sorted[middle]!.offset + sorted[middle]!.bytes.length <= offset) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < sorted.length && sorted[index]!.offset < offset + bytes.length; index++) {
      const patch = sorted[index]!;
      const start = Math.max(offset, patch.offset), end = Math.min(offset + bytes.length, patch.offset + patch.bytes.length);
      bytes.set(patch.bytes.subarray(start - patch.offset, end - patch.offset), start - offset);
    }
    return bytes;
  } };
}
