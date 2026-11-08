import type { ZipMetadataFactory } from "./metadata-types.js";
import type { ZipReadSource } from "./ranges.js";
import { fail } from "safe-bash-io-engine/commands/archive/internal";

export interface ZipPatchedSource extends ZipReadSource { close(): Promise<void> }

/** Monotonic fixed-width patch records retain no per-member offsets in memory. */
export async function createZipPatchWriter(factory: ZipMetadataFactory, signal: AbortSignal) {
  const spool = await factory();
  let count = 0, previousEnd = 0, sealed = false, closed: Promise<void> | undefined;
  const close = () => closed ??= Promise.resolve().then(() => spool.close());
  const append = async (offset: number, bytes: Uint8Array) => {
    signal.throwIfAborted();
    if (closed || sealed) fail("ZIP patch storage is closed");
    if (!Number.isSafeInteger(offset) || offset < previousEnd || bytes.length > 8) fail("ZIP unordered metadata patch");
    const record = new Uint8Array(24), view = new DataView(record.buffer);
    view.setBigUint64(0, BigInt(offset), true); view.setUint32(8, bytes.length, true); record.set(bytes, 12);
    await spool.append(record); count++; previousEnd = offset + bytes.length;
  };
  return {
    close,
    async setUint32(offset: number, value: number, little: boolean) {
      const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, little); await append(offset, bytes);
    },
    async setBigUint64(offset: number, value: bigint, little: boolean) {
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, value, little); await append(offset, bytes);
    },
    async finish(source: ZipReadSource): Promise<ZipPatchedSource> {
      sealed = true;
      const records = await spool.finish();
      const get = async (index: number) => {
        const bytes = new Uint8Array(24);
        let length = 0;
        while (length < bytes.length) {
          signal.throwIfAborted();
          const next = await records.read(index * 24 + length, bytes.length - length);
          if (!next.length || next.length > bytes.length - length) fail("ZIP truncated metadata patch");
          bytes.set(next, length); length += next.length;
        }
        const view = new DataView(bytes.buffer);
        return { offset: Number(view.getBigUint64(0, true)), bytes: bytes.subarray(12, 12 + view.getUint32(8, true)) };
      };
      return { size: source.size, close, async read(offset, length) {
        signal.throwIfAborted();
        if (closed) fail("ZIP patched input is closed");
        const bytes = new Uint8Array(await source.read(offset, length));
        let low = 0, high = count;
        while (low < high) {
          const middle = Math.floor((low + high) / 2), record = await get(middle);
          if (record.offset + record.bytes.length <= offset) low = middle + 1; else high = middle;
        }
        for (let index = low; index < count; index++) {
          const record = await get(index);
          if (record.offset >= offset + bytes.length) break;
          const start = Math.max(offset, record.offset), end = Math.min(offset + bytes.length, record.offset + record.bytes.length);
          bytes.set(record.bytes.subarray(start - record.offset, end - record.offset), start - offset);
        }
        return bytes;
      } };
    },
  };
}
