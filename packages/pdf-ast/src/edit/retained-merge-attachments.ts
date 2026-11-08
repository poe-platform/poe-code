import { createCompressionCodec } from "@poe-code/compression";
import { cosArray, cosDict, cosName, cosRef, cosString, dictGet, dictSet, type PdfCosDict } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfSerializedOutputObject } from "../cos/retained-writer.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { PdfFileSource } from "../source.js";
import type { PdfRetainedDocument } from "../retained-document.js";

/** Stages each attachment before its source closes. Payloads and name identity
 * live on caller storage; target identities are assigned after page copying. */
export class PdfMergeAttachments {
  private readonly names: PdfNameIndex;
  private readonly objects: PdfMutableObjectStore;
  private count = 0;
  constructor(private readonly storage: PdfIndexStorage, private readonly signal: AbortSignal) {
    this.names = new PdfNameIndex(storage, Infinity, signal);
    this.objects = new PdfMutableObjectStore(storage, { signal });
  }
  async append(document: PdfRetainedDocument): Promise<void> {
    const { CodecReader, codec } = createCompressionCodec();
    for await (const attachment of document.attachments()) {
      this.signal.throwIfAborted();
      if (!(await this.names.intern(attachment.name)).added) continue;
      const reader = new CodecReader(attachment.contents(), this.signal), signal = this.signal;
      async function* encoded() {
        let failed = false;
        try { yield* codec(reader, { mode: "deflate-zlib", chunkSize: 16384 }, signal); }
        catch (error) { failed = true; throw error; }
        finally { await reader.close().catch(error => { if (!failed) throw error; }); }
      }
      const source = await PdfFileSource.fromStream(this.storage.fs, this.storage.directory, encoded(), { signal });
      let failed = false;
      try {
        await this.objects.set({ objectNumber: ++this.count, generationNumber: 0, value: cosDict({ Name: cosString(attachment.name) }),
          stream: { length: source.size, chunks: source.stream(0, source.size, signal) } });
      } catch (error) { failed = true; throw error; }
      finally { await source.close().catch(error => { if (!failed) throw error; }); }
    }
  }
  async finish(target: PdfMutableObjectStore, catalog: PdfCosDict): Promise<PdfSerializedOutputObject | undefined> {
    if (!this.count) return undefined;
    let firstSpec = 0, work = 0;
    for await (const object of this.objects.objects()) {
      if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.signal.throwIfAborted();
      const name = dictGet(object.value as PdfCosDict, "Name")!, dict = cosDict({ Type: cosName("EmbeddedFile"), Filter: cosName("FlateDecode") });
      const embedded = await target.allocate();
      await target.set({ objectNumber: embedded.objectNumber, generationNumber: 0, value: dict, stream: object.stream! });
      const spec = await target.allocate(cosDict({ Type: cosName("Filespec"), F: name, UF: name, EF: cosDict({ F: embedded, UF: embedded }) }));
      firstSpec ||= spec.objectNumber;
    }
    const tree = await target.allocate(cosDict({ Names: cosArray([]) }));
    dictSet(catalog, "Names", await target.allocate(cosDict({ EmbeddedFiles: tree })));
    const objects = this.objects, signal = this.signal, encoder = new TextEncoder();
    async function* chunks() {
      yield encoder.encode("<<\n/Names [ "); let work = 0;
      for await (const object of objects.objects()) {
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
        const name = dictGet(object.value as PdfCosDict, "Name")!;
        yield* serializeCosNodeChunks(name, { chunkBytes: 16384, signal }); yield encoder.encode(" ");
        yield* serializeCosNodeChunks(cosRef(firstSpec + (object.objectNumber - 1) * 2), { chunkBytes: 16384, signal }); yield encoder.encode(" ");
      }
      yield encoder.encode("]\n>>");
    }
    let length = 0; for await (const bytes of chunks()) length += bytes.length;
    return { objectNumber: tree.objectNumber, generationNumber: 0, body: { length, chunks: chunks() } };
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled([this.names.close(), this.objects.close()]);
    for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
