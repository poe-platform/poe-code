import type { ZipEntry, ZipIndexedArchive } from "../zip-format.js";
import type { ZipMetadataFactory } from "./metadata-types.js";
import { ZipMetadataMap } from "./metadata.js";
import { ZipRanges, type ZipReadSource } from "./ranges.js";
import { fail } from "safe-bash-io-engine/commands/archive/internal";

/** Serial member records reference original retained bytes, never per-member closures. */
export class ZipBackedEntries {
  private readonly members: ZipMetadataMap<ZipEntry>;
  private closed = false;
  constructor(private readonly input: ZipReadSource, factory: ZipMetadataFactory, private readonly signal: AbortSignal, private readonly chunkSize: number) {
    this.members = new ZipMetadataMap(factory, signal);
  }
  async append(entry: ZipEntry): Promise<void> {
    const { compressedSource: ignoredCompressed, source: ignoredSource, ...record } = entry;
    if (entry.compressedSource && entry.compressedOffset === undefined) fail("ZIP recovery member lacks retained coordinates");
    await this.members.set(String(this.members.size), record);
  }
  archive(comment: Uint8Array = new Uint8Array()): ZipIndexedArchive {
    const members = this.members;
    const get = async (index: number): Promise<ZipEntry> => {
      if (this.closed) fail("ZIP recovered metadata is closed");
      if (!Number.isSafeInteger(index) || index < 0 || index >= members.size) fail("ZIP recovery member index out of range");
      const entry = { ...(await members.get(String(index)))! };
      if (entry.compressedOffset !== undefined) {
        const ranges = new ZipRanges(this.input, this.signal, this.chunkSize);
        entry.compressedSource = () => ranges.stream(entry.compressedOffset!, entry.compressedSize!);
      }
      return entry;
    };
    return {
      comment,
      entries: {
        get length() { return members.size; },
        get,
        async *[Symbol.asyncIterator]() { for (let index = 0; index < members.size; index++) yield await get(index); },
      },
      close: async () => { this.closed = true; await members.close(); },
    };
  }

  async close(): Promise<void> { this.closed = true; await this.members.close(); }
}
