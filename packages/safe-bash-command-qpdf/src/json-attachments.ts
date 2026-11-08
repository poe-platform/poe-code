import { decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "@poe-code/pdf-ast";
import { jsonRecord, type JsonValue } from "./json-output.js";

function attachmentDate(value: string | null): string | null {
  if (!value?.startsWith("D:") || value.length < 16) return null;
  for (const digit of value.slice(2, 16)) if (digit < "0" || digit > "9") return null;
  let zone = "Z";
  if (value.length > 16 && value[16] !== "Z") {
    if (value.length !== 23 || !["+", "-"].includes(value[16]!) || value[19] !== "'" || value[22] !== "'") return null;
    for (const digit of value.slice(17, 19) + value.slice(20, 22)) if (digit < "0" || digit > "9") return null;
    zone = `${value.slice(16, 19)}:${value.slice(20, 22)}`;
  }
  return `${value.slice(2, 6)}-${value.slice(6, 8)}-${value.slice(8, 10)}T${value.slice(10, 12)}:${value.slice(12, 14)}:${value.slice(14, 16)}${zone}`;
}

/** Resolve the same attachment summary through buffered or retained COS readers. */
export function* qpdfJsonAttachment(filespec: PdfCosNode): Generator<PdfCosNode | undefined, JsonValue, PdfCosNode | undefined> {
  const text = (node: PdfCosNode | undefined) => node?.kind === "string" ? decodePdfString(node) : null;
  const reference = (node: PdfCosNode | undefined) => node?.kind === "ref" ? `${node.objectNumber} ${node.generationNumber} R` : null;
  function* dictionary(node: PdfCosNode | undefined): Generator<PdfCosNode | undefined, PdfCosDict | undefined, PdfCosNode | undefined> {
    const value = yield node; return value?.kind === "stream" ? value.dict : value?.kind === "dict" ? value : undefined;
  }
  const spec = yield* dictionary(filespec);
  const names: Record<string, JsonValue> = {}, streams: Record<string, JsonValue> = {};
  const embedded = yield* dictionary(spec && dictGet(spec, "EF"));
  let preferredname: string | null = null, preferredcontents: string | null = null;
  for (const key of ["UF", "F", "DOS", "Mac", "Unix"]) {
    const name = text(yield spec && dictGet(spec, key));
    if (name !== null) { names[`/${key}`] = name; preferredname ??= name; }
    const streamRef = embedded && dictGet(embedded, key), stream = yield* dictionary(streamRef);
    if (!stream) continue;
    preferredcontents ??= reference(streamRef);
    const params = yield* dictionary(dictGet(stream, "Params"));
    const checksum = yield params && dictGet(params, "CheckSum"), subtype = yield dictGet(stream, "Subtype");
    const date = attachmentDate(text(yield params && dictGet(params, "CreationDate")));
    streams[`/${key}`] = jsonRecord({ checksum: checksum?.kind === "string" ? Array.from(checksum.bytes, byte => byte.toString(16).padStart(2, "0")).join("") : null,
      creationdate: date, mimetype: subtype?.kind === "name" ? subtype.decoded : null,
      // Native qpdf uses the creation date for both fields.
      modificationdate: date });
  }
  return jsonRecord({ description: text(yield spec && dictGet(spec, "Desc")), filespec: reference(filespec),
    names: jsonRecord(names), preferredcontents, preferredname, streams: jsonRecord(streams) });
}
