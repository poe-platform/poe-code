import type { PdfCosNode } from "../ast.js";
import type { ParsedCosDocument } from "./parser.js";

/** Remove obsolete streams, including object-stream containers holding old values. */
export function discardUnreachableObjects(doc: ParsedCosDocument): void {
  const reachable = new Set<number>();
  const visited = new Set<PdfCosNode>();
  const pending: PdfCosNode[] = [doc.rootRef];
  if (doc.infoRef) pending.push(doc.infoRef);
  if (doc.idArray) pending.push(doc.idArray);
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (node.kind === "ref") {
      if (reachable.has(node.objectNumber)) continue;
      const object = doc.objects.get(node.objectNumber);
      if (object && object.generationNumber === node.generationNumber) {
        reachable.add(node.objectNumber);
        pending.push(object.value);
      }
    } else if (node.kind === "array") {
      for (const item of node.items) pending.push(item);
    } else if (node.kind === "dict") {
      for (const entry of node.entries) pending.push(entry.value);
    } else if (node.kind === "stream") {
      pending.push(node.dict);
    }
  }
  for (const number of doc.objects.keys()) {
    if (!reachable.has(number)) doc.objects.delete(number);
  }
}
