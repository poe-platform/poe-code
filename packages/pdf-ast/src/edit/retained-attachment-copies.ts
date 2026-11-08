import { cosArray, cosDict, cosName, cosNumber, decodePdfString, dictGet, dictSet, type PdfCosNode } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { retainedAttachmentNameTokens, type RetainedAttachmentInput } from "./retained-attachment-edits.js";

/** Decodes one copied payload at a time into caller storage to determine its size. */
export async function* copyRetainedAttachments(document: PdfRetainedDocument, storage: PdfIndexStorage,
  options: { prefix?: string; signal?: AbortSignal } = {}): AsyncGenerator<RetainedAttachmentInput> {
  const signal = options.signal ?? new AbortController().signal;
  async function dictionary(node: PdfCosNode | undefined) {
    const result = await document.lookup(node); return !result?.stream && result?.value.kind === "dict" ? result.value : undefined;
  }
  async function copyMetadata(node: PdfCosNode, depth = 0): Promise<PdfCosNode> {
    signal.throwIfAborted();
    if (depth > document.depthLimit) throw new PdfError("E_LIMIT", "Attachment metadata depth limit exceeded");
    if (node.kind === "ref") return copyMetadata((await document.lookup(node))?.value ?? { kind: "null" }, depth + 1);
    if (node.kind === "array") {
      const items = []; for (const item of node.items) items.push(await copyMetadata(item, depth + 1));
      return cosArray(items);
    }
    if (node.kind === "dict") {
      const result = cosDict({});
      for (const entry of node.entries) dictSet(result, entry.key.decoded, await copyMetadata(entry.value, depth + 1));
      return result;
    }
    return node;
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
    try {
      const metadata = cosDict({ Type: cosName("EmbeddedFile"), Params: cosDict({ Size: cosNumber(payload.size) }) });
      if (stream.value.kind === "dict") for (const key of ["Subtype", "Params"]) {
        const value = dictGet(stream.value, key);
        if (value) dictSet(metadata, key, await copyMetadata(value));
      }
      yield { metadata, key: `${options.prefix ?? ""}${key}`, filename, length: payload.size, chunks: payload.stream(0, payload.size, signal) };
    }
    catch (error) { failed = true; throw error; }
    finally { await payload.close().catch(error => { if (!failed) throw error; }); }
  }
}
