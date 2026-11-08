import { cosDict, cosNumber, decodePdfString, dictGet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "@poe-code/pdf-ast";
import { jsonRecord, type JsonValue } from "./json-output.js";

/** Page summaries share PDF semantics across the buffered and retained readers. */
export function* qpdfJsonPage(page: PdfCosDict, reference: PdfCosRef, index: number, root: PdfCosDict | undefined,
  version: number): Generator<PdfCosNode | undefined, JsonValue, PdfCosNode | undefined> {
  function json(node: PdfCosNode | undefined): JsonValue {
    if (!node || node.kind === "null") return null;
    switch (node.kind) {
      case "string": return `${version === 1 ? "" : "u:"}${decodePdfString(node)}`;
      case "name": return `/${node.decoded}`;
      case "ref": return referenceText(node);
      case "number": case "boolean": return node.value;
      case "array": return { kind: "array", values: node.items.map(json) };
      case "dict": return jsonRecord(Object.fromEntries(node.entries.map(entry => [`/${entry.key.decoded}`, json(entry.value)])));
      case "stream": return json(node.dict);
    }
  }
  const referenceText = (ref: PdfCosRef) => `${ref.objectNumber} ${ref.generationNumber} R`;
  function* dict(node: PdfCosNode | undefined): Generator<PdfCosNode | undefined, PdfCosDict | undefined, PdfCosNode | undefined> {
    const value = yield node; return value?.kind === "stream" ? value.dict : value?.kind === "dict" ? value : undefined;
  }
  function* tree(node: PdfCosNode | undefined, children: "Kids" | "First", visit: (node: PdfCosNode, value: PdfCosDict) => Generator<PdfCosNode | undefined, void, PdfCosNode | undefined>, ancestors = new Set<string>()): Generator<PdfCosNode | undefined, void, PdfCosNode | undefined> {
    if (!node) return;
    const key = node.kind === "ref" ? referenceText(node) : undefined;
    if (key && ancestors.has(key)) return;
    if (key) ancestors.add(key);
    try {
      const value = yield* dict(node); if (!value) return;
      yield* visit(node, value);
      const child = dictGet(value, children);
      if (children === "Kids") { const kids = yield child; if (kids?.kind === "array") for (const item of kids.items) yield* tree(item, children, visit, ancestors); }
      else { yield* tree(child, children, visit, ancestors); yield* tree(dictGet(value, "Next"), children, visit, ancestors); }
    } finally { if (key) ancestors.delete(key); }
  }
  const contents: JsonValue[] = [], images: JsonValue[] = [], outlines: JsonValue[] = [];
  const node = dictGet(page, "Contents"), value = yield node;
  for (const item of value?.kind === "array" ? value.items : node ? [node] : []) if (item.kind === "ref") contents.push(referenceText(item));
  let resources = dictGet(page, "Resources"), parent = dictGet(page, "Parent");
  const parents = new Set<string>();
  while (!resources && parent) {
    if (parent.kind === "ref") { const key = referenceText(parent); if (parents.has(key)) break; parents.add(key); }
    const value = yield* dict(parent); if (!value) break;
    resources = dictGet(value, "Resources"); parent = dictGet(value, "Parent");
  }
  let label: PdfCosDict | undefined, labelIndex = -1;
  yield* tree(root && dictGet(root, "PageLabels"), "Kids", function* (_node, value) {
    const nums = yield dictGet(value, "Nums");
    if (nums?.kind !== "array") return;
    for (let at = 0; at + 1 < nums.items.length; at += 2) {
      const start = yield nums.items[at];
      if (start?.kind === "number" && start.value <= index && start.value >= labelIndex) { label = yield* dict(nums.items[at + 1]); labelIndex = start.value; }
    }
  });
  if (label) {
    const start = yield dictGet(label, "St");
    label = cosDict({ ...Object.fromEntries(label.entries.map(entry => [entry.key.decoded, entry.value])), St: cosNumber((start?.kind === "number" ? start.value : 1) + index - labelIndex) });
  }
  const resource = yield* dict(resources), objects = resource && (yield* dict(dictGet(resource, "XObject")));
  for (const entry of objects?.entries.slice().sort((a, b) => a.key.decoded < b.key.decoded ? -1 : a.key.decoded > b.key.decoded ? 1 : 0) ?? []) {
    const image = yield* dict(entry.value), subtype = image && (yield dictGet(image, "Subtype"));
    if (!image || subtype?.kind !== "name" || subtype.decoded !== "Image") continue;
    const mask = yield dictGet(image, "ImageMask");
    if (mask?.kind === "boolean" && mask.value) continue;
    const filter = yield dictGet(image, "Filter"), parms = yield dictGet(image, "DecodeParms");
    const filters = filter?.kind === "array" ? filter.items : [filter];
    const parameters = parms?.kind === "array" ? parms.items : filters.map(() => parms);
    images.push(jsonRecord({ bitspercomponent: json(yield dictGet(image, "BitsPerComponent")), colorspace: json(yield dictGet(image, "ColorSpace")),
      decodeparms: { kind: "array", values: parameters.map(json) }, filter: { kind: "array", values: filters.map(json) },
      filterable: filters.every(item => !item || item.kind === "null" || item.kind === "name" && ["FlateDecode", "Fl", "LZWDecode", "LZW", "ASCII85Decode", "A85", "ASCIIHexDecode", "AHx", "RunLengthDecode", "RL"].includes(item.decoded)),
      height: json(yield dictGet(image, "Height")), name: `/${entry.key.decoded}`, object: json(entry.value), width: json(yield dictGet(image, "Width")) }));
  }
  const outlineRoot = root && (yield* dict(dictGet(root, "Outlines")));
  yield* tree(outlineRoot && dictGet(outlineRoot, "First"), "First", function* (node, value) {
    const action = yield* dict(dictGet(value, "A"));
    let dest = yield dictGet(value, "Dest") ?? (action && dictGet(action, "D"));
    if (dest?.kind === "name" || dest?.kind === "string") {
      const name = dest.kind === "name" ? dest.decoded : decodePdfString(dest), old = root && (yield* dict(dictGet(root, "Dests")));
      let found = dest.kind === "name" && old ? dictGet(old, name) : undefined;
      const names = root && (yield* dict(dictGet(root, "Names")));
      if (dest.kind === "string") yield* tree(names && dictGet(names, "Dests"), "Kids", function* (_node, value) {
        const pairs = yield dictGet(value, "Names");
        if (pairs?.kind === "array") for (let at = 0; at + 1 < pairs.items.length; at += 2) { const key = yield pairs.items[at]; if (key?.kind === "string" && decodePdfString(key) === name) found = pairs.items[at + 1]; }
      });
      dest = yield found;
    }
    if (dest?.kind === "dict") dest = yield dictGet(dest, "D");
    const target = dest?.kind === "array" ? dest.items[0] : undefined;
    if (target?.kind !== "ref" || referenceText(target) !== referenceText(reference)) return;
    const title = yield dictGet(value, "Title");
    outlines.push(jsonRecord({ dest: json(dest), object: json(node), title: title?.kind === "string" ? decodePdfString(title) : "" }));
  });
  return jsonRecord({ contents: { kind: "array", values: contents }, images: { kind: "array", values: images }, label: json(label), object: referenceText(reference), outlines: { kind: "array", values: outlines }, pageposfrom1: index + 1 });
}
