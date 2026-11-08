import { decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "@poe-code/pdf-ast";
import { jsonRecord, type JsonValue } from "./json-output.js";

/** Shared outline semantics for buffered and retained JSON readers. */
export function* qpdfJsonOutlines(root: PdfCosDict | undefined, pagePositions: ReadonlyMap<string, number>, version: number): Generator<PdfCosNode | undefined, JsonValue[], PdfCosNode | undefined> {
  const reference = (node: PdfCosNode) => node.kind === "ref" ? `${node.objectNumber} ${node.generationNumber} R` : undefined;
  function json(node: PdfCosNode | undefined): JsonValue {
    if (!node || node.kind === "null") return null;
    switch (node.kind) {
      case "ref": return reference(node)!;
      case "string": return `${version === 1 ? "" : "u:"}${decodePdfString(node)}`;
      case "name": return `/${node.decoded}`;
      case "number": case "boolean": return node.value;
      case "array": return { kind: "array", values: node.items.map(json) };
      case "dict": return jsonRecord(Object.fromEntries(node.entries.map(entry => [`/${entry.key.decoded}`, json(entry.value)])));
      case "stream": return json(node.dict);
    }
  }
  function* dict(node: PdfCosNode | undefined): Generator<PdfCosNode | undefined, PdfCosDict | undefined, PdfCosNode | undefined> {
    const value = yield node; return value?.kind === "dict" ? value : undefined;
  }
  function* namedDestination(node: PdfCosNode | undefined, name: string, visited = new Set<string>()): Generator<PdfCosNode | undefined, PdfCosNode | undefined, PdfCosNode | undefined> {
    if (!node) return;
    const key = reference(node);
    if (key && visited.has(key)) return;
    if (key) visited.add(key);
    const tree = yield* dict(node); if (!tree) return;
    const pairs = yield dictGet(tree, "Names");
    if (pairs?.kind === "array") for (let i = 0; i + 1 < pairs.items.length; i += 2) {
      const key = yield pairs.items[i];
      if (key?.kind === "string" && decodePdfString(key) === name) return pairs.items[i + 1];
    }
    const kids = yield dictGet(tree, "Kids");
    if (kids?.kind === "array") for (const kid of kids.items) {
      const found = yield* namedDestination(kid, name, visited); if (found) return found;
    }
  }
  const visited = new Set<string>();
  function* siblings(node: PdfCosNode | undefined): Generator<PdfCosNode | undefined, JsonValue[], PdfCosNode | undefined> {
    const result: JsonValue[] = [];
    while (node) {
      const key = reference(node);
      if (key && visited.has(key)) break;
      if (key) visited.add(key);
      const value = yield* dict(node); if (!value) break;
      const action = yield* dict(dictGet(value, "A"));
      let dest = yield dictGet(value, "Dest") ?? (action && dictGet(action, "D"));
      if (dest?.kind === "name" || dest?.kind === "string") {
        let found: PdfCosNode | undefined;
        if (dest.kind === "name") {
          const old = root && (yield* dict(dictGet(root, "Dests")));
          found = old && dictGet(old, dest.decoded);
        } else {
          const names = root && (yield* dict(dictGet(root, "Names")));
          found = yield* namedDestination(names && dictGet(names, "Dests"), decodePdfString(dest));
        }
        dest = yield found;
      }
      if (dest?.kind === "dict") dest = yield dictGet(dest, "D");
      const target = dest?.kind === "array" ? dest.items[0] : undefined;
      const title = yield dictGet(value, "Title"), count = yield dictGet(value, "Count");
      result.push(jsonRecord({ dest: json(dest), destpageposfrom1: target ? pagePositions.get(reference(target) ?? "") ?? null : null,
        kids: { kind: "array", values: yield* siblings(dictGet(value, "First")) }, object: json(node),
        open: count?.kind !== "number" || count.value >= 0, title: title?.kind === "string" ? decodePdfString(title) : "" }));
      node = dictGet(value, "Next");
    }
    return result;
  }
  const outlines = root && (yield* dict(dictGet(root, "Outlines")));
  return yield* siblings(outlines && dictGet(outlines, "First"));
}
