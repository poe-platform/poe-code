import { cosDict, cosRef, dictGet, type PdfCosDict, type PdfCosRef } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { PdfObjectIndex, type PdfIndexStorage } from "./object-index.js";
import type { PdfCrossReference, PdfCrossReferenceOptions } from "./cross-reference.js";
import { PdfReferenceSet } from "./reference-set.js";
import { parseCosRangeObject, type PdfRangeObject } from "./range-parser.js";
import { scanCosRangeObjects } from "./range-repair.js";

/** Match Map replacement ordering during repair without keeping that Map:
 * visit each identity at its first file occurrence, but use its latest body. */
export async function* recoveredBodies(source: PdfFileSource, index: PdfObjectIndex, storage: PdfIndexStorage, options: PdfCrossReferenceOptions): AsyncGenerator<PdfRangeObject, void> {
  const visited = new PdfReferenceSet(storage, options.index?.maxStagingBytes, options.signal);
  let failed = false;
  try {
    for await (const event of scanCosRangeObjects(source, options)) {
      if (event.kind !== "object" || !await visited.add(event.object.objectNumber)) continue;
      const entry = await index.get(event.object.objectNumber, options.signal);
      if (entry?.type !== "uncompressed") continue;
      yield entry.offset === event.object.span.start ? event.object : await parseCosRangeObject(source, entry.offset!, { ...options, recovery: "repair" });
    }
  } catch (error) { failed = true; throw error; }
  finally { await visited.close().catch(error => { if (!failed) throw error; }); }
}

/** Internal first recovery pass. A zero root is a placeholder until authenticated
 * compressed-object discovery completes; it must never escape to the caller. */
export async function recoverPdfReferences(source: PdfFileSource, storage: PdfIndexStorage, options: PdfCrossReferenceOptions): Promise<PdfCrossReference> {
  const prefix = new Uint8Array(Math.min(source.size, 1024)); let written = 0;
  for await (const chunk of source.stream(0, prefix.length, options.signal)) { prefix.set(chunk, written); written += chunk.length; }
  const head = new TextDecoder("latin1").decode(prefix); const signature = head.indexOf("%PDF-");
  // The normal open path already validated the header before deciding to repair.
  if (signature < 0) throw new PdfError("E_PARSE", "Invalid PDF header: missing %PDF- signature");
  const version = head.slice(signature + 5, signature + 8);
  const parseOptions = { ...options, recovery: "repair" as const };
  async function* rows() {
    for await (const event of scanCosRangeObjects(source, parseOptions)) if (event.kind === "object") {
      const object = event.object;
      yield { objectNumber: object.objectNumber, generationNumber: object.generationNumber, type: "uncompressed" as const, offset: object.span.start };
    }
  }
  const index = await PdfObjectIndex.build(rows(), storage, { ...options.index, maxEntries: Math.min(options.maxEntries ?? Infinity, options.index?.maxEntries ?? Infinity), duplicate: "last", ...(options.signal ? { signal: options.signal } : {}) });
  try {
    let rootRef: PdfCosRef | undefined; let infoRef: PdfCosRef | undefined; let packed = false;
    async function lookup(ref: PdfCosRef) {
      const entry = await index.get(ref.objectNumber, options.signal);
      if (!entry) return undefined;
      const object = await parseCosRangeObject(source, entry.offset!, parseOptions);
      return object.value;
    }
    for await (const object of recoveredBodies(source, index, storage, options)) {
      if (object.value.kind !== "dict") continue;
      const type = dictGet(object.value, "Type");
      if (object.stream && type?.kind === "name" && type.decoded === "ObjStm") packed = true;
      if (type?.kind === "name" && type.decoded === "Catalog") rootRef = cosRef(object.objectNumber, object.generationNumber);
      if (["Title", "Producer", "Author"].some(key => dictGet(object.value as PdfCosDict, key))) infoRef = cosRef(object.objectNumber, object.generationNumber);
    }
    let selected: PdfCosDict | undefined; let score = -1;
    for await (const event of scanCosRangeObjects(source, parseOptions)) {
      const trailer = event.kind === "trailer" ? event.trailer : event.object.stream && event.object.value.kind === "dict" &&
        dictGet(event.object.value, "Type")?.kind === "name" && (dictGet(event.object.value, "Type") as { decoded: string }).decoded === "XRef" ? event.object.value : undefined;
      if (!trailer) continue;
      const root = dictGet(trailer, "Root"); if (root?.kind !== "ref") continue;
      const catalog = await lookup(root);
      if (!catalog && !packed) continue;
      if (catalog) {
        if (catalog.kind !== "dict") continue;
        const pages = dictGet(catalog, "Pages");
        if (pages?.kind !== "dict") {
          if (pages?.kind !== "ref") continue;
          const pageTree = await lookup(pages);
          if (pageTree ? pageTree.kind !== "dict" : !packed) continue;
        }
      }
      const encrypt = dictGet(trailer, "Encrypt");
      const rank = ((encrypt?.kind === "dict" || encrypt?.kind === "ref") ? 2 : 0) + (dictGet(trailer, "ID")?.kind === "array" ? 1 : 0);
      if (rank >= score) { selected = trailer; score = rank; }
    }
    const trailer = selected ?? cosDict({});
    const root = dictGet(trailer, "Root"); const info = dictGet(trailer, "Info");
    const encrypt = dictGet(trailer, "Encrypt"); const id = dictGet(trailer, "ID");
    return { version, xrefOffset: 0, revisionCount: 0, index, trailer, rootRef: root?.kind === "ref" ? root : rootRef ?? cosRef(0),
      ...(info?.kind === "ref" ? { infoRef: info } : infoRef ? { infoRef } : {}),
      ...(encrypt?.kind === "ref" || encrypt?.kind === "dict" ? { encryptNode: encrypt } : {}), ...(id?.kind === "array" ? { idArray: id } : {}),
    };
  } catch (error) { try { await index.close(); } catch { /* Preserve discovery failure. */ } throw error; }
}
