import { readStoredItems } from "../content/stored-record.js";
import type { PdfCosDict, PdfCosNode, PdfCosRef } from "../ast.js";
import { PdfError } from "../errors.js";

export async function resolvePdfStreamDictionary(dict: PdfCosDict, lookup: (reference: PdfCosRef) => Promise<{ value: PdfCosNode } | undefined>,
  active: Set<number>, options: { maxNodes?: number; maxRecursionDepth?: number; signal?: AbortSignal; onBackingError?: (error: unknown) => void }): Promise<PdfCosDict> {
  let remaining = (options.maxNodes ?? 65536);
  const resolve = async (node: PdfCosNode, depth: number): Promise<PdfCosNode> => {
    if (--remaining < 0 || depth >= (options.maxRecursionDepth ?? 100)) throw new PdfError("E_LIMIT", "PDF filter resolution limit exceeded");
    if (node.kind === "ref") {
      if (active.has(node.objectNumber)) throw new PdfError("E_PARSE", "PDF filter reference cycle");
      const object = await lookup(node);
      if (!object) throw new PdfError("E_PARSE", "Missing PDF filter reference");
      active.add(node.objectNumber);
      try { return await resolve(object.value, depth + 1); } finally { active.delete(node.objectNumber); }
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
            items.push(await resolve(item.value, depth + 1));
          }
        } finally { await reader.return(); }
      } else for (const item of node.items) items.push(await resolve(item, depth + 1));
      return { ...ordinary, items };
    }
    if (node.kind === "dict") {
      const entries = [];
      for (const entry of node.entries) entries.push({ ...entry, value: await resolve(entry.value, depth + 1) });
      return { ...node, entries };
    }
    return node;
  };
  const entries = [];
  for (const entry of dict.entries) entries.push(["Filter", "F", "DecodeParms", "DP", "Type"].includes(entry.key.decoded) ? { ...entry, value: await resolve(entry.value, 0) } : entry);
  return { ...dict, entries };
}
