import { PdfReferenceSet, type PdfReferencePath } from "./reference-set.js";
import type { PdfIndexStorage } from "./object-index.js";
import { readStoredItems } from "../content/stored-record.js";
import type { PdfCosDict, PdfCosNode, PdfCosRef } from "../ast.js";
import { PdfError } from "../errors.js";

export async function resolvePdfStreamDictionary(dict: PdfCosDict, lookup: (reference: PdfCosRef, path: PdfReferencePath) => Promise<{ value: PdfCosNode } | undefined>,
  active: Set<number>, options: { referenceStorage: PdfIndexStorage; referencePath?: PdfReferencePath | undefined; maxTraversalStagingBytes?: number; maxNodes?: number; maxRecursionDepth?: number; signal?: AbortSignal; onBackingError?: (error: unknown) => void }): Promise<PdfCosDict> {
  let remaining = (options.maxNodes ?? 65536);
  const resolve = async (node: PdfCosNode, depth: number, parent = options.referencePath): Promise<PdfCosNode> => {
    let path = parent, owned: PdfReferencePath | undefined, failed = false;
    try {
      // A chain resolves to one value: intermediate references need identities,
      // not a suspended JavaScript resolver and resident Set entry per hop.
      for (;;) {
        options.signal?.throwIfAborted();
        if (--remaining < 0 || depth >= (options.maxRecursionDepth ?? 100)) throw new PdfError("E_LIMIT", "PDF filter resolution limit exceeded");
        if (node.kind !== "ref") break;
        if (active.has(node.objectNumber)) throw new PdfError("E_PARSE", "PDF filter reference cycle");
        for (let ancestor = path; ancestor; ancestor = ancestor.parent) {
          const seen = await ancestor.seen.has(node.objectNumber).catch(error => { options.onBackingError?.(error); throw error; });
          if (seen) throw new PdfError("E_PARSE", "PDF filter reference cycle");
        }
        owned ??= { seen: new PdfReferenceSet(options.referenceStorage, options.maxTraversalStagingBytes, options.signal), parent, depth: 0 };
        path = owned;
        const object = await lookup(node, path);
        if (!object) throw new PdfError("E_PARSE", "Missing PDF filter reference");
        await path.seen.add(node.objectNumber).catch(error => { options.onBackingError?.(error); throw error; });
        path.depth++; depth++; node = object.value;
        if (path.depth % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (node.kind === "array") {
        const items: PdfCosNode[] = [];
        const { storedItems, ...ordinary } = node;
        if (storedItems) {
          const reader = readStoredItems<PdfCosNode>(storedItems, options.signal);
          try {
            for (;;) {
              const item = await reader.next().catch(error => { options.onBackingError?.(error); throw error; });
              if (item.done) break;
              items.push(await resolve(item.value, depth + 1, path));
            }
          } finally { await reader.return(); }
        } else for (const item of node.items) items.push(await resolve(item, depth + 1, path));
        return { ...ordinary, items };
      }
      if (node.kind === "dict") {
        const entries = [];
        for (const entry of node.entries) entries.push({ ...entry, value: await resolve(entry.value, depth + 1, path) });
        return { ...node, entries };
      }
      return node;
    } catch (error) { failed = true; throw error; }
    finally {
      try { await owned?.seen.close(); }
      catch (error) { if (!failed) { options.onBackingError?.(error); await Promise.reject(error); } }
    }
  };
  const entries = [];
  for (const entry of dict.entries) entries.push(["Filter", "F", "DecodeParms", "DP", "Type"].includes(entry.key.decoded) ? { ...entry, value: await resolve(entry.value, 0) } : entry);
  return { ...dict, entries };
}
