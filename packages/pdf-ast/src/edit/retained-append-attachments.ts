import { cosArray, cosDict, cosName, cosNumber, cosString, dictGet, dictSet, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { stageDeflatedPdf } from "../cos/deflate-staging.js";
import { serializeCosNodeChunks } from "../cos/writer.js";

export interface RetainedAppendAttachment {
  readonly filename: string;
  readonly chunks: AsyncIterable<Uint8Array>;
}

/** Append compressed attachments, preserving existing name-tree structure and
 * duplicate names. Optionally add PushPin annotations to a zero-based page. */
export async function appendRetainedAttachments(document: PdfRetainedDocument, target: PdfMutableObjectStore, storage: PdfIndexStorage,
  attachments: AsyncIterable<RetainedAppendAttachment>, options: { pageIndex?: number; signal?: AbortSignal } = {}): Promise<void> {
  const signal = options.signal ?? new AbortController().signal, appended = new PdfMutableObjectStore(storage, { signal });
  let failed = false, count = 0;
  async function resolve(node: PdfCosNode | undefined) { const found = await document.lookup(node); return found?.stream ? undefined : found; }
  async function save(reference: PdfCosRef, value: PdfCosNode) { await target.set({ objectNumber: reference.objectNumber, generationNumber: reference.generationNumber, value }); }
  try {
    const root = await resolve(document.crossReference.rootRef); if (root?.value.kind !== "dict" || !root.reference) return;
    let owner = root;
    let names = await resolve(dictGet(root.value, "Names"));
    if (names?.value.kind !== "dict") {
      const value = cosDict({}), reference = await target.allocate(value); names = { value, reference };
      dictSet(root.value, "Names", reference); await save(root.reference, root.value);
    }
    if (names.value.kind !== "dict") throw new Error("Invalid attachment names");
    if (names.reference) owner = names;
    let tree = await resolve(dictGet(names.value, "EmbeddedFiles"));
    if (tree?.value.kind !== "dict") {
      const value = cosDict({ Names: cosArray([]) }), reference = await target.allocate(value); tree = { value, reference };
      dictSet(names.value, "EmbeddedFiles", reference); await save(owner.reference!, owner.value);
    }
    if (tree.value.kind !== "dict") throw new Error("Invalid attachment tree");
    if (tree.reference) owner = tree;
    const existing = await resolve(dictGet(tree.value, "Names")), namesMarker = cosArray([]);
    if (existing?.value.kind === "array" && existing.reference) owner = { value: namesMarker, reference: existing.reference };
    else dictSet(tree.value, "Names", namesMarker);
    let pageOwner: typeof owner | undefined, previousAnnots: PdfCosNode | undefined;
    const annotsMarker = cosArray([]);
    if (options.pageIndex !== undefined) for await (const page of document.pages()) {
      if (page.index !== options.pageIndex) continue;
      if (page.reference) {
        const annots = await resolve(dictGet(page.dict, "Annots"));
        previousAnnots = annots?.value.kind === "array" ? annots.value : undefined;
        if (annots?.value.kind === "array" && annots.reference) pageOwner = { value: annotsMarker, reference: annots.reference };
        else { dictSet(page.dict, "Annots", annotsMarker); pageOwner = { value: page.dict, reference: page.reference }; }
      }
      break;
    }
    for await (const attachment of attachments) {
      signal.throwIfAborted();
      const compressed = await stageDeflatedPdf(attachment.chunks, storage, signal); let itemFailed = false;
      try {
        const embedded = await target.allocate();
        await target.set({ objectNumber: embedded.objectNumber, generationNumber: 0, value: cosDict({ Type: cosName("EmbeddedFile"), Filter: cosName("FlateDecode"), Length: cosNumber(compressed.size) }), stream: { decoded: true, length: compressed.size, chunks: compressed.stream(0, compressed.size, signal) } });
        const reference = await target.allocate(cosDict({ Type: cosName("Filespec"), F: cosString(attachment.filename), UF: cosString(attachment.filename), EF: cosDict({ F: embedded }) }));
        let annotation: PdfCosRef | undefined;
        if (pageOwner) annotation = await target.allocate(cosDict({ Type: cosName("Annot"), Subtype: cosName("FileAttachment"), Name: cosName("PushPin"), Contents: cosString(attachment.filename), FS: reference, Rect: cosArray([20, 20, 40, 40].map(value => cosNumber(value))) }));
        await appended.set({ objectNumber: ++count, generationNumber: 0, value: cosArray([cosString(attachment.filename), reference, ...(annotation ? [annotation] : [])]) });
      } catch (error) { itemFailed = true; throw error; }
      finally { await compressed.close().catch(error => { if (!itemFailed) throw error; }); }
    }
    const encoder = new TextEncoder();
    async function* serialized(node: PdfCosNode): AsyncGenerator<Uint8Array> {
      signal.throwIfAborted();
      if (node === namesMarker || node === annotsMarker) {
        yield encoder.encode("[ ");
        const old = node === namesMarker ? existing?.value : previousAnnots;
        if (old?.kind === "array") for (const item of old.items) { yield* serializeCosNodeChunks(item, { signal }); yield encoder.encode(" "); }
        for await (const pair of appended.objects()) {
          if (pair.value.kind !== "array") throw new Error("Invalid attachment pair");
          const items = node === namesMarker ? pair.value.items.slice(0, 2) : pair.value.items.slice(2);
          for (const item of items) { yield* serializeCosNodeChunks(item, { signal }); yield encoder.encode(" "); }
        }
        yield encoder.encode("]");
      } else if (node.kind === "dict") {
        yield encoder.encode("<<\n");
        for (const entry of node.entries) { yield* serializeCosNodeChunks(entry.key, { signal }); yield encoder.encode(" "); yield* serialized(entry.value); yield encoder.encode("\n"); }
        yield encoder.encode(">>");
      } else if (node.kind === "array") {
        yield encoder.encode("[ "); for (const item of node.items) { yield* serialized(item); yield encoder.encode(" "); } yield encoder.encode("]");
      } else yield* serializeCosNodeChunks(node, { signal });
    }
    for (const edited of [owner, ...(pageOwner && count ? [pageOwner] : [])]) {
      let length = 0; for await (const bytes of serialized(edited.value)) length += bytes.length;
      await target.setSerializedValue({ objectNumber: edited.reference!.objectNumber, generationNumber: edited.reference!.generationNumber, body: { length, chunks: serialized(edited.value) } });
    }
  } catch (error) { failed = true; throw error; }
  finally { await appended.close().catch(error => { if (!failed) throw error; }); }
}
