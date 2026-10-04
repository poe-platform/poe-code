import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfError, PdfMutableObjectStore, PdfNameIndex, decodePdfString, dictGet, type PdfCosDict, type PdfCosNode, type PdfIndexStorage, type PdfRetainedDocument } from "@poe-code/pdf-ast";
import { encodeDisplayParts } from "./display.js";

export class QpdfMissingAttachment extends Error {
  constructor(key: string) { super(`qpdf: attachment ${key} not found\n`); }
}

/** Match qpdf's key-based collection, including root AF and page annotations.
 * Traversal frames and membership live on caller storage; output is consumed
 * into publication staging so a later decoding failure cannot leak a prefix. */
export async function* attachmentChunks(document: PdfRetainedDocument, storage: PdfIndexStorage, key: string | undefined,
  signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const values = new PdfMutableObjectStore(storage, { signal }), names = new PdfNameIndex(storage, Infinity, signal);
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const visited = new IntegerTable(backing), accepted = new IntegerTable(backing);
  let failed = false, found = false, top = -1, work = 0;
  async function dictionary(node: PdfCosNode | undefined): Promise<PdfCosDict | undefined> {
    const resolved = await document.lookup(node);
    return resolved?.value.kind === "dict" && !resolved.stream ? resolved.value : undefined;
  }
  async function* specifications(): AsyncGenerator<{ node: PdfCosNode; fallback: string }> {
    const root = await dictionary(document.crossReference.rootRef), nameRoot = await dictionary(root && dictGet(root, "Names"));
    let node = nameRoot && dictGet(nameRoot, "EmbeddedFiles");
    for (;;) {
      signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const dict = await dictionary(node);
      if (dict) {
        const entries = (await document.lookup(dictGet(dict, "Names")))?.value;
        if (entries?.kind === "array") for (let index = 0; index + 1 < entries.items.length; index += 2) {
          const label = (await document.lookup(entries.items[index]))?.value;
          yield { node: entries.items[index + 1]!, fallback: label?.kind === "string" ? decodePdfString(label) : `att_${index}` };
        }
        const kids = (await document.lookup(dictGet(dict, "Kids")))?.value;
        if (kids?.kind === "array" && kids.items.length) {
          const ref = await values.allocate(kids), bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
          view.setFloat64(0, top); view.setFloat64(8, ref.objectNumber);
          const position = backing.allocate(24); await backing.write(position, bytes); top = position;
        }
      }
      node = undefined;
      while (top >= 0) {
        const bytes = await backing.read(top, 24), frame = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const kids = (await values.get(frame.getFloat64(8)))!.value;
        if (kids.kind !== "array") throw new Error("Invalid retained attachment traversal frame");
        const index = frame.getFloat64(16), child = kids.items[index];
        if (!child) { top = frame.getFloat64(0); continue; }
        frame.setFloat64(16, index + 1); await backing.write(top, bytes);
        if (child.kind === "ref") {
          if (await visited.get(BigInt(child.objectNumber)) !== undefined) continue;
          await visited.set(BigInt(child.objectNumber), 1n);
        }
        node = child; break;
      }
      if (!node) break;
    }
    const associated = (await document.lookup(root && dictGet(root, "AF")))?.value;
    if (associated?.kind === "array") for (const item of associated.items) yield { node: item, fallback: "" };
    for await (const page of document.pages()) {
      const annotations = (await document.lookup(dictGet(page.dict, "Annots")))?.value;
      if (annotations?.kind !== "array") continue;
      for (const item of annotations.items) {
        const annotation = await dictionary(item), subtype = annotation && dictGet(annotation, "Subtype");
        if (subtype?.kind !== "name" || subtype.decoded !== "FileAttachment") continue;
        const file = dictGet(annotation!, "FS"); if (file) yield { node: file, fallback: "" };
      }
    }
  }
  try {
    for await (const spec of specifications()) {
      const dict = await dictionary(spec.node); if (!dict) continue;
      const filenameNode = (await document.lookup(dictGet(dict, "UF") ?? dictGet(dict, "F")))?.value;
      const filename = filenameNode?.kind === "string" ? decodePdfString(filenameNode) : spec.fallback, name = spec.fallback || filename;
      const identity = (await names.intern(name)).index;
      if (await accepted.get(BigInt(identity)) !== undefined) continue;
      const embedded = await dictionary(dictGet(dict, "EF"));
      const stream = embedded && await document.lookup(dictGet(embedded, "UF") ?? dictGet(embedded, "F") ?? dictGet(embedded, "DOS") ?? dictGet(embedded, "Mac") ?? dictGet(embedded, "Unix"));
      if (!stream?.stream || !stream.reference) continue;
      await accepted.set(BigInt(identity), 1n);
      const selected = key !== undefined && !found && (name === key || filename === key);
      if (selected) found = true;
      for await (const bytes of document.objects.decodeStream(stream.reference.objectNumber, stream.reference.generationNumber)) {
        signal.throwIfAborted(); if (selected) yield bytes;
      }
      if (key === undefined) yield* encodeDisplayParts([name, " -> ", filename, "\n"], signal);
    }
    if (key !== undefined && !found) throw new QpdfMissingAttachment(key);
  } catch (error) {
    failed = true;
    if (error instanceof PdfError && error.message.startsWith("Unsupported streaming PDF filter: ")) {
      throw new PdfError(error.code, `Unsupported PDF filter: ${error.message.slice("Unsupported streaming PDF filter: ".length)}`);
    }
    throw error;
  }
  finally {
    const results = await Promise.allSettled([values.close(), names.close(), backing.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
