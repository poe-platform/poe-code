import { cosArray, cosDict, cosName, cosNumber, cosString, dictGet, dictSet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfSerializedOutputObject } from "../cos/retained-writer.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export interface RetainedPageLabel {
  readonly index: number;
  readonly style?: string;
  readonly start?: number;
  readonly prefix?: string;
}

/** Retains label pairs on caller storage until every source has closed. */
export class PdfMergeLabels {
  private readonly objects: PdfMutableObjectStore;
  private count = 0;
  private work = 0;
  constructor(private readonly storage: PdfIndexStorage, private readonly signal: AbortSignal, private readonly maxDepth = Infinity) {
    this.objects = new PdfMutableObjectStore(storage, { signal });
  }
  private async checkpoint(depth = 0) {
    this.signal.throwIfAborted();
    if (depth > this.maxDepth) throw new PdfError("E_LIMIT", "PDF page label depth limit exceeded");
    if (++this.work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.signal.throwIfAborted();
  }
  async append(document: PdfRetainedDocument, pageOffset: number): Promise<void> {
    const seen = new PdfReferenceSet(this.storage, Infinity, this.signal), frames = new PdfMutableObjectStore(this.storage, { signal: this.signal }); let failed = false, pending = 0;
    const resolve = async (node: PdfCosNode | undefined) => (await document.lookup(node))?.value;
    const push = async (node: PdfCosNode, depth: number) => {
      await frames.set({ objectNumber: ++pending, generationNumber: 0, value: cosArray([node, cosNumber(depth)]) });
    };
    try {
      const root = await resolve(document.crossReference.rootRef), labels = root?.kind === "dict" ? dictGet(root, "PageLabels") : undefined;
      if (labels) await push(labels, 0);
      while (pending) {
        const frame = (await frames.get(pending--))!.value;
        if (frame.kind !== "array" || frame.items[1]?.kind !== "number") throw new PdfError("E_PARSE", "Invalid page label traversal frame");
        const node = frame.items[0]!, depth = frame.items[1].value;
        await this.checkpoint(depth);
        if (depth && node.kind === "ref" && !await seen.add(node.objectNumber)) continue;
        const dict = await resolve(node); if (dict?.kind !== "dict") continue;
        const nums = await resolve(dictGet(dict, "Nums"));
        if (nums?.kind === "array") for (let i = 0; i + 1 < nums.items.length; i += 2) {
          await this.checkpoint();
          const key = await resolve(nums.items[i]), value = await resolve(nums.items[i + 1]);
          if (key?.kind !== "number" || value?.kind !== "dict") continue;
          const entries: Record<string, PdfCosNode> = {};
          const style = await resolve(dictGet(value, "S")), start = await resolve(dictGet(value, "St")), prefix = await resolve(dictGet(value, "P"));
          if (style?.kind === "name") entries.S = cosName(style.decoded);
          if (start?.kind === "number") entries.St = cosNumber(start.value);
          if (prefix?.kind === "string") entries.P = { kind: "string", bytes: new Uint8Array(prefix.bytes), format: prefix.format };
          await this.objects.set({ objectNumber: ++this.count, generationNumber: 0, value: cosArray([cosNumber(pageOffset + key.value), cosDict(entries)]) });
        }
        const kids = await resolve(dictGet(dict, "Kids"));
        if (kids?.kind === "array") for (let i = kids.items.length - 1; i >= 0; i--) { await this.checkpoint(); await push(kids.items[i]!, depth + 1); }
      }
    }
    catch (error) { failed = true; throw error; }
    finally { const results = await Promise.allSettled([seen.close(), frames.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
  }
  async appendLabels(labels: Iterable<RetainedPageLabel> | AsyncIterable<RetainedPageLabel>): Promise<void> {
    for await (const label of labels) {
      await this.checkpoint();
      if (!Number.isInteger(label.index) || label.index < 0 || (label.start !== undefined && !Number.isInteger(label.start))) throw new RangeError("Invalid PDF page label index or start");
      const value = cosDict({});
      if (label.style !== undefined) dictSet(value, "S", cosName(label.style));
      if (label.start !== undefined && label.start !== 1) dictSet(value, "St", cosNumber(label.start));
      if (label.prefix) dictSet(value, "P", cosString(label.prefix));
      await this.objects.set({ objectNumber: ++this.count, generationNumber: 0, value: cosArray([cosNumber(label.index), value]) });
    }
  }
  private async *chunks() {
    const encoder = new TextEncoder(); yield encoder.encode("<<\n/Nums [ ");
    for await (const object of this.objects.objects()) {
      await this.checkpoint();
      if (object.value.kind !== "array") throw new PdfError("E_PARSE", "Invalid staged page label");
      for (const node of object.value.items) { yield* serializeCosNodeChunks(node, { chunkBytes: 16384, signal: this.signal }); yield encoder.encode(" "); }
    }
    yield encoder.encode("]\n>>");
  }
  async finish(target: PdfMutableObjectStore, catalog: PdfCosDict, allowEmpty = false): Promise<PdfSerializedOutputObject | undefined> {
    if (!this.count && !allowEmpty) return undefined;
    const ref = await target.allocate(cosDict({ Nums: cosArray([]) })); dictSet(catalog, "PageLabels", ref);
    let length = 0; for await (const bytes of this.chunks()) length += bytes.length;
    return { objectNumber: ref.objectNumber, generationNumber: 0, body: { length, chunks: this.chunks() } };
  }
  async close(): Promise<void> { await this.objects.close(); }
}
