import { decodePdfString, dictGet, type PdfCosNode, type PdfCosDict, type PdfCosRef } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export interface PdfRetainedFont {
  readonly name: string;
  readonly type: string;
  readonly encoding: string;
  readonly embedded: boolean;
  readonly unicode: boolean;
  readonly reference?: PdfCosRef;
}
export interface PdfFontSelection {
  /** One-based inclusive page bounds. AcroForm default fonts are always visited. */
  readonly firstPage?: number;
  readonly lastPage?: number;
}

export async function* walkRetainedFonts(document: PdfRetainedDocument, storage: PdfIndexStorage, options: PdfFontSelection & {
  maxDepth: number; maxStagingBytes?: number; signal?: AbortSignal;
}): AsyncGenerator<PdfRetainedFont, void, void> {
  const names = new PdfNameIndex(storage, options.maxStagingBytes, options.signal);
  const first = options.firstPage ?? 1; const last = options.lastPage ?? Infinity;
  if (!Number.isSafeInteger(first) || first < 1 || (last !== Infinity && (!Number.isSafeInteger(last) || last < first))) throw new RangeError("Invalid PDF font page range");
  let failed = false;
  async function dictionary(node: PdfCosNode | undefined): Promise<PdfCosDict | undefined> {
    const resolved = await document.lookup(node);
    return resolved?.value.kind === "dict" && !resolved.stream ? resolved.value : undefined;
  }
  async function* font(node: PdfCosNode, key: string, depth: number): AsyncGenerator<PdfRetainedFont> {
    const identity = node.kind === "ref" ? `${node.objectNumber}:${node.generationNumber}` : `inline:${key}`;
    if (!(await names.intern(identity)).added) return;
    const value = await dictionary(node); if (!value) return;
    const base = (await document.lookup(dictGet(value, "BaseFont") ?? dictGet(value, "Name")))?.value;
    const name = base?.kind === "name" ? base.decoded : base?.kind === "string" ? decodePdfString(base) : "[none]";
    const subtype = (await document.lookup(dictGet(value, "Subtype")))?.value;
    const raw = subtype?.kind === "name" ? subtype.decoded : "Type1";
    let descendant: PdfCosDict | undefined;
    if (raw === "Type0") {
      const children = (await document.lookup(dictGet(value, "DescendantFonts")))?.value;
      if (children?.kind === "array") descendant = await dictionary(children.items[0]);
    }
    const descriptor = await dictionary(dictGet(value, "FontDescriptor")) ?? (descendant ? await dictionary(dictGet(descendant, "FontDescriptor")) : undefined);
    const embedded = raw === "Type3" || Boolean(descriptor && (dictGet(descriptor, "FontFile") || dictGet(descriptor, "FontFile2") || dictGet(descriptor, "FontFile3")));
    let type = "Type 1";
    if (raw === "TrueType") type = "TrueType";
    else if (raw === "MMType1") type = "MM Type 1";
    else if (raw === "Type3") type = "Type 3";
    else if (raw === "Type0") {
      const subtype = descendant ? (await document.lookup(dictGet(descendant, "Subtype")))?.value : undefined;
      type = subtype?.kind === "name" && subtype.decoded === "CIDFontType2" ? "CID TrueType" : "CID Type 0";
    } else if (descriptor && dictGet(descriptor, "FontFile3")) type = "Type 1C";
    const enc = (await document.lookup(dictGet(value, "Encoding")))?.value;
    const encoding = enc?.kind === "name" ? enc.decoded === "WinAnsiEncoding" ? "WinAnsi" : enc.decoded === "MacRomanEncoding" ? "MacRoman" : enc.decoded === "StandardEncoding" ? "Standard" : enc.decoded : enc?.kind === "dict" ? "Custom" : "Builtin";
    yield { name, type, encoding, embedded, unicode: Boolean(dictGet(value, "ToUnicode")), ...(node.kind === "ref" ? { reference: node } : {}) };
    if (raw === "Type3") yield* resources(await dictionary(dictGet(value, "Resources")), depth + 1);
  }
  async function* resources(value: PdfCosDict | undefined, depth: number): AsyncGenerator<PdfRetainedFont> {
    options.signal?.throwIfAborted();
    if (!value) return;
    if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF font resource depth limit exceeded");
    const fonts = await dictionary(dictGet(value, "Font"));
    if (fonts) for (const entry of fonts.entries) yield* font(entry.value, entry.key.decoded, depth);
    const states = await dictionary(dictGet(value, "ExtGState"));
    if (states) for (const entry of states.entries) {
      const state = await dictionary(entry.value);
      const gsFont = state ? (await document.lookup(dictGet(state, "Font")))?.value : undefined;
      if (gsFont?.kind === "array" && gsFont.items[0]) yield* font(gsFont.items[0], `ExtGS_${entry.key.decoded}`, depth);
    }
    for (const key of ["XObject", "Pattern"]) {
      const objects = await dictionary(dictGet(value, key));
      if (!objects) continue;
      for (const entry of objects.entries) {
        if (entry.value.kind === "ref" && !(await names.intern(`form:${entry.value.objectNumber}`)).added) continue;
        const resolved = await document.lookup(entry.value);
        if (!resolved?.stream || resolved.value.kind !== "dict") continue;
        const subtype = (await document.lookup(dictGet(resolved.value, "Subtype")))?.value;
        if (key === "XObject" && !(subtype?.kind === "name" && subtype.decoded === "Form")) continue;
        yield* resources(await dictionary(dictGet(resolved.value, "Resources")), depth + 1);
      }
    }
  }
  try {
    for await (const page of document.pages()) {
      if (page.index + 1 < first) continue;
      if (page.index + 1 > last) break;
      yield* resources((await page.attributes()).resources, 0);
      const annotations = (await document.lookup(dictGet(page.dict, "Annots")))?.value;
      if (annotations?.kind !== "array") continue;
      for (const node of annotations.items) {
        const annotation = await dictionary(node);
        const appearance = annotation ? await dictionary(dictGet(annotation, "AP")) : undefined;
        if (!appearance) continue;
        for (const key of ["N", "R", "D"]) {
          const ap = await document.lookup(dictGet(appearance, key));
          if (ap?.value.kind !== "dict") continue;
          if (ap.stream) yield* resources(await dictionary(dictGet(ap.value, "Resources")), 0);
          else for (const entry of ap.value.entries) {
            const stream = await document.lookup(entry.value);
            if (stream?.stream && stream.value.kind === "dict") yield* resources(await dictionary(dictGet(stream.value, "Resources")), 0);
          }
        }
      }
    }
    const root = await dictionary(document.crossReference.rootRef);
    const acroform = root ? await dictionary(dictGet(root, "AcroForm")) : undefined;
    if (acroform) yield* resources(await dictionary(dictGet(acroform, "DR")), 0);
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([names.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
