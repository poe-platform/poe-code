import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosName, dictGet, dictSet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { parseContentStreamEvents } from "../content/range-events.js";
import { serializeContentEventChunks } from "../content/serializer.js";
import type { PdfContentEvent } from "../content/parser.js";
import { PdfFileSource } from "../source.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { RetainedContentEditor } from "./retained-content-edit.js";

export interface RetainedInlineImageOptions { readonly minBytes?: number; readonly compress?: boolean }

export async function externalizeRetainedInlineImages(document: PdfRetainedDocument, store: PdfMutableObjectStore, storage: PdfIndexStorage, options: RetainedInlineImageOptions, signal: AbortSignal): Promise<void> {
  const minimum = options.minBytes ?? 1024;
  if (!Number.isSafeInteger(minimum) || minimum < 0) throw new RangeError("Invalid inline-image minimum size");
  const editor = await RetainedContentEditor.open(store, storage, signal);
  const paths = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const keys: Record<string, string> = { BPC: "BitsPerComponent", CS: "ColorSpace", D: "Decode", DP: "DecodeParms", F: "Filter", H: "Height", IM: "ImageMask", I: "Interpolate", W: "Width" };
  const colors: Record<string, string> = { G: "DeviceGray", RGB: "DeviceRGB", CMYK: "DeviceCMYK", I: "Indexed" };
  const filters: Record<string, string> = { AHx: "ASCIIHexDecode", A85: "ASCII85Decode", LZW: "LZWDecode", Fl: "FlateDecode", RL: "RunLengthDecode", CCF: "CCITTFaxDecode", DCT: "DCTDecode" };
  let counter = 1, failed = false;
  try {
    for await (const page of document.pages()) {
      signal.throwIfAborted(); let modified = false;
      type Dictionary = { value: PdfCosDict; reference?: PdfCosRef };
      let resources: Dictionary | undefined, xobjects: Dictionary | undefined;
      async function dictionary(node: PdfCosNode | undefined): Promise<Dictionary | undefined> {
        const found = await document.lookup(node); if (found?.stream || found?.value.kind !== "dict") return;
        const same = (reference?: PdfCosRef) => found.reference && reference && found.reference.objectNumber === reference.objectNumber && found.reference.generationNumber === reference.generationNumber;
        return { ...found, value: same(page.reference) ? page.dict : same(resources?.reference) ? resources!.value : found.value };
      }
      resources = await dictionary(dictGet(page.dict, "Resources"));
      if (!resources) {
        const inherited = (await page.attributes()).resources, entries = [];
        for (const entry of inherited.entries) {
          const sub = await dictionary(entry.value);
          entries.push({ key: { ...entry.key }, value: sub ? cosDict(Object.fromEntries(sub.value.entries.map(item => [item.key.decoded, item.value]))) : entry.value });
        }
        resources = { value: { kind: "dict", entries } }; dictSet(page.dict, "Resources", resources.value);
      }
      const pageResources = resources;
      xobjects = await dictionary(dictGet(resources.value, "XObject"));
      async function* transformed(): AsyncGenerator<PdfContentEvent> {
        const events = parseContentStreamEvents(page.streamContents(), storage, { pathStorage: paths, maxDepth: Infinity, maxNodes: Infinity, maxTokenBytes: Infinity, signal });
        for await (const event of events) {
          const length = event.kind === "inline-image" ? event.data instanceof Uint8Array ? event.data.length : event.data.end - event.data.start : 0;
          if (event.kind !== "inline-image" || length < minimum) { yield event; continue; }
          if (!xobjects) { xobjects = { value: cosDict() }; dictSet(pageResources.value, "XObject", xobjects.value); }
          let name = `ImExt${counter++}`;
          while (dictGet(xobjects.value, name)) { signal.throwIfAborted(); name = `ImExt${counter++}`; }
          const value = cosDict({ Type: cosName("XObject"), Subtype: cosName("Image") });
          for (const entry of event.dict.entries) {
            const key = keys[entry.key.decoded] ?? entry.key.decoded;
            let item = entry.value;
            if (key === "ColorSpace" && item.kind === "name") item = cosName(colors[item.decoded] ?? item.decoded);
            else if (key === "Filter" && item.kind === "name") item = cosName(filters[item.decoded] ?? item.decoded);
            dictSet(value, key, item);
          }
          const reference = await store.allocate(), data = event.data;
          async function* chunks() { if (data instanceof Uint8Array) yield data; else yield* data.source.stream(data.start, data.end - data.start, signal); }
          await editor.set(reference, value, { decoded: dictGet(value, "Filter") === undefined && dictGet(value, "F") === undefined, length, chunks: chunks() });
          dictSet(xobjects.value, name, reference); modified = true;
          yield { kind: "xobject", name };
        }
      }
      const content = await PdfFileSource.fromStream(storage.fs, storage.directory, serializeContentEventChunks(transformed(), storage, { signal }), { signal });
      let contentFailed = false;
      try {
        if (xobjects?.reference) await editor.set(xobjects.reference, xobjects.value);
        if (resources.reference) await editor.set(resources.reference, resources.value);
        if (page.reference) await editor.set(page.reference, page.dict);
        if (modified) await editor.replace(page, content.stream(0, content.size, signal), options.compress ?? true);
      } catch (error) { contentFailed = true; throw error; }
      finally { await content.close().catch(error => { if (!contentFailed) throw error; }); }
    }
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([editor.close(), paths.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
