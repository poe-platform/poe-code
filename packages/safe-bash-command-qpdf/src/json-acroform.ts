import { decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "@poe-code/pdf-ast";
import { jsonRecord, type JsonValue } from "./json-output.js";

/** Native qpdf reports one field per page widget, with inherited field attributes. */
export function* qpdfJsonField(annotation: PdfCosNode, page: number, form: PdfCosDict, version: number): Generator<PdfCosNode | undefined, JsonValue, PdfCosNode | undefined> {
  const field = yield annotation;
  if (field?.kind !== "dict") return null;
  const subtype = yield dictGet(field, "Subtype");
  if (subtype?.kind !== "name" || subtype.decoded !== "Widget") return null;
  const chain = [field], seen = new Set<PdfCosDict>(chain);
  const references = new Set<string>();
  if (annotation.kind === "ref") references.add(`${annotation.objectNumber} ${annotation.generationNumber}`);
  let parentNode = dictGet(field, "Parent");
  while (parentNode) {
    if (parentNode.kind === "ref") {
      const key = `${parentNode.objectNumber} ${parentNode.generationNumber}`;
      if (references.has(key)) break;
      references.add(key);
    }
    const parent = yield parentNode;
    if (parent?.kind !== "dict" || seen.has(parent)) break;
    seen.add(parent); chain.push(parent); parentNode = dictGet(parent, "Parent");
  }
  function* inherited(key: string): Generator<PdfCosNode | undefined, PdfCosNode | undefined, PdfCosNode | undefined> {
    for (const dict of [...chain, form]) {
      const value = yield dictGet(dict, key);
      if (value && value.kind !== "null") return value;
    }
    return undefined;
  }
  const text = (node: PdfCosNode | undefined) => node?.kind === "string" ? decodePdfString(node) : "";
  const name = (node: PdfCosNode | undefined) => node?.kind === "name" ? `/${node.decoded}` : "";
  const number = (node: PdfCosNode | undefined) => node?.kind === "number" ? node.value : 0;
  function json(node: PdfCosNode | undefined): JsonValue {
    if (!node || node.kind === "null") return null;
    switch (node.kind) {
      case "string": return `${version === 1 ? "" : "u:"}${decodePdfString(node)}`;
      case "name": return name(node);
      case "ref": return `${node.objectNumber} ${node.generationNumber} R`;
      case "number": case "boolean": return node.value;
      case "array": return { kind: "array", values: node.items.map(json) };
      case "dict": return jsonRecord(Object.fromEntries(node.entries.map(entry => [`/${entry.key.decoded}`, json(entry.value)])));
      case "stream": return json(node.dict);
    }
  }
  const names: string[] = [];
  for (const dict of chain) { const part = text(yield dictGet(dict, "T")); if (part) names.unshift(part); }
  const fullname = names.join("."), fieldtype = name(yield* inherited("FT")), fieldflags = number(yield* inherited("Ff"));
  const choices: JsonValue[] = [];
  if (fieldtype === "/Ch") {
    const options = yield* inherited("Opt");
    if (options?.kind === "array") for (const item of options.items) {
      const option = yield item;
      choices.push(text(option?.kind === "array" ? yield option.items[1] : option));
    }
  }
  return jsonRecord({
    alternativename: text(yield dictGet(field, "TU")) || fullname,
    annotation: jsonRecord({ annotationflags: number(yield dictGet(field, "F")), appearancestate: name(yield dictGet(field, "AS")), object: json(annotation) }),
    choices: { kind: "array", values: choices }, defaultvalue: json(yield* inherited("DV")), fieldflags, fieldtype, fullname,
    ischeckbox: fieldtype === "/Btn" && (fieldflags & (32768 | 65536)) === 0,
    ischoice: fieldtype === "/Ch", isradiobutton: fieldtype === "/Btn" && (fieldflags & 32768) !== 0, istext: fieldtype === "/Tx",
    mappingname: text(yield dictGet(field, "TM")) || fullname, object: json(annotation), pageposfrom1: page,
    parent: json(dictGet(field, "Parent")), partialname: text(yield dictGet(field, "T")), quadding: number(yield* inherited("Q")), value: json(yield* inherited("V"))
  });
}
