import { preserveRetainedStamp } from "./retained-preserve-stamp.js";
import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosRef, dictGet, dictSet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { RetainedContentEditor } from "./retained-content-edit.js";
import { editRetainedDocument } from "./retained-graph.js";
import { replaceRetainedPdfName } from "./retained-name-replacement.js";

export interface RetainedStampInput {
  readonly source: PdfRetainedDocument;
  readonly mode: "overlay" | "underlay";
  /** Preserve encoded content streams and apply collision renames simultaneously. */
  readonly preserveStreams?: boolean;
  /** Zero-based page pairs, consumed in order; duplicates are applied repeatedly. */
  readonly pages: Iterable<{ sourceIndex: number; targetIndex: number }> | AsyncIterable<{ sourceIndex: number; targetIndex: number }>;
}

/** Stamp one page at a time; content, clone identities and page indexes use caller backing. */
export async function stampRetainedPages(document: PdfRetainedDocument, store: PdfMutableObjectStore, storage: PdfIndexStorage,
  getPage: (index: number) => Promise<PdfRetainedPage>, stamps: Iterable<RetainedStampInput> | AsyncIterable<RetainedStampInput>, signal: AbortSignal): Promise<void> {
  const editor = await RetainedContentEditor.open(store, storage, signal); let counter = 1, failed = false, work = 0;
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  try {
    for await (const stamp of stamps) {
      const source = await editRetainedDocument(stamp.source, storage, { signal });
      const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), memo = new IntegerTable(backing);
      let stampFailed = false;
      async function clone(node: PdfCosNode, depth = 0): Promise<PdfCosNode> {
        await checkpoint();
        if (depth > source.document.depthLimit) throw new PdfError("E_LIMIT", "PDF stamp clone depth limit exceeded");
        if (node.kind === "ref") {
          const found = await memo.get(BigInt(node.objectNumber)); if (found !== undefined) return cosRef(Number(found));
          // The compatibility clone resolves identities by object number.
          const identity = await source.document.crossReference.index.get(node.objectNumber, signal);
          const object = identity ? await source.document.objects.get(node.objectNumber, identity.generationNumber ?? 0) : undefined;
          if (!object) { if (!stamp.preserveStreams) return { kind: "null" }; const reference = await store.allocate(cosDict({})); await memo.set(BigInt(node.objectNumber), BigInt(reference.objectNumber)); return reference; }
          const reference = await store.allocate({ kind: "null" }); await memo.set(BigInt(node.objectNumber), BigInt(reference.objectNumber));
          const value = await clone(object.value, depth + 1);
          await editor.set(reference, value, object.stream ? { decoded: object.decoded ?? false, length: object.stream.end - object.stream.start,
            chunks: source.document.objects.decodeStream(node.objectNumber, object.generationNumber, { raw: true }) } : undefined);
          return reference;
        }
        if (node.kind === "array") { const items = []; for (const item of node.items) items.push(await clone(item, depth + 1)); return cosArray(items); }
        if (node.kind === "dict") {
          const entries = []; for (const entry of node.entries) if (entry.key.decoded !== "Parent") entries.push({ key: { ...entry.key }, value: await clone(entry.value, depth + 1) });
          if (stamp.preserveStreams) { const dict = cosDict({}); for (const entry of entries) dictSet(dict, entry.key.decoded, entry.value); return dict; }
          return { kind: "dict", entries };
        }
        return node;
      }
      try {
        for await (const pair of stamp.pages) {
          await checkpoint();
          const page = await getPage(pair.targetIndex), other = await source.getPage(pair.sourceIndex);
          if (stamp.preserveStreams) { await preserveRetainedStamp(document, source.document, page, other, store, editor, storage, clone, stamp.mode, signal); continue; }
          const target = await PdfFileSource.fromStream(storage.fs, storage.directory, page.streamContents(), { signal });
          let content: PdfFileSource | undefined, pageFailed = false;
          try {
            content = await PdfFileSource.fromStream(storage.fs, storage.directory, other.streamContents(), { signal });
            const dstAttributes = await page.attributes(), srcAttributes = await other.attributes();
            // Only the seven resource-category owners and the page/resource owners
            // are cached. Keep aliases canonical without a document-sized map.
            const owners = new Map<string, { reference: PdfCosRef; value: PdfCosDict }>();
            const key = (ref: PdfCosRef) => `${ref.objectNumber}:${ref.generationNumber}`;
            if (page.reference) owners.set(key(page.reference), { reference: page.reference, value: page.dict });
            async function dictionary(node: PdfCosNode | undefined) {
              const cached = node?.kind === "ref" ? owners.get(key(node)) : undefined; if (cached) return cached;
              const found = await document.lookup(node); if (found?.stream || found?.value.kind !== "dict") return;
              const result = { ...found, value: found.value }; if (result.reference) owners.set(key(result.reference), { reference: result.reference, value: result.value });
              return result;
            }
            let resources = await dictionary(dictGet(page.dict, "Resources"));
            if (!resources) {
              const entries = [];
              for (const entry of dstAttributes.resources.entries) {
                const sub = await document.lookup(entry.value);
                entries.push({ key: { ...entry.key }, value: sub?.value.kind === "dict" && !sub.stream ? cosDict(Object.fromEntries(sub.value.entries.map(item => [item.key.decoded, item.value]))) : entry.value });
              }
              resources = { value: { kind: "dict", entries } }; dictSet(page.dict, "Resources", resources.value);
            }
            for (const category of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties"]) {
              const src = await source.document.lookup(dictGet(srcAttributes.resources, category)); if (src?.stream || src?.value.kind !== "dict") continue;
              let dst = await dictionary(dictGet(resources.value, category));
              if (!dst) { dst = { value: cosDict({}) }; dictSet(resources.value, category, dst.value); }
              for (const entry of src.value.entries) {
                let name = entry.key.decoded;
                if (dictGet(dst.value, name)) {
                  name = `QStp${counter++}_${name}`;
                  const replacement = await PdfFileSource.fromStream(storage.fs, storage.directory,
                    replaceRetainedPdfName(content.stream(0, content.size, signal), entry.key.decoded, name, storage, { signal }), { signal });
                  const previous = content; content = replacement; await previous.close();
                }
                dictSet(dst.value, name, await clone(entry.value));
              }
            }
            for (const owner of owners.values()) await editor.set(owner.reference, owner.value);
            const stampOpenStr = retainedStampTransform(dstAttributes, srcAttributes);
            const encoder = new TextEncoder(), stamped = content;
            async function* contents() {
              for (const isStamp of stamp.mode === "underlay" ? [true, false] : [false, true]) {
                yield encoder.encode(isStamp ? stampOpenStr : "q\n");
                const input = isStamp ? stamped : target;
                yield* input.stream(0, input.size, signal); yield encoder.encode("\nQ\n");
              }
            }
            await editor.replace(page, contents());
          } catch (error) { pageFailed = true; throw error; }
          finally { const results = await Promise.allSettled([target.close(), content?.close()]); if (!pageFailed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
        }
      } catch (error) { stampFailed = true; throw error; }
      finally { const results = await Promise.allSettled([source.close(), backing.close()]); if (!stampFailed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
    }
  } catch (error) { failed = true; throw error; }
  finally { await editor.close().catch(error => { if (!failed) throw error; }); }
}

export function retainedStampTransform(dstAttributes: { mediaBox: readonly [number, number, number, number]; rotation: number }, srcAttributes: { mediaBox: readonly [number, number, number, number]; rotation: number }): string {
  const dstSize = { width: Math.abs(dstAttributes.mediaBox[2] - dstAttributes.mediaBox[0]), height: Math.abs(dstAttributes.mediaBox[3] - dstAttributes.mediaBox[1]) };
  const srcSize = { width: Math.abs(srcAttributes.mediaBox[2] - srcAttributes.mediaBox[0]), height: Math.abs(srcAttributes.mediaBox[3] - srcAttributes.mediaBox[1]) };
  const rotDiff = ((dstAttributes.rotation - srcAttributes.rotation) % 360 + 360) % 360;
  let stampOpenStr = "q\n";
  if (srcSize.width > 0 && srcSize.height > 0) {
    const fmt6 = (n: number) => Number(n.toFixed(6));
    const fmt4 = (n: number) => Number(n.toFixed(4));
    if (rotDiff === 90) {
      const s = Math.min(dstSize.height / srcSize.width, dstSize.width / srcSize.height);
      const ox = (dstSize.height - srcSize.width * s) / 2;
      const oy = (dstSize.width - srcSize.height * s) / 2;
      stampOpenStr = `q\n0 ${fmt6(s)} ${fmt6(-s)} 0 ${fmt4(dstSize.width - oy)} ${fmt4(ox)} cm\n`;
    } else if (rotDiff === 180) {
      const s = Math.min(dstSize.width / srcSize.width, dstSize.height / srcSize.height);
      const ox = (dstSize.width - srcSize.width * s) / 2;
      const oy = (dstSize.height - srcSize.height * s) / 2;
      stampOpenStr = `q\n${fmt6(-s)} 0 0 ${fmt6(-s)} ${fmt4(dstSize.width - ox)} ${fmt4(dstSize.height - oy)} cm\n`;
    } else if (rotDiff === 270) {
      const s = Math.min(dstSize.height / srcSize.width, dstSize.width / srcSize.height);
      const ox = (dstSize.height - srcSize.width * s) / 2;
      const oy = (dstSize.width - srcSize.height * s) / 2;
      stampOpenStr = `q\n0 ${fmt6(-s)} ${fmt6(s)} 0 ${fmt4(oy)} ${fmt4(dstSize.height - ox)} cm\n`;
    } else if (Math.abs(srcSize.width - dstSize.width) > 0.5 || Math.abs(srcSize.height - dstSize.height) > 0.5) {
      const s = Math.min(dstSize.width / srcSize.width, dstSize.height / srcSize.height);
      const tx = (dstSize.width - srcSize.width * s) / 2;
      const ty = (dstSize.height - srcSize.height * s) / 2;
      stampOpenStr = `q\n${fmt6(s)} 0 0 ${fmt6(s)} ${fmt4(tx)} ${fmt4(ty)} cm\n`;
    }
  }
  return stampOpenStr;
}
