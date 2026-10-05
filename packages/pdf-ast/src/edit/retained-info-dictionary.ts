import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosName, type PdfCosDict } from "../ast.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { readRawPdfDictionaryEntries } from "../content/stored-dictionary.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { serializeRetainedCosNodeChunks } from "../cos/retained-node-writer.js";
import type { PdfTextStore } from "../cos/text-store.js";

/** Ordered entries and a last-occurrence index, all owned by caller backing.
 * Newly supplied names remain text identities until the final dictionary write. */
export class RetainedInfoDictionary {
  private readonly backing: PagedStorage;
  private readonly keys: IntegerTable;
  private readonly last: IntegerTable;
  private readonly names: PdfNameIndex;
  private readonly values: PdfMutableObjectStore;
  private count = 0;
  constructor(storage: PdfIndexStorage, private readonly texts: PdfTextStore, private readonly signal: AbortSignal, private readonly maxDepth = Infinity) {
    this.backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
    this.keys = new IntegerTable(this.backing, 64); this.last = new IntegerTable(this.backing, 64);
    this.names = new PdfNameIndex(storage, Infinity, signal); this.values = new PdfMutableObjectStore(storage, { signal });
  }
  private async *units(id: number) {
    for await (const part of this.texts.text(id)) for (let at = 0; at < part.length; at++) yield part.charCodeAt(at);
  }
  async initialize(dictionary: PdfCosDict): Promise<void> {
    for await (const entry of readRawPdfDictionaryEntries(dictionary, this.signal)) {
      const key = await this.texts.append(entry.key.decoded), name = await this.names.intern(this.units(key)), row = ++this.count;
      await this.keys.set(BigInt(row), BigInt(key)); await this.last.set(BigInt(name.index), BigInt(row));
      const options = { signal: this.signal, preserveStringEncoding: true, maxRecursionDepth: this.maxDepth };
      let length = 0; for await (const part of serializeRetainedCosNodeChunks(entry.value, options)) length += part.length;
      await this.values.setSerializedValue({ objectNumber: row, generationNumber: 0, body: { length, chunks: serializeRetainedCosNodeChunks(entry.value, options) } });
    }
  }
  async set(key: number, value: number): Promise<void> {
    const name = await this.names.intern(this.units(key)), previous = await this.last.get(BigInt(name.index));
    const row = previous === undefined ? ++this.count : Number(previous);
    if (previous === undefined) { await this.keys.set(BigInt(row), BigInt(key)); await this.last.set(BigInt(name.index), BigInt(row)); }
    let length = 0; for await (const bytes of this.texts.serialized(value)) length += bytes.length;
    await this.values.setSerializedValue({ objectNumber: row, generationNumber: 0, body: { length, chunks: this.texts.serialized(value) } });
  }
  async *chunks(): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder(); yield encoder.encode("<<\n");
    for await (const value of this.values.outputObjects()) {
      this.signal.throwIfAborted(); const key = await this.keys.get(BigInt(value.objectNumber));
      if (key === undefined) throw new Error("Missing metadata key");
      yield encoder.encode("/");
      for await (const part of this.texts.text(Number(key))) {
        let first = true;
        for (const bytes of serializeCosNodeChunks(cosName(part), { chunkBytes: 4096, signal: this.signal })) {
          const body = first ? bytes.subarray(1) : bytes; first = false;
          if (body.length) yield body;
        }
      }
      yield encoder.encode(" "); yield* value.body.chunks; yield encoder.encode("\n");
    }
    yield encoder.encode(">>");
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled([this.backing.close(), this.names.close(), this.values.close()]);
    for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
