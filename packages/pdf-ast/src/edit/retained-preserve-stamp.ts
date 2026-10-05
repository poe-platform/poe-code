import { cosArray, cosDict, cosNumber, cosString, decodePdfString, dictGet, dictSet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { PdfFileSource } from "../source.js";
import type { RetainedContentEditor } from "./retained-content-edit.js";
import { replaceRetainedPdfNames } from "./retained-name-map.js";
import { retainedStampTransform } from "./retained-stamps.js";

export async function preserveRetainedStamp(document: PdfRetainedDocument, source: PdfRetainedDocument, page: PdfRetainedPage, other: PdfRetainedPage,
  store: PdfMutableObjectStore, editor: RetainedContentEditor, storage: PdfIndexStorage, clone: (node: PdfCosNode) => Promise<PdfCosNode>, mode: "overlay" | "underlay", signal: AbortSignal): Promise<void> {
  const renames = new PdfMutableObjectStore(storage, { signal }), additions = new PdfMutableObjectStore(storage, { signal }); let addedCount = 0, count = 0, failed = false, work = 0;
  const owners = new Map<string, { reference: PdfCosRef; value: PdfCosDict }>();
  const key = (ref: PdfCosRef) => `${ref.objectNumber}:${ref.generationNumber}`;
  if (page.reference) owners.set(key(page.reference), { reference: page.reference, value: page.dict });
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  async function dictionary(node: PdfCosNode | undefined) {
    const cached = node?.kind === "ref" ? owners.get(key(node)) : undefined; if (cached) return cached;
    const found = await document.lookup(node); if (found?.stream || found?.value.kind !== "dict") return;
    const result = { ...found, value: found.value }; if (result.reference) owners.set(key(result.reference), { reference: result.reference, value: result.value }); return result;
  }
  async function stream(chunks: AsyncIterable<Uint8Array>): Promise<PdfCosRef> {
    const staged = await PdfFileSource.fromStream(storage.fs, storage.directory, chunks, { signal }); let failed = false;
    try { const reference = await store.allocate(); await editor.set(reference, cosDict({ Length: cosNumber(staged.size) }), { decoded: true, length: staged.size, chunks: staged.stream(0, staged.size, signal) }); return reference; }
    catch (error) { failed = true; throw error; } finally { await staged.close().catch(error => { if (!failed) throw error; }); }
  }
  async function* mappings(): AsyncGenerator<readonly [string, string]> {
    for await (const object of renames.objects()) if (object.value.kind === "array" && object.value.items[0]?.kind === "string" && object.value.items[1]?.kind === "string") {
      const [name, replacement] = object.value.items as [ReturnType<typeof cosString>, ReturnType<typeof cosString>];
      // Entries originate as JS resource names; decode their PDF string representation.
      yield [decodePdfString(name), decodePdfString(replacement)];
    }
  }
  try {
    const dstAttributes = await page.attributes(), srcAttributes = await other.attributes();
    let resources = await dictionary(dictGet(page.dict, "Resources"));
    if (!resources) {
      const entries = [];
      for (const entry of dstAttributes.resources.entries) { const sub = await document.lookup(entry.value); entries.push({ key: { ...entry.key }, value: sub?.value.kind === "dict" && !sub.stream ? cosDict(Object.fromEntries(sub.value.entries.map(item => [item.key.decoded, item.value]))) : entry.value }); }
      resources = { value: { kind: "dict", entries } }; dictSet(page.dict, "Resources", resources.value);
    }
    for (const category of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties"]) {
      const src = await source.lookup(dictGet(srcAttributes.resources, category)); if (src?.stream || src?.value.kind !== "dict") continue;
      let dst = await dictionary(dictGet(resources.value, category)); if (!dst) { dst = { value: cosDict({}) }; dictSet(resources.value, category, dst.value); }
      for (const entry of src.value.entries) {
        await checkpoint(); const value = await clone(entry.value), original = entry.key.decoded; let name = original;
        if (dictGet(dst.value, original)) {
          name = `Ov_${page.index}_${original}`; let suffix = 1;
          while (dictGet(dst.value, name)) { await checkpoint(); name = `Ov_${page.index}_${suffix++}_${original}`; }
          await renames.set({ objectNumber: ++count, generationNumber: 0, value: cosArray([cosString(original), cosString(name)]) });
        }
        dictSet(dst.value, name, value);
      }
    }
    for (const owner of owners.values()) await editor.set(owner.reference, owner.value);
    const contents = dictGet(other.dict, "Contents"); if (!contents) return;
    const resolved = await source.lookup(contents), nodes = resolved?.value.kind === "array" && !resolved.stream ? resolved.value.items : [contents];
    for (const node of nodes) {
      await checkpoint(); const found = await source.lookup(node);
      const added = found?.stream && found.reference && count ? await stream(replaceRetainedPdfNames(source.objects.decodeStream(found.reference.objectNumber, found.reference.generationNumber), mappings(), storage, { signal })) : await clone(node);
      await additions.set({ objectNumber: ++addedCount, generationNumber: 0, value: added });
    }
    if (!addedCount) return;
    const previous = dictGet(page.dict, "Contents"), resolvedPrevious = previous && await document.lookup(previous);
    const before = resolvedPrevious?.value.kind === "array" && !resolvedPrevious.stream ? resolvedPrevious.value.items : previous ? [previous] : [];
    const encoder = new TextEncoder();
    async function* text(value: string) { yield encoder.encode(value); }
    const openTarget = await stream(text("q\n")), openSource = await stream(text(retainedStampTransform(dstAttributes, srcAttributes))), close = await stream(text("\nQ\n"));
    const marker = cosArray([]); dictSet(page.dict, "Contents", marker);
    async function* contentNodes(): AsyncGenerator<PdfCosNode> {
      for (const overlay of mode === "underlay" ? [true, false] : [false, true]) {
        yield overlay ? openSource : openTarget;
        if (overlay) { for await (const object of additions.objects()) { await checkpoint(); yield object.value; } }
        else for (const node of before) { await checkpoint(); yield node; }
        yield close;
      }
    }
    async function* body(): AsyncGenerator<Uint8Array> {
      yield encoder.encode("<<\n");
      for (const entry of page.dict.entries) {
        yield* serializeCosNodeChunks(entry.key, { signal }); yield encoder.encode(" ");
        if (entry.value === marker) { yield encoder.encode("[ "); for await (const node of contentNodes()) { yield* serializeCosNodeChunks(node, { signal }); yield encoder.encode(" "); } yield encoder.encode("]"); }
        else yield* serializeCosNodeChunks(entry.value, { signal });
        yield encoder.encode("\n");
      }
      yield encoder.encode(">>");
    }
    async function* values() { yield page.dict; yield* contentNodes(); }
    if (page.reference) { let length = 0; for await (const bytes of body()) length += bytes.length; await editor.setSerialized(page.reference, { length, chunks: body() }, values()); }

  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([renames.close(), additions.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
