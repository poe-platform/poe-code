import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfMutableObjectStore, PdfNameIndex, cosArray, cosNumber, decodePdfString, dictGet, type PdfCosNode, type PdfCosDict, type PdfIndexStorage, type PdfRetainedDocument } from "@poe-code/pdf-ast";

/** PDFtk inspection reports with caller-backed traversal, deduplication and page lookup. */
export async function* retainedInspectionReport(document: PdfRetainedDocument, storage: PdfIndexStorage, utf8: boolean, signal: AbortSignal, kind: "annotations" | "document"): AsyncGenerator<Uint8Array> {
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), pages = new IntegerTable(backing, 64);
  let pageCount = 0, work = 0, failed = false;
  const encoder = new TextEncoder();
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  async function resolve(node: PdfCosNode | undefined) { await checkpoint(); const result = await document.lookup(node); return result?.stream ? undefined : result?.value; }
  async function* line(prefix: string, value: string | number | boolean, encode = false) {
    let part = prefix;
    for (const char of String(value)) {
      const code = char.codePointAt(0)!;
      part += encode && !utf8 && code > 127 ? `&#${code};` : char;
      if (part.length >= 4096) { await checkpoint(); yield encoder.encode(part); part = ""; }
    }
    yield encoder.encode(part + "\n");
  }
  async function* walk(start: PdfCosNode | undefined, key: "Kids" | "Next" | "Outlines"): AsyncGenerator<{ dict: PdfCosDict; level: number }> {
    if (!start) return;
    const stack = new PdfMutableObjectStore(storage, { signal }), seen = new IntegerTable(backing, 64);
    let pending = 0, failed = false;
    const push = async (value: PdfCosNode, level = 1) => { await checkpoint(); await stack.set({ objectNumber: ++pending, generationNumber: 0, value: cosArray([value, cosNumber(level)]) }); };
    try {
      await push(start);
      while (pending) {
        await checkpoint(); const frame = (await stack.get(pending--))!.value;
        if (frame.kind !== "array") continue;
        const raw = frame.items[0]!, levelNode = frame.items[1]!, level = levelNode.kind === "number" ? levelNode.value : 1;
        if (raw.kind === "ref") { if (await seen.get(BigInt(raw.objectNumber))) continue; await seen.set(BigInt(raw.objectNumber), 1n); }
        const value = await resolve(raw);
        if (value?.kind === "array" && key === "Next") { for (let i = value.items.length - 1; i >= 0; i--) await push(value.items[i]!, level); continue; }
        if (value?.kind !== "dict") continue;
        yield { dict: value, level };
        if (key === "Outlines") {
          const next = dictGet(value, "Next"), first = dictGet(value, "First");
          if (next) await push(next, level);
          if (first) await push(first, level + 1);
          continue;
        }
        const child = dictGet(value, key);
        if (key === "Next") { if (child) await push(child); }
        else {
          const kids = await resolve(child);
          if (kids?.kind === "array") for (let i = kids.items.length - 1; i >= 0; i--) await push(kids.items[i]!);
        }
      }
    } catch (error) { failed = true; throw error; }
    finally { await stack.close().catch(error => { if (!failed) throw error; }); }
  }
  async function destinationIndex(raw: PdfCosNode | undefined): Promise<number | undefined> {
    let node = await resolve(raw);
    if (node?.kind === "dict") { const target = dictGet(node, "D") ?? dictGet(node, "Dest"); if (target) node = await resolve(target); }
    if (node?.kind === "string" || node?.kind === "name") {
      const name = node.kind === "string" ? decodePdfString(node) : node.decoded;
      const root = await resolve(document.crossReference.rootRef);
      let target: PdfCosNode | undefined;
      if (root?.kind === "dict") {
        const legacy = await resolve(dictGet(root, "Dests")); if (legacy?.kind === "dict") target = dictGet(legacy, name);
        if (!target) {
          const names = await resolve(dictGet(root, "Names"));
          if (names?.kind === "dict") for await (const { dict: branch } of walk(dictGet(names, "Dests"), "Kids")) {
            const pairs = await resolve(dictGet(branch, "Names"));
            if (pairs?.kind === "array") for (let i = 0; i + 1 < pairs.items.length; i += 2) {
              const key = await resolve(pairs.items[i]);
              if ((key?.kind === "string" ? decodePdfString(key) : key?.kind === "name" ? key.decoded : "") === name) { target = pairs.items[i + 1]; break; }
            }
            if (target) break;
          }
        }
      }
      node = await resolve(target);
      if (node?.kind === "dict") { const inner = dictGet(node, "D"); if (inner) node = await resolve(inner); }
    }
    if (node?.kind !== "array" || !node.items.length) return;
    const first = node.items[0]!;
    if (first.kind === "ref") { const found = await pages.get(BigInt(first.objectNumber)); return found ? Number(found) - 1 : undefined; }
    const number = await resolve(first);
    return number?.kind === "number" && number.value >= 0 && number.value < pageCount ? Math.round(number.value) : undefined;
  }
  async function destinationText(raw: PdfCosNode | undefined): Promise<string | undefined> {
    const node = await resolve(raw);
    if (node?.kind === "string") return decodePdfString(node);
    if (node?.kind === "name") return node.decoded;
    if (node?.kind === "array") {
      const first = node.items[0];
      if (first?.kind === "ref") { const found = await pages.get(BigInt(first.objectNumber)); if (found) return `page ${found}`; }
      else if (first?.kind === "number") return `page ${first.value + 1}`;
    }
    if (node?.kind === "dict") { const index = await destinationIndex(node); if (index !== undefined) return `page ${index + 1}`; }
    return;
  }
  async function* stringField(dict: PdfCosDict, key: string, label: string) {
    const node = await resolve(dictGet(dict, key)); if (node?.kind === "string") yield* line(label, decodePdfString(node), true);
  }
  try {
    for await (const page of document.pages()) {
      pageCount++;
      if (page.reference && !await pages.get(BigInt(page.reference.objectNumber))) await pages.set(BigInt(page.reference.objectNumber), BigInt(page.index + 1));
    }
    if (kind === "document") {
      const emitted = new PdfNameIndex(storage, Infinity, signal);
      let failed = false;
      try {
        const info = await resolve(document.crossReference.infoRef);
        if (info?.kind === "dict") {
          for (const key of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]) {
            const node = await resolve(dictGet(info, key));
            const value = node?.kind === "string" ? decodePdfString(node) : node?.kind === "name" ? node.decoded : "";
            if (value) { await emitted.intern(key); yield* line("", "InfoBegin"); yield* line("InfoKey: ", key, true); yield* line("InfoValue: ", value, true); }
          }
          for (const entry of info.entries) {
            const node = await resolve(entry.value), value = node?.kind === "string" ? decodePdfString(node) : "";
            if (value && (await emitted.intern(entry.key.decoded)).added) { yield* line("", "InfoBegin"); yield* line("InfoKey: ", entry.key.decoded, true); yield* line("InfoValue: ", value, true); }
          }
        }
      } catch (error) { failed = true; throw error; }
      finally { await emitted.close().catch(error => { if (!failed) throw error; }); }
    }
    for (let i = 0; i < 2; i++) {
      const id = await resolve(document.crossReference.idArray?.items[i]);
      if (id?.kind !== "string") yield* line(`PdfID${i}: `, "00000000000000000000000000000000");
      else {
        yield encoder.encode(`PdfID${i}: `);
        for (let at = 0; at < id.bytes.length; at += 2048) { await checkpoint(); let text = ""; for (const byte of id.bytes.subarray(at, at + 2048)) text += byte.toString(16).padStart(2, "0"); yield encoder.encode(text); }
        yield encoder.encode("\n");
      }
    }
    yield* line("NumberOfPages: ", pageCount);
    if (kind === "document") {
      const catalog = await resolve(document.crossReference.rootRef);
      const outlines = catalog?.kind === "dict" ? await resolve(dictGet(catalog, "Outlines")) : undefined;
      if (outlines?.kind === "dict") for await (const { dict, level } of walk(dictGet(outlines, "First"), "Outlines")) {
        const titleNode = await resolve(dictGet(dict, "Title"));
        const title = titleNode?.kind === "string" ? decodePdfString(titleNode) : titleNode?.kind === "name" ? titleNode.decoded : "";
        const index = await destinationIndex(dictGet(dict, "Dest") ?? dictGet(dict, "A"));
        if (title) { yield* line("", "BookmarkBegin"); yield* line("BookmarkTitle: ", title, true); yield* line("BookmarkLevel: ", level); yield* line("BookmarkPageNumber: ", index === undefined ? 1 : index + 1); }
      }
      async function rectangle(raw: PdfCosNode | undefined, strict: boolean): Promise<number[] | undefined> {
        const node = await resolve(raw); if (node?.kind !== "array" || node.items.length < 4) return;
        const result: number[] = [];
        for (const item of node.items.slice(0, 4)) { const number = await resolve(item); if (strict && number?.kind !== "number") return; result.push(number?.kind === "number" ? number.value : 0); }
        return result;
      }
      for await (const page of document.pages()) {
        let media: PdfCosNode | undefined, rotate: PdfCosNode | undefined, hasMedia = false, hasRotate = false;
        for await (const parent of document.pageAncestors(page.dict)) {
          if (!hasMedia && dictGet(parent, "MediaBox")) { hasMedia = true; media = dictGet(parent, "MediaBox"); }
          if (!hasRotate && dictGet(parent, "Rotate")) { hasRotate = true; rotate = dictGet(parent, "Rotate"); }
          if (hasMedia && hasRotate) break;
        }
        const box = await rectangle(media, true) ?? [0, 0, 612, 792], width = Math.abs(box[2]! - box[0]!), height = Math.abs(box[3]! - box[1]!);
        const rotation = await resolve(rotate), norm = rotation?.kind === "number" ? ((rotation.value % 360) + 360) % 360 : 0;
        const direct = await rectangle(dictGet(page.dict, "MediaBox"), false) ?? [0, 0, width, height];
        yield* line("", "PageMediaBegin"); yield* line("PageMediaNumber: ", page.index + 1);
        yield* line("PageMediaRotation: ", norm === 90 || norm === 180 || norm === 270 ? norm : 0);
        yield* line("PageMediaRect: ", direct.join(" ")); yield* line("PageMediaDimensions: ", `${width} ${height}`);
        const crop = await rectangle(dictGet(page.dict, "CropBox"), false);
        if (crop) { yield* line("PageMediaCropBox: ", crop.join(" ")); yield* line("PageMediaCropRect: ", crop.join(" ")); }
      }
      const styles: Record<string, string> = { D: "DecimalArabicNumerals", R: "UppercaseRomanNumerals", r: "LowercaseRomanNumerals", A: "UppercaseLetters", a: "LowercaseLetters" };
      if (catalog?.kind === "dict") for await (const { dict } of walk(dictGet(catalog, "PageLabels"), "Kids")) {
        const pairs = await resolve(dictGet(dict, "Nums")); if (pairs?.kind !== "array") continue;
        for (let i = 0; i + 1 < pairs.items.length; i += 2) {
          const number = await resolve(pairs.items[i]), label = await resolve(pairs.items[i + 1]);
          if (number?.kind !== "number" || label?.kind !== "dict") continue;
          const start = await resolve(dictGet(label, "St")), prefix = await resolve(dictGet(label, "P")), style = await resolve(dictGet(label, "S"));
          yield* line("", "PageLabelBegin"); yield* line("PageLabelNewIndex: ", Math.max(1, number.value + 1)); yield* line("PageLabelStart: ", start?.kind === "number" ? start.value : 1);
          if (prefix?.kind === "string" && decodePdfString(prefix)) yield* line("PageLabelPrefix: ", decodePdfString(prefix), true);
          yield* line("PageLabelNumStyle: ", style?.kind === "name" ? styles[style.decoded] ?? "NoNumber" : "NoNumber");
        }
      }
      return;
    }
    for await (const page of document.pages()) {
      const annotations = await resolve(dictGet(page.dict, "Annots")); if (annotations?.kind !== "array") continue;
      for (const item of annotations.items) {
        const annotation = await resolve(item); if (annotation?.kind !== "dict") continue;
        const subtype = await resolve(dictGet(annotation, "Subtype")), rect = await resolve(dictGet(annotation, "Rect"));
        const numbers: number[] = [];
        if (rect?.kind === "array") for (const value of rect.items) { const number = await resolve(value); if (numbers.length < 4) numbers.push(number?.kind === "number" ? number.value : 0); }
        else numbers.push(0, 0, 0, 0);
        yield encoder.encode("---\n"); yield* line("AnnotSubtype: ", subtype?.kind === "name" ? subtype.decoded : "Annot"); yield* line("AnnotRect: ", numbers.join(" "));
        for (const [key, label] of [["NM", "Name"], ["T", "Title"], ["Subj", "Subj"], ["Contents", "Contents"]]) yield* stringField(annotation, key!, `Annot${label}: `);
        const color = await resolve(dictGet(annotation, "C"));
        if (color?.kind === "array" && color.items.length >= 3) { const channels: number[] = []; for (const value of color.items.slice(0, 3)) { const number = await resolve(value); channels.push(number?.kind === "number" ? number.value : 0); } yield* line("AnnotColor: ", channels.join(" ")); }
        const open = await resolve(dictGet(annotation, "Open")); if (open?.kind === "boolean") yield* line("AnnotOpen: ", open.value);
        yield* stringField(annotation, "M", "AnnotModificationDate: ");
        const flags = await resolve(dictGet(annotation, "F")); yield* line("AnnotFlags: ", flags?.kind === "number" ? flags.value : 0); yield* line("AnnotPageNumber: ", page.index + 1);
        const action = dictGet(annotation, "A");
        if (action) for await (const { dict } of walk(action, "Next")) {
          const type = await resolve(dictGet(dict, "S")); if (type?.kind === "name" && type.decoded) yield* line("AnnotActionType: ", type.decoded);
          yield* stringField(dict, "URI", "AnnotActionURI: ");
          const dest = dictGet(dict, "D"), text = await destinationText(dest); if (text) yield* line("AnnotActionDest: ", text, true);
          const index = await destinationIndex(dest ?? dict); if (index !== undefined) yield* line("AnnotActionPageNumber: ", index + 1);
          const file = await resolve(dictGet(dict, "F"));
          if (file?.kind === "string") yield* line("AnnotActionFile: ", decodePdfString(file), true);
          else if (file?.kind === "dict") { const name = await resolve(dictGet(file, "UF") ?? dictGet(file, "F")); if (name?.kind === "string") yield* line("AnnotActionFile: ", decodePdfString(name), true); }
        }
        else if (dictGet(annotation, "Dest")) {
          yield* line("AnnotActionType: ", "GoTo");
          const dest = dictGet(annotation, "Dest"), text = await destinationText(dest); if (text) yield* line("AnnotActionDest: ", text, true);
          const index = await destinationIndex(dest); if (index !== undefined) yield* line("AnnotActionPageNumber: ", index + 1);
        }
      }
    }
  } catch (error) { failed = true; throw error; }
  finally { await backing.close().catch(error => { if (!failed) throw error; }); }
}
