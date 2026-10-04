import { decodePdfString, dictGet, type PdfCosNode } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { retainedAttachmentNameTokens, type RetainedAttachmentInput } from "./retained-attachment-edits.js";

/** Decodes one copied payload at a time into caller storage to determine its size. */
export async function* copyRetainedAttachments(document: PdfRetainedDocument, storage: PdfIndexStorage,
  options: { prefix?: string; signal?: AbortSignal } = {}): AsyncGenerator<RetainedAttachmentInput> {
  const signal = options.signal ?? new AbortController().signal;
  async function dictionary(node: PdfCosNode | undefined) {
    const result = await document.lookup(node); return !result?.stream && result?.value.kind === "dict" ? result.value : undefined;
  }
  const root = await dictionary(document.crossReference.rootRef), names = await dictionary(root && dictGet(root, "Names"));
  let pending: PdfCosNode | undefined, index = 0;
  for await (const node of retainedAttachmentNameTokens(document, storage, names && dictGet(names, "EmbeddedFiles"), signal)) {
    if (!pending) { pending = node; continue; }
    const label = (await document.lookup(pending))?.value, key = label?.kind === "string" ? decodePdfString(label) : `att_${index}`;
    pending = undefined; index += 2;
    const spec = await dictionary(node); if (!spec) continue;
    const filenameNode = (await document.lookup(dictGet(spec, "UF") ?? dictGet(spec, "F")))?.value;
    const filename = filenameNode?.kind === "string" ? decodePdfString(filenameNode) : key;
    const embedded = await dictionary(dictGet(spec, "EF"));
    const stream = embedded && await document.lookup(dictGet(embedded, "UF") ?? dictGet(embedded, "F") ?? dictGet(embedded, "DOS") ?? dictGet(embedded, "Mac") ?? dictGet(embedded, "Unix"));
    if (!stream?.stream || !stream.reference) continue;
    const payload = await PdfFileSource.fromStream(storage.fs, storage.directory,
      document.objects.decodeStream(stream.reference.objectNumber, stream.reference.generationNumber), { signal });
    let failed = false;
    try { yield { key: `${options.prefix ?? ""}${key}`, filename, length: payload.size, chunks: payload.stream(0, payload.size, signal) }; }
    catch (error) { failed = true; throw error; }
    finally { await payload.close().catch(error => { if (!failed) throw error; }); }
  }
}
