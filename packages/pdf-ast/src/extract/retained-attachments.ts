import { decodePdfString, dictGet, type PdfCosNode } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import { PdfNameIndex } from "../cos/name-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export interface PdfRetainedAttachment {
  readonly index: number;
  readonly name: string;
  /** Decoded owned chunks; the document must remain open during iteration. */
  contents(): AsyncGenerator<Uint8Array, void, void>;
}

export async function* walkRetainedAttachments(document: PdfRetainedDocument, storage: PdfIndexStorage, options: {
  maxDepth: number; maxStagingBytes?: number; signal?: AbortSignal;
}): AsyncGenerator<PdfRetainedAttachment, void, void> {
  const names = new PdfNameIndex(storage, options.maxStagingBytes, options.signal);
  const visited = new PdfReferenceSet(storage, options.maxStagingBytes, options.signal);
  let count = 0; let failed = false;
  async function* filespec(node: PdfCosNode | undefined, fallback: string): AsyncGenerator<PdfRetainedAttachment> {
    const resolved = await document.lookup(node); if (resolved?.value.kind !== "dict") return;
    const spec = resolved.value;
    const filename = (await document.lookup(dictGet(spec, "UF") ?? dictGet(spec, "F")))?.value;
    const name = filename?.kind === "string" ? decodePdfString(filename) : fallback;
    const ef = (await document.lookup(dictGet(spec, "EF")))?.value;
    if (ef?.kind !== "dict") return;
    const data = await document.lookup(dictGet(ef, "UF") ?? dictGet(ef, "F") ?? dictGet(ef, "DOS") ?? dictGet(ef, "Mac") ?? dictGet(ef, "Unix"));
    if (!data?.stream || !data.reference || !(await names.intern(name)).added) return;
    const reference = data.reference;
    yield { index: count++, name, contents: () => document.objects.decodeStream(reference.objectNumber, reference.generationNumber) };
  }
  async function* associated(node: PdfCosNode | undefined, prefix: string): AsyncGenerator<PdfRetainedAttachment> {
    const resolved = (await document.lookup(node))?.value;
    if (resolved?.kind === "array") {
      for (let i = 0; i < resolved.items.length; i++) yield* filespec(resolved.items[i], `${prefix}_af_${i + 1}`);
    } else if (resolved) yield* filespec(resolved, `${prefix}_af`);
  }
  async function* tree(node: PdfCosNode | undefined, depth: number): AsyncGenerator<PdfRetainedAttachment> {
    options.signal?.throwIfAborted();
    if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF attachment name-tree depth limit exceeded");
    if (node?.kind === "ref" && !await visited.add(node.objectNumber)) return;
    const dict = (await document.lookup(node))?.value; if (dict?.kind !== "dict") return;
    const pairs = (await document.lookup(dictGet(dict, "Names")))?.value;
    if (pairs?.kind === "array") for (let i = 0; i + 1 < pairs.items.length; i += 2) {
      const key = (await document.lookup(pairs.items[i]))?.value;
      yield* filespec(pairs.items[i + 1], key?.kind === "string" ? decodePdfString(key) : `attachment_${count + 1}`);
    }
    const kids = (await document.lookup(dictGet(dict, "Kids")))?.value;
    if (kids?.kind === "array") for (const kid of kids.items) yield* tree(kid, depth + 1);
  }
  try {
    const root = (await document.lookup(document.crossReference.rootRef))?.value;
    if (root?.kind === "dict") {
      const dictionary = (await document.lookup(dictGet(root, "Names")))?.value;
      if (dictionary?.kind === "dict") yield* tree(dictGet(dictionary, "EmbeddedFiles"), 0);
      yield* associated(dictGet(root, "AF"), "catalog");
    }
    for await (const page of document.pages()) {
      yield* associated(dictGet(page.dict, "AF"), `page${page.index + 1}`);
      const annots = (await document.lookup(dictGet(page.dict, "Annots")))?.value;
      if (annots?.kind !== "array") continue;
      for (const item of annots.items) {
        const annot = (await document.lookup(item))?.value;
        if (annot?.kind !== "dict") continue;
        const subtype = (await document.lookup(dictGet(annot, "Subtype")))?.value;
        if (subtype?.kind === "name" && subtype.decoded === "FileAttachment") yield* filespec(dictGet(annot, "FS"), `page${page.index + 1}_attachment`);
      }
    }
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([names.close(), visited.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
