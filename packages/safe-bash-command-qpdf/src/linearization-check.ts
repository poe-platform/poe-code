import { PdfError } from "@poe-code/pdf-ast";
import { HintBits } from "./linearization-report.js";

interface LinearizationObjectRequest {
  kind: "object" | "page";
  number: number;
  objectNumber?: number;
  start?: number;
  end?: number;
}
interface LayoutRequest { kind: "layout"; layout?: { pages: number[][]; first: number[] } }
type Request = LayoutRequest | LinearizationObjectRequest | { kind: "file"; offset: number; length: number } | { offset: number; length: number };
type Check = Generator<Request, string[], Uint8Array>;

/** The same bounded reads drive buffered and retained-file validation. */
export function* checkLinearization(values: Record<string, number>, fileSize: number, declaredPages: number,
  hintSize: number, sharedOffset: number, mainXref: number, outlineOffset?: number): Check {
  const v = values;
  const warnings: string[] = [];
  const invalid = (message: string) => [...warnings, `invalid linearization: ${message}`];
  if (v.file_size !== fileSize) return invalid("file size mismatch");
  if (declaredPages !== v.npages || !declaredPages || !Number.isSafeInteger(v.first_page) || v.first_page! < 0 || v.first_page! >= declaredPages) return invalid("page count or first page mismatch");
  for (const key of ["H_offset", "H_length", "first_page_end", "xref_zero_offset"]) {
    if (!Number.isSafeInteger(v[key]) || v[key]! <= 0 || v[key]! >= fileSize) return invalid(`${key} out of range`);
  }
  // /T points to the whitespace before entry zero; for xref streams,
  // qpdf also accepts the start of the stream object.
  if (!Number.isSafeInteger(mainXref) || mainXref <= 0 || mainXref >= fileSize) return invalid("missing main xref");
  const xref = yield { kind: "file", offset: mainXref, length: Math.min(128, fileSize - mainXref) };
  const text = new TextDecoder().decode(xref);
  let zero = mainXref - 1;
  if (text.startsWith("xref")) {
    let pos = 4;
    const space = (c: string | undefined) => c === " " || c === "\r" || c === "\n" || c === "\t";
    while (space(text[pos])) pos++;
    if (text[pos++] !== "0" || !space(text[pos])) return invalid("main xref has no entry zero");
    while (space(text[pos])) pos++;
    while (text[pos] !== undefined && text[pos]! >= "0" && text[pos]! <= "9") pos++;
    zero = mainXref + pos;
  }
  // Native diagnostics print the entry position, while /T names its preceding space.
  if (v.xref_zero_offset !== zero && (text.startsWith("xref") || v.xref_zero_offset !== mainXref)) warnings.push(`space before first xref item (/T) mismatch (computed = ${zero + 1}; file = ${v.xref_zero_offset}`);
  const layoutRequest: LayoutRequest = { kind: "layout" }; yield layoutRequest;
  const layout = layoutRequest.layout;
  if (layout?.first.length) {
    let end = 0;
    for (const number of layout.first) {
      const object: LinearizationObjectRequest = { kind: "object", number }; yield object;
      end = Math.max(end, object.end ?? 0);
    }
    // Object spans end before endobj. Include that token, then its whitespace.
    let min = end, max = end, matched = 0;
    const keyword = new TextEncoder().encode("endobj");
    scan: for (let offset = end; offset < fileSize; offset += 4096) {
      const bytes = yield { kind: "file", offset, length: Math.min(4096, fileSize - offset) };
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i]!, whitespace = byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
        if (whitespace) { max = offset + i + 1; continue; }
        if (matched === keyword.length || byte !== keyword[matched++]) break scan;
        min = max = offset + i + 1;
      }
    }
    if (v.first_page_end! < min || v.first_page_end! > max) warnings.push(`end of first page section (/E) mismatch: /E = ${v.first_page_end}; computed = ${min}..${max}`);
  }
  if (v.H_offset! + v.H_length! > fileSize || !hintSize || !Number.isSafeInteger(sharedOffset) || sharedOffset < 0 || sharedOffset >= hintSize) return invalid("missing or invalid hint stream");
  const adjusted = (offset: number) => offset >= v.H_offset! ? offset + v.H_length! : offset;
  try {
    // Read against the stream boundary: malformed tables can overlap /S and
    // still contain enough data to diagnose each page independently.
    const page = new HintBits(hintSize);
    const minObjects = yield* page.read(32), firstOffset = adjusted(yield* page.read(32)), objectBits = yield* page.read(16);
    const minLength = yield* page.read(32), lengthBits = yield* page.read(16);
    const minContentOffset = yield* page.read(32), contentOffsetBits = yield* page.read(16);
    const minContentLength = yield* page.read(32), contentLengthBits = yield* page.read(16);
    const sharedBits = yield* page.read(16), identifierBits = yield* page.read(16), numeratorBits = yield* page.read(16);
    yield* page.read(16);
    const objects = page.column(declaredPages, objectBits), lengths = page.column(declaredPages, lengthBits), counts = page.column(declaredPages, sharedBits);
    let total = 0;
    for (let i = 0; i < declaredPages; i++) total += yield* counts.read(sharedBits);
    if (total > fileSize) return invalid("shared reference count out of range");
    const identifiers = page.column(total, identifierBits); page.column(total, numeratorBits);
    const offsets = page.column(declaredPages, contentOffsetBits), contents = page.column(declaredPages, contentLengthBits);
    const shared = new HintBits(hintSize, sharedOffset);
    const firstShared = yield* shared.read(32), sharedStart = adjusted(yield* shared.read(32));
    const firstGroups = yield* shared.read(32), groups = yield* shared.read(32), groupBits = yield* shared.read(16);
    const minGroupLength = yield* shared.read(32), groupLengthBits = yield* shared.read(16);
    if (firstGroups > groups || groups > fileSize) return invalid("shared object count out of range");
    for (let i = 0; i < (identifierBits ? total : Math.min(total, 1)); i++) if ((yield* identifiers.read(identifierBits)) >= groups) return invalid("shared object identifier out of range");
    function* endsAt(last: LinearizationObjectRequest, end: number): Generator<Request, boolean, Uint8Array> {
      if (last.end === undefined || end < last.end || end > fileSize) return false;
      const keyword = new TextEncoder().encode("endobj");
      let matched = 0;
      for (let offset = last.end; offset < end; offset += 4096) {
        const tail = yield { kind: "file", offset, length: Math.min(4096, end - offset) };
        for (const byte of tail) {
          const whitespace = byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
          if (whitespace && (matched === 0 || matched === keyword.length)) continue;
          if (byte !== keyword[matched++]) return false;
        }
      }
      return matched === keyword.length;
    }
    for (let i = 0; i < declaredPages; i++) {
      const count = minObjects + (yield* objects.read(objectBits)), length = minLength + (yield* lengths.read(lengthBits));
      const offset = minContentOffset + (yield* offsets.read(contentOffsetBits)), content = minContentLength + (yield* contents.read(contentLengthBits));
      const request: LinearizationObjectRequest = { kind: "page", number: i }; yield request;
      if (i === v.first_page && (request.objectNumber !== v.first_page_object || request.start !== firstOffset)) warnings.push("first page object offset mismatch");
      const computed = layout?.pages[i]?.length;
      if (computed !== undefined && count !== computed) {
        warnings.push(`object count mismatch for page ${i}: hint table = ${count}; computed = ${computed}`);
        continue;
      }
      if (request.start === undefined || request.objectNumber === undefined || count < 1 || count > fileSize) { warnings.push(`object count mismatch for page ${i}`); continue; }
      const last: LinearizationObjectRequest = { kind: "object", number: request.objectNumber + count - 1 }; yield last;
      const end = request.start + length;
      if (!(yield* endsAt(last, end)) || offset + content > length) warnings.push(`object count or length mismatch for page ${i}`);
    }
    const groupLengths = shared.column(groups, groupLengthBits), signatures = shared.column(groups, 1);
    for (let i = 0; i < groups; i++) if (yield* signatures.read(1)) shared.column(4, 32);
    const groupCounts = shared.column(groups, groupBits);
    let number = v.first_page_object!, start = firstOffset;
    for (let i = 0; i < groups; i++) {
      if (i === firstGroups) { number = firstShared; start = sharedStart; }
      const count = 1 + (yield* groupCounts.read(groupBits)), length = minGroupLength + (yield* groupLengths.read(groupLengthBits));
      const first: LinearizationObjectRequest = { kind: "object", number }; yield first;
      const last: LinearizationObjectRequest = { kind: "object", number: number + count - 1 }; yield last;
      if (first.start !== start || !(yield* endsAt(last, start + length))) warnings.push("shared object offset or length mismatch");
      number += count; start += length;
    }
    if (outlineOffset !== undefined) {
      const outline = new HintBits(hintSize, outlineOffset);
      const number = yield* outline.read(32), start = adjusted(yield* outline.read(32));
      const count = yield* outline.read(32), length = yield* outline.read(32);
      if (count) {
        const first: LinearizationObjectRequest = { kind: "object", number }; yield first;
        const last: LinearizationObjectRequest = { kind: "object", number: number + count - 1 }; yield last;
        if (first.start !== start || !(yield* endsAt(last, start + length))) warnings.push("outline hint mismatch");
      }
    }
  } catch (error) {
    if (!(error instanceof PdfError) || error.code !== "E_PARSE") throw error;
    return invalid(error.message);
  }
  return warnings;
}
