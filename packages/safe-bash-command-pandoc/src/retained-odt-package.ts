import {createZipCodec, type ZipLimits} from "@poe-code/office-package/zip";
import {createCompressionCodec} from "@poe-code/compression";
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {ExecutionContext} from "./execution.js";
import {PandocError} from "./errors.js";

/** Keep member payloads and order in caller storage until document validation
 * completes. Package budgets then run in the same order as the buffered writer. */
export class RetainedOdtPackage {
  private readonly members: IntegerTable;
  private count = 0;
  constructor(private readonly storage: PagedStorage, private readonly context: ExecutionContext) {
    this.members = new IntegerTable(storage, 64);
  }
  async addSource(name: string, source: AsyncIterable<Uint8Array>): Promise<void> {
    const start = this.storage.allocate(0);
    let length = 0;
    for await (const chunk of source) {
      for (let offset = 0; offset < chunk.length; offset += 16384) {
        const bytes = chunk.subarray(offset, offset + 16384);
        await this.storage.append(bytes); length += bytes.length;
        await this.context.cooperate();
      }
    }
    const metadata = new TextEncoder().encode(JSON.stringify({name, start, length}));
    const header = new Uint8Array(8); new DataView(header.buffer).setFloat64(0, metadata.length, true);
    const position = await this.storage.append(header); await this.storage.append(metadata);
    await this.members.set(BigInt(this.count++), BigInt(position));
  }
  async prepare(): Promise<AsyncIterable<Uint8Array>> {
    const context = this.context, storage = this.storage;
    const signal = context.signal ?? new AbortController().signal;
    const limits: ZipLimits = {maxArchiveBytes: context.limits.outputBytes, maxEntryBytes: context.limits.expandedBytes, maxTotalBytes: context.limits.expandedBytes, maxMembers: context.limits.parts, maxPathBytes: context.limits.text, maxDepth: context.limits.depth, maxPaxBytes: context.limits.binaryBytes, maxTextBytes: context.limits.text, chunkSize: 4096};
    const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => context.cooperate(), fail: message => {throw new PandocError(message.includes("limit") ? "E_LIMIT" : "E_PARSE", "convert", message, "odt");}}, {rejectDuplicateNames: true, validatePayloads: true, allowStoredCompressionFlags: true});
    const archive = codec.createStagedWriter(storage, limits, signal);
    const attributes = {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store" as const};
    for (let index = 0; index < this.count; index++) {
      await context.cooperate();
      const position = Number(await this.members.get(BigInt(index))!);
      const header = await storage.read(position, 8);
      const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getFloat64(0, true);
      const {name, start, length} = JSON.parse(new TextDecoder().decode(await storage.read(position + 8, size))) as {name: string; start: number; length: number};
      context.charge("parts", 1); context.charge("expandedBytes", length, false);
      if (name === "mimetype") {
        const entry = await codec.makeZipEntry(name, await storage.read(start, length), attributes, limits, signal);
        entry.localExtra = new Uint8Array(); entry.centralExtra = new Uint8Array(); await archive.add(entry);
      } else {
        await archive.addSource(name, (async function* () {
          for (let offset = 0; offset < length; offset += 16384) yield await storage.read(start + offset, Math.min(16384, length - offset));
        })(), attributes);
      }
    }
    return archive.finish();
  }
}
