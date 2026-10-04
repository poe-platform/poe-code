import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosName, decodePdfString, dictDelete, dictGet, dictSet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { appendStoredRecord, readStoredRecord } from "../content/stored-record.js";
import { PdfFileSource } from "../source.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { RetainedContentEditor } from "./retained-content-edit.js";
import { replaceRetainedPdfName } from "./retained-name-replacement.js";
import { drawRetainedAnnotationText } from "./retained-draw-text.js";

export async function flattenRetainedAnnotations(document: PdfRetainedDocument, store: PdfMutableObjectStore, storage: PdfIndexStorage,
  mode: "all" | "print" | "screen", signal: AbortSignal): Promise<void> {
  const editor = await RetainedContentEditor.open(store, storage, signal); let failed = false;
  async function dictionary(node: PdfCosNode | undefined) { const found = await document.lookup(node); return found?.value.kind === "dict" && !found.stream ? { ...found, value: found.value } : undefined; }
  async function array(node: PdfCosNode | undefined) { const value = (await document.lookup(node))?.value; return value?.kind === "array" ? value : undefined; }
  async function number(node: PdfCosNode | undefined, fallback: number) { const value = (await document.lookup(node))?.value; return value?.kind === "number" ? value.value : fallback; }
  try {
    for await (const page of document.pages()) {
      const annotations = await array(dictGet(page.dict, "Annots")); if (!annotations) continue;
      const survivorStorage = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
      const survivorBase = survivorStorage.allocate(0); let pageFailed = false;
      try {
        let survivors = 0, isolated = false, fontCounter = 1;
        type Owner = { value: PdfCosDict; reference?: PdfCosRef };
        let resources: Owner | undefined;
        // At most the page, resource dictionary and seven resource categories.
        const owners = new Map<string, Owner>();
        const key = (ref: PdfCosRef) => `${ref.objectNumber}:${ref.generationNumber}`;
        if (page.reference) owners.set(key(page.reference), { value: page.dict, reference: page.reference });
        async function resourceDictionary(node: PdfCosNode | undefined): Promise<Owner | undefined> {
          const found = await dictionary(node); if (!found) return;
          if (found.reference) {
            const identity = key(found.reference), old = owners.get(identity); if (old) return old;
            owners.set(identity, found);
          }
          return found;
        }
        async function pageResources(): Promise<PdfCosDict> {
          if (resources) return resources.value;
          resources = await resourceDictionary(dictGet(page.dict, "Resources"));
          if (!resources) {
            const inherited = (await page.attributes()).resources, entries = [];
            for (const entry of inherited.entries) {
              const sub = await dictionary(entry.value);
              entries.push({ key: { ...entry.key }, value: sub ? cosDict(Object.fromEntries(sub.value.entries.map(item => [item.key.decoded, item.value]))) : entry.value });
            }
            resources = { value: { kind: "dict", entries } }; dictSet(page.dict, "Resources", resources.value);
          }
          return resources.value;
        }
        async function saveResources() { for (const owner of owners.values()) if (owner.reference) await editor.set(owner.reference, owner.value); }
        async function font(): Promise<string> {
          const root = await pageResources(); let fonts = await resourceDictionary(dictGet(root, "Font"));
          if (!fonts) { fonts = { value: cosDict({}) }; dictSet(root, "Font", fonts.value); }
          for (const entry of fonts.value.entries) {
            const value = await dictionary(entry.value), base = (await document.lookup(value && dictGet(value.value, "BaseFont")))?.value;
            if (base?.kind === "name" && base.decoded === "Helvetica") { await saveResources(); return entry.key.decoded; }
          }
          let name = `F${fontCounter++}`; while (dictGet(fonts.value, name)) name = `F${fontCounter++}`;
          const reference = await store.allocate(cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica"), Encoding: cosName("WinAnsiEncoding") }));
          dictSet(fonts.value, name, reference); await saveResources(); return name;
        }
        for (let itemIndex = 0; itemIndex < annotations.items.length; itemIndex++) {
          const item = annotations.items[itemIndex]!;
          signal.throwIfAborted();
          const annotation = await dictionary(item); if (!annotation) continue;
          const subtype = dictGet(annotation.value, "Subtype");
          if (subtype?.kind === "name" && (subtype.decoded === "Link" || subtype.decoded === "Popup")) {
            const record = new Uint8Array(8); new DataView(record.buffer).setFloat64(0, itemIndex);
            await survivorStorage.write(survivorStorage.allocate(8), record); survivors++; continue;
          }
          const flagsNode = (await document.lookup(dictGet(annotation.value, "F")))?.value;
          if (flagsNode?.kind === "number") {
            const flags = flagsNode.value;
            if ((flags & 3) !== 0 || (mode === "print" && (flags & 4) === 0) || (mode === "screen" && (flags & 32) !== 0)) continue;
          }
          const rect = await array(dictGet(annotation.value, "Rect"));
          const rx0 = await number(rect?.items[0], 72), ry0 = await number(rect?.items[1], 72);
          const rx1 = await number(rect?.items[2], rx0 + 50), ry1 = await number(rect?.items[3], ry0 + 20);
          const appearance = await dictionary(dictGet(annotation.value, "AP"));
          let normal = appearance && await document.lookup(dictGet(appearance.value, "N"));
          if (normal?.value.kind === "dict" && !normal.stream) {
            const state = (await document.lookup(dictGet(annotation.value, "AS")))?.value;
            normal = (state?.kind === "name" ? await document.lookup(dictGet(normal.value, state.decoded)) : undefined) ?? await document.lookup(normal.value.entries[0]?.value);
          }
          if (normal?.stream && normal.reference && normal.value.kind === "dict") {
            let content = await PdfFileSource.fromStream(storage.fs, storage.directory, document.objects.decodeStream(normal.reference.objectNumber, normal.reference.generationNumber), { signal });
            const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), renames = new IntegerTable(backing), names = new PdfNameIndex(storage, Infinity, signal);
            let appearanceFailed = false, count = 0;
            try {
              if (content.size) {
                const bbox = await array(dictGet(normal.value, "BBox"));
                const bx0 = await number(bbox?.items[0], 0), by0 = await number(bbox?.items[1], 0);
                const bx1 = await number(bbox?.items[2], Math.max(1, rx1 - rx0)), by1 = await number(bbox?.items[3], Math.max(1, ry1 - ry0));
                const matrix = await array(dictGet(normal.value, "Matrix")), hasFormMatrix = !!matrix && matrix.items.length >= 6;
                const values = hasFormMatrix ? await Promise.all(matrix.items.slice(0, 6).map(item => number(item, 0))) : [1, 0, 0, 1, 0, 0];
                const [ma, mb, mc, md, me, mf] = values as [number, number, number, number, number, number];
                const corners = [[bx0 * ma + by0 * mc + me, bx0 * mb + by0 * md + mf], [bx1 * ma + by0 * mc + me, bx1 * mb + by0 * md + mf],
                  [bx0 * ma + by1 * mc + me, bx0 * mb + by1 * md + mf], [bx1 * ma + by1 * mc + me, bx1 * mb + by1 * md + mf]];
                const tbx0 = Math.min(...corners.map(c => c[0]!)), tby0 = Math.min(...corners.map(c => c[1]!));
                const bw = Math.max(1e-6, Math.max(...corners.map(c => c[0]!)) - tbx0), bh = Math.max(1e-6, Math.max(...corners.map(c => c[1]!)) - tby0);
                const scaleX = (rx1 - rx0) / bw, scaleY = (ry1 - ry0) / bh, tx = rx0 - tbx0 * scaleX, ty = ry0 - tby0 * scaleY;
                const apResources = await dictionary(dictGet(normal.value, "Resources"));
                if (apResources) {
                  const root = await pageResources();
                  for (const category of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties"]) {
                    const src = await dictionary(dictGet(apResources.value, category)); if (!src) continue;
                    let dst = await resourceDictionary(dictGet(root, category)); if (!dst) { dst = { value: cosDict({}) }; dictSet(root, category, dst.value); }
                    for (const entry of src.value.entries) {
                      const existing = dictGet(dst.value, entry.key.decoded);
                      if (!existing) dictSet(dst.value, entry.key.decoded, entry.value);
                      else if (!(existing.kind === "ref" && entry.value.kind === "ref" && existing.objectNumber === entry.value.objectNumber)) {
                        let suffix = 1; while (dictGet(dst.value, `${entry.key.decoded}_qap${suffix}`)) suffix++;
                        const renamed = `${entry.key.decoded}_qap${suffix}`; dictSet(dst.value, renamed, entry.value);
                        const name = await names.intern(entry.key.decoded); if (name.added) count++;
                        await renames.set(BigInt(name.index), BigInt(await appendStoredRecord(backing, [entry.key.decoded, renamed], -1, signal)));
                      }
                    }
                  }
                }
                for (let index = 0; index < count; index++) {
                  const record = await readStoredRecord<[string, string]>(backing, Number((await renames.get(BigInt(index)))!), signal);
                  const replacement = await PdfFileSource.fromStream(storage.fs, storage.directory, replaceRetainedPdfName(content.stream(0, content.size, signal), record.value[0], record.value[1], storage, { signal }), { signal });
                  const previous = content; content = replacement; await previous.close();
                }
                await saveResources();
                const encoder = new TextEncoder(), input = content, matSuffix = hasFormMatrix ? ` ${ma} ${mb} ${mc} ${md} ${me} ${mf} cm` : "";
                async function* chunks() {
                  yield* page.streamContents(); yield encoder.encode(`\nq ${scaleX} 0 0 ${scaleY} ${tx} ${ty} cm${matSuffix}\n`);
                  yield* input.stream(0, input.size, signal); yield encoder.encode("\nQ\n");
                }
                await editor.replace(page, chunks()); isolated = false; continue;
              }
            } catch (error) { appearanceFailed = true; throw error; }
            finally {
              const results = await Promise.allSettled([content.close(), backing.close(), names.close()]);
              if (!appearanceFailed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
            }
          }
          const contents = dictGet(annotation.value, "Contents"); let text = contents?.kind === "string" ? decodePdfString(contents).trim() : "";
          if (!text) {
            const parent = await dictionary(dictGet(annotation.value, "Parent"));
            const value = (await document.lookup(dictGet(annotation.value, "V")))?.value ?? (await document.lookup(parent && dictGet(parent.value, "V")))?.value;
            const state = (await document.lookup(dictGet(annotation.value, "AS")))?.value;
            if (value?.kind === "string") text = decodePdfString(value).trim();
            else if (value?.kind === "name" && value.decoded !== "Off") text = value.decoded;
            else if (state?.kind === "name" && state.decoded !== "Off") text = state.decoded;
          }
          if (text) { await drawRetainedAnnotationText(page, editor, storage, text, rx0, ry0, isolated, font, signal); isolated = true; }
        }
        for (let index = 0; index < survivors; index++) {
          const record = await survivorStorage.read(survivorBase + index * 8, 8), view = new DataView(record.buffer, record.byteOffset, 8);
          annotations.items[index] = annotations.items[view.getFloat64(0)]!;
        }
        annotations.items.length = survivors;
        if (survivors) dictSet(page.dict, "Annots", annotations); else dictDelete(page.dict, "Annots");
        if (page.reference) await editor.set(page.reference, page.dict);
      } catch (error) { pageFailed = true; throw error; }
      finally { await survivorStorage.close().catch(error => { if (!pageFailed) throw error; }); }
    }
  } catch (error) { failed = true; throw error; }
  finally { await editor.close().catch(error => { if (!failed) throw error; }); }
}
