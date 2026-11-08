import { decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export interface PdfRetainedJavaScript {
  readonly name: string;
  /** UTF-8 chunks; discovery never reads the script payload. Keep the document open. */
  contents(): AsyncGenerator<Uint8Array, void, void>;
}

export async function* walkRetainedJavaScripts(document: PdfRetainedDocument, storage: PdfIndexStorage, options: {
  maxDepth: number; maxStagingBytes?: number; chunkBytes?: number; signal?: AbortSignal;
}): AsyncGenerator<PdfRetainedJavaScript, void, void> {
  const seen = new PdfNameIndex(storage, options.maxStagingBytes, options.signal);
  const direct = { action: new WeakSet<PdfCosDict>(), tree: new WeakSet<PdfCosDict>(), field: new WeakSet<PdfCosDict>() };
  const chunkBytes = Math.max(8, options.chunkBytes ?? 4096);
  let failed = false, work = 0;
  async function checkpoint() {
    options.signal?.throwIfAborted();
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    options.signal?.throwIfAborted();
  }
  async function resolve(node: PdfCosNode | undefined) { return (await document.lookup(node))?.value; }
  async function dictionary(node: PdfCosNode | undefined, category?: keyof typeof direct) {
    await checkpoint();
    const found = await document.lookup(node);
    if (found?.value.kind !== "dict" || found.stream) return undefined;
    if (category) {
      if (found.reference) {
        if (!(await seen.intern(`${category}:${found.reference.objectNumber}:${found.reference.generationNumber}`)).added) return undefined;
      } else {
        if (direct[category].has(found.value)) return undefined;
        direct[category].add(found.value);
      }
    }
    return found.value;
  }
  async function* action(node: PdfCosNode | undefined, label: string, depth = 0): AsyncGenerator<PdfRetainedJavaScript> {
    await checkpoint();
    // Match the existing action-chain recovery depth independently of tree depth.
    if (!node || depth > 8) return;
    const resolved = await resolve(node);
    if (resolved?.kind === "array") {
      for (const item of resolved.items) yield* action(item, label, depth + 1);
      return;
    }
    const dict = await dictionary(node, "action"); if (!dict) return;
    const subtype = await resolve(dictGet(dict, "S"));
    if (subtype?.kind === "name" && subtype.decoded === "JavaScript") {
      const script = await document.lookup(dictGet(dict, "JS"));
      if (script?.value.kind === "string" || (script?.stream && script.reference)) {
        yield { name: label, async *contents() {
          options.signal?.throwIfAborted();
          if (script.stream && script.reference) {
            for await (const bytes of document.objects.decodeStream(script.reference.objectNumber, script.reference.generationNumber)) {
              await checkpoint(); yield bytes;
            }
          } else if (script.value.kind === "string") {
            const text = decodePdfString(script.value), encoder = new TextEncoder();
            for (let at = 0; at < text.length;) {
              await checkpoint();
              let end = Math.min(text.length, at + Math.floor(chunkBytes / 3));
              const last = text.charCodeAt(end - 1);
              if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
              yield encoder.encode(text.slice(at, end)); at = end;
            }
          }
        } };
      }
    }
    yield* action(dictGet(dict, "Next"), label, depth + 1);
  }
  async function* additional(node: PdfCosNode | undefined, prefix: string): AsyncGenerator<PdfRetainedJavaScript> {
    const dict = await dictionary(node); if (!dict) return;
    for (const entry of dict.entries) yield* action(entry.value, `${prefix} AA/${entry.key.decoded}`);
  }
  async function* tree(node: PdfCosNode | undefined, depth: number): AsyncGenerator<PdfRetainedJavaScript> {
    if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF JavaScript name-tree depth limit exceeded");
    const dict = await dictionary(node, "tree"); if (!dict) return;
    const names = await resolve(dictGet(dict, "Names"));
    if (names?.kind === "array") for (let i = 0; i + 1 < names.items.length; i += 2) {
      const key = await resolve(names.items[i]);
      yield* action(names.items[i + 1], key?.kind === "string" ? decodePdfString(key) : key?.kind === "name" ? key.decoded : `Script${i / 2}`);
    }
    const kids = await resolve(dictGet(dict, "Kids"));
    if (kids?.kind === "array") for (const kid of kids.items) yield* tree(kid, depth + 1);
  }
  async function* field(node: PdfCosNode | undefined, fallback: string, depth = 0): AsyncGenerator<PdfRetainedJavaScript> {
    if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF JavaScript field depth limit exceeded");
    const dict = await dictionary(node, "field"); if (!dict) return;
    const title = await resolve(dictGet(dict, "T")); const label = title?.kind === "string" ? decodePdfString(title) : fallback;
    yield* action(dictGet(dict, "A"), `${label} Action`);
    yield* additional(dictGet(dict, "AA"), label);
    const kids = await resolve(dictGet(dict, "Kids"));
    if (kids?.kind === "array") for (const kid of kids.items) yield* field(kid, label, depth + 1);
  }
  try {
    const root = await dictionary(document.crossReference.rootRef); if (!root) return;
    yield* action(dictGet(root, "OpenAction"), "Document OpenAction");
    yield* additional(dictGet(root, "AA"), "Document");
    const names = await dictionary(dictGet(root, "Names"));
    if (names) yield* tree(dictGet(names, "JavaScript"), 0);
    for await (const page of document.pages()) {
      const label = `Page ${page.index + 1}`;
      yield* additional(dictGet(page.dict, "AA"), label);
      const annots = await resolve(dictGet(page.dict, "Annots"));
      if (annots?.kind === "array") for (let i = 0; i < annots.items.length; i++) yield* field(annots.items[i], `${label} Annot ${i + 1}`);
    }
    const form = await dictionary(dictGet(root, "AcroForm"));
    const fields = form ? await resolve(dictGet(form, "Fields")) : undefined;
    if (fields?.kind === "array") for (let i = 0; i < fields.items.length; i++) yield* field(fields.items[i], `Field ${i + 1}`);
  } catch (error) { failed = true; throw error; }
  finally { await seen.close().catch(error => { if (!failed) throw error; }); }
}
