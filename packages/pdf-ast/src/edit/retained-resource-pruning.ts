import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, dictDelete, dictGet, dictSet, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfRetainedDocument } from "../retained-document.js";

/** Keep the compatibility name scan, including names inside comments/strings,
 * but stream even a single long token into caller-backed exact membership. */
async function collectNames(input: AsyncIterable<Uint8Array>, names: PdfNameIndex, found: IntegerTable, signal: AbortSignal): Promise<boolean> {
  const iterator = input[Symbol.asyncIterator](), pending: number[] = []; let chunk: Uint8Array = new Uint8Array(), at = 0, ended = false, changed = false, work = 0, failed = false;
  async function peek(index = 0): Promise<number | undefined> {
    while (pending.length <= index && !ended) {
      if (at === chunk.length) { const next = await iterator.next(); if (next.done) { ended = true; break; } chunk = next.value; at = 0; if (!chunk.length) continue; }
      pending.push(chunk[at++]!);
      if (++work % 16384 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    }
    signal.throwIfAborted(); return pending[index];
  }
  async function take() { const value = await peek(); pending.shift(); return value; }
  const delimiter = (byte: number | undefined) => byte === undefined || [32, 9, 10, 13, 47, 60, 62, 91, 93, 40, 41].includes(byte);
  try {
    while (await peek() !== undefined) {
      if (await take() !== 47) continue;
      let length = 0;
      async function* units() {
        while (!delimiter(await peek())) {
          const byte = (await take())!;
          if (byte === 35 && await peek(1) !== undefined) {
            const hex = Number.parseInt(String.fromCharCode((await peek())!, (await peek(1))!), 16);
            if (Number.isFinite(hex)) { await take(); await take(); length++; yield hex & 65535; continue; }
          }
          length++; yield byte;
        }
      }
      const key = BigInt((await names.intern(units())).index);
      if (length && await found.get(key) === undefined) { await found.set(key, 1n); changed = true; }
    }
  } catch (error) { failed = true; throw error; }
  finally { await iterator.return?.().catch(error => { if (!failed) throw error; }); }
  return changed;
}

export async function pruneRetainedResources(document: PdfRetainedDocument, store: PdfMutableObjectStore, storage: PdfIndexStorage, signal: AbortSignal): Promise<void> {
  async function dictionary(node: PdfCosNode | undefined) { const found = await document.lookup(node); return !found?.stream && found?.value.kind === "dict" ? { ...found, value: found.value } : undefined; }
  async function save(reference: PdfCosRef, value: PdfCosNode) { await store.set({ objectNumber: reference.objectNumber, generationNumber: reference.generationNumber, value }); }
  for await (const page of document.pages()) {
    signal.throwIfAborted();
    const names = new PdfNameIndex(storage, Infinity, signal), visitedNames = new PdfNameIndex(storage, Infinity, signal);
    const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), found = new IntegerTable(backing);
    let failed = false;
    try {
      const referenced = async (name: string) => await found.get(BigInt((await names.intern(name)).index)) !== undefined;
      await collectNames(page.streamContents(), names, found, signal);
      const annotations = (await document.lookup(dictGet(page.dict, "Annots")))?.value;
      if (annotations?.kind === "array") for (const item of annotations.items) {
        const annotation = await dictionary(item), appearance = await dictionary(annotation && dictGet(annotation.value, "AP"));
        const normal = appearance && await document.lookup(dictGet(appearance.value, "N"));
        if (normal?.stream && normal.reference) await collectNames(document.objects.decodeStream(normal.reference.objectNumber, normal.reference.generationNumber), names, found, signal);
      }
      let resources = await dictionary(dictGet(page.dict, "Resources"));
      if (!resources) {
        const inherited = (await page.attributes()).resources, entries = [];
        for (const entry of inherited.entries) {
          const sub = await dictionary(entry.value);
          entries.push({ key: { ...entry.key }, value: sub ? cosDict(Object.fromEntries(sub.value.entries.map(item => [item.key.decoded, item.value]))) : entry.value });
        }
        resources = { value: { kind: "dict", entries } }; dictSet(page.dict, "Resources", resources.value);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const category of ["XObject", "Pattern"]) {
          const sub = await dictionary(dictGet(resources.value, category)); if (!sub) continue;
          for (const entry of sub.value.entries) {
            signal.throwIfAborted();
            if (!await referenced(entry.key.decoded) || !(await visitedNames.intern(`${category}:${entry.key.decoded}`)).added) continue;
            const object = await document.lookup(entry.value);
            if (object?.stream && object.reference && await collectNames(document.objects.decodeStream(object.reference.objectNumber, object.reference.generationNumber), names, found, signal)) changed = true;
          }
        }
      }
      for (const category of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties"]) {
        const sub = await dictionary(dictGet(resources.value, category)); if (!sub) continue;
        for (const entry of [...sub.value.entries]) if (!await referenced(entry.key.decoded)) dictDelete(sub.value, entry.key.decoded);
        if (sub.reference) await save(sub.reference, sub.value);
        if (!sub.value.entries.length) dictDelete(resources.value, category);
      }
      if (resources.reference) await save(resources.reference, resources.value);
      if (page.reference) await save(page.reference, page.dict);
    } catch (error) { failed = true; throw error; }
    finally { const results = await Promise.allSettled([names.close(), visitedNames.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
  }
}
