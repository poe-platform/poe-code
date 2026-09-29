import { assertDecodedByteBudget } from "./limits.js";
import {
  decodePdfString,
  dictGet,
  type PdfCosArray,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosRef,
  type PdfCosStream,
  type PdfDictEntry,
  type PdfEncryptionState,
  type PdfIndirectObject,
  type PdfRevision,
  type PdfXRefEntry,
} from "../ast.js";
import { PdfError } from "../errors.js";
import { decodeStreamObject } from "./filters.js";
import { CosByteLexer, type CosToken } from "./lexer.js";
import { authenticateStandardEncryption, decryptCosDocument } from "./security.js";

export interface ParseCosOptions {
  readonly password?: string | undefined;
  readonly recovery?: "strict" | "repair" | undefined;
  readonly maxObjects?: number | undefined;
  readonly maxDecompressedBytes?: number | undefined;
  readonly maxRecursionDepth?: number | undefined;
}

export class ParsedCosDocument {
  version: string;
  readonly bytes: Uint8Array;
  readonly objects: Map<number, PdfIndirectObject>;
  readonly revisions: readonly PdfRevision[];
  rootRef: PdfCosRef;
  infoRef?: PdfCosRef | undefined;
  encryptRef?: PdfCosRef | undefined;
  idArray?: PdfCosArray | undefined;
  encryption?: PdfEncryptionState | undefined;
  /** Destructive edits must not retain obsolete objects or earlier file revisions. */
  requiresFullRewrite = false;
  readonly maxDecompressedBytes: number;
  private readonly maxRecursionDepth: number;

  constructor(params: {
    version: string;
    bytes: Uint8Array;
    objects: Map<number, PdfIndirectObject>;
    revisions: readonly PdfRevision[];
    rootRef: PdfCosRef;
    infoRef?: PdfCosRef | undefined;
    encryptRef?: PdfCosRef | undefined;
    idArray?: PdfCosArray | undefined;
    encryption?: PdfEncryptionState | undefined;
    maxDecompressedBytes?: number | undefined;
    maxRecursionDepth?: number | undefined;
  }) {
    this.version = params.version;
    this.bytes = params.bytes;
    this.objects = params.objects;
    this.revisions = params.revisions;
    this.rootRef = params.rootRef;
    this.infoRef = params.infoRef;
    this.encryptRef = params.encryptRef;
    this.idArray = params.idArray;
    this.encryption = params.encryption;
    this.maxDecompressedBytes = params.maxDecompressedBytes ?? Infinity;
    this.maxRecursionDepth = params.maxRecursionDepth ?? Infinity;
  }

  get maxObjectNumber(): number {
    let max = 0;
    for (const num of this.objects.keys()) {
      if (num > max) max = num;
    }
    return max;
  }

  getObject(objectNumber: number): PdfCosNode | undefined {
    return this.objects.get(objectNumber)?.value;
  }

  setObject(objectNumber: number, value: PdfCosNode, generationNumber = 0): void {
    this.objects.set(objectNumber, {
      objectNumber,
      generationNumber,
      value,
    });
  }

  allocateObject(value: PdfCosNode): PdfCosRef {
    const objectNumber = this.maxObjectNumber + 1;
    this.setObject(objectNumber, value, 0);
    return { kind: "ref", objectNumber, generationNumber: 0 };
  }

  resolve(node: PdfCosNode | undefined, depth = 0): PdfCosNode | undefined {
    const visited = new Set<number>();
    while (node) {
      if (depth > this.maxRecursionDepth) {
        throw new PdfError("E_CAPABILITY", "PDF indirect reference recursion limit exceeded");
      }
      if (node.kind !== "ref") return node;
      // Like PDF.js XRef's pending references, this state belongs to one lookup.
      if (visited.has(node.objectNumber)) {
        throw new PdfError("E_PARSE", "Circular PDF indirect reference");
      }
      visited.add(node.objectNumber);
      node = this.objects.get(node.objectNumber)?.value;
      depth++;
    }
    return undefined;
  }

  resolveDict(node: PdfCosNode | undefined): PdfCosDict | undefined {
    const resolved = this.resolve(node);
    if (resolved?.kind === "dict") return resolved;
    if (resolved?.kind === "stream") return resolved.dict;
    return undefined;
  }

  resolveArray(node: PdfCosNode | undefined): PdfCosArray | undefined {
    const resolved = this.resolve(node);
    return resolved?.kind === "array" ? resolved : undefined;
  }

  getDecodedStream(objectNumber: number): Uint8Array | undefined {
    const obj = this.getObject(objectNumber);
    if (!obj || obj.kind !== "stream") return undefined;
    return this.decodeStream(obj);
  }

  decodeStream(stream: PdfCosStream): Uint8Array {
    if (stream.decodedBytes) {
      assertDecodedByteBudget(stream.decodedBytes.byteLength, this.maxDecompressedBytes);
      return stream.decodedBytes;
    }
    const decoded = decodeStreamObject(stream, this.maxDecompressedBytes, n => this.resolve(n));
    assertDecodedByteBudget(decoded.byteLength, this.maxDecompressedBytes);
    (stream as { decodedBytes?: Uint8Array }).decodedBytes = decoded;
    return decoded;
  }

  getInfoString(key: string): string | undefined {
    if (!this.infoRef) return undefined;
    const dict = this.resolveDict(this.infoRef);
    if (!dict) return undefined;
    const val = this.resolve(dictGet(dict, key));
    if (!val) return undefined;
    if (val.kind === "string") {
      return decodePdfString(val);
    }
    if (val.kind === "name") {
      return val.decoded;
    }
    return undefined;
  }
}

function parseNodeFromLexer(lexer: CosByteLexer, bytes: Uint8Array, maxDepth: number, recoverEmptyObject = false): PdfCosNode | undefined {
  type Container =
    | { kind: "array"; start: number; items: PdfCosNode[] }
    | { kind: "dict"; start: number; entries: PdfDictEntry[]; key?: PdfDictEntry["key"] };
  const stack: Container[] = [];
  while (true) {
    const tok = lexer.nextToken();
    const parent = stack.at(-1);
    if (!tok) {
      if (!parent) return undefined;
      throw new PdfError("E_PARSE", parent.kind === "array" ? "Unterminated PDF array" : "Unterminated PDF dictionary");
    }
    // Eager COS materialization also visits unused dummy objects that PDF.js
    // need not fetch. Preserve them as null only during document recovery.
    if (!parent && recoverEmptyObject && tok.kind === "keyword" && tok.value === "endobj") {
      return { kind: "null", span: tok.span };
    }
    let node: PdfCosNode;
    if (parent?.kind === "array" && tok.kind === "array-end") {
      stack.pop();
      node = { kind: "array", items: parent.items, span: { start: parent.start, end: tok.span.end } };
    } else if (parent?.kind === "dict" && !parent.key) {
      if (tok.kind === "dict-end") {
        stack.pop();
        node = parseDictionaryStream({ kind: "dict", entries: parent.entries, span: { start: parent.start, end: tok.span.end } }, lexer, bytes);
      } else if (tok.kind === "name") {
        parent.key = { kind: "name", rawBytes: tok.rawBytes, decoded: tok.decoded, span: tok.span };
        continue;
      } else {
        throw new PdfError("E_PARSE", `Expected dictionary key /Name, got ${tok.kind}`);
      }
    } else {
      if (parent?.kind === "dict" && tok.kind === "dict-end") {
        throw new PdfError("E_PARSE", `Missing value for dictionary key /${parent.key!.decoded}`);
      }
      if (stack.length > maxDepth) throw new PdfError("E_LIMIT", "PDF syntax nesting limit exceeded");
      if (tok.kind === "array-start") {
        stack.push({ kind: "array", start: tok.span.start, items: [] });
        continue;
      }
      if (tok.kind === "dict-start") {
        stack.push({ kind: "dict", start: tok.span.start, entries: [] });
        continue;
      }
      node = parseLeafFromToken(tok, lexer);
    }
    const container = stack.at(-1);
    if (!container) return node;
    if (container.kind === "array") container.items.push(node);
    else {
      container.entries.push({ key: container.key!, value: node });
      delete container.key;
    }
  }
}

function resolveIndirectIntegerFromBytes(
  bytes: Uint8Array,
  objectNumber: number,
  generationNumber: number
): number | undefined {
  const pattern = new TextEncoder().encode(`${objectNumber} ${generationNumber} obj`);
  const pos = findSubsequence(bytes, pattern, 0);
  if (pos < 0) return undefined;
  const lex = new CosByteLexer(bytes, pos + pattern.length);
  const tok = lex.nextToken();
  if (tok?.kind === "number" && tok.isInteger && tok.value >= 0) {
    return tok.value;
  }
  return undefined;
}

function findEndstreamBeforeEndobj(bytes: Uint8Array, fromIndex: number): number {
  let searchPos = fromIndex;
  let firstMatch = -1;
  while (searchPos <= bytes.length - ENDSTREAM_BYTES.length) {
    const idx = findSubsequence(bytes, ENDSTREAM_BYTES, searchPos);
    if (idx < 0) break;
    if (firstMatch < 0) firstMatch = idx;
    const lex = new CosByteLexer(bytes, idx + ENDSTREAM_BYTES.length);
    const nextTok = lex.nextToken();
    if (nextTok?.kind === "keyword" && nextTok.value === "endobj") {
      return idx;
    }
    searchPos = idx + ENDSTREAM_BYTES.length;
  }
  return firstMatch;
}

function parseLeafFromToken(tok: CosToken, lexer: CosByteLexer): PdfCosNode {
  switch (tok.kind) {
    case "null":
      return { kind: "null", span: tok.span };
    case "boolean":
      return { kind: "boolean", value: tok.value, span: tok.span };
    case "number": {
      const savedOffset = lexer.offset;
      const t2 = lexer.nextToken();
      if (t2?.kind === "number" && Number.isInteger(tok.value) && Number.isInteger(t2.value)) {
        const t3 = lexer.nextToken();
        if (t3?.kind === "keyword" && t3.value === "R") {
          return {
            kind: "ref",
            objectNumber: tok.value,
            generationNumber: t2.value,
            span: { start: tok.span.start, end: t3.span.end },
          };
        }
      }
      lexer.offset = savedOffset;
      return {
        kind: "number",
        value: tok.value,
        isInteger: Number.isInteger(tok.value) && !tok.raw.includes("."),
        raw: tok.raw,
        span: tok.span,
      };
    }
    case "name":
      return { kind: "name", rawBytes: tok.rawBytes, decoded: tok.decoded, span: tok.span };
    case "string":
      return { kind: "string", encoding: "literal", bytes: tok.bytes, span: tok.span };
    case "hex-string":
      return { kind: "string", encoding: "hex", bytes: tok.bytes, span: tok.span };
    default:
      throw new PdfError("E_PARSE", `Unexpected PDF token: ${tok.kind}`);
  }
}

function parseDictionaryStream(dictNode: PdfCosDict, lexer: CosByteLexer, bytes: Uint8Array): PdfCosNode {
  const savedAfterDict = lexer.offset;
  const maybeStreamTok = lexer.nextToken();
  if (maybeStreamTok?.kind === "keyword" && maybeStreamTok.value === "stream") {
    let streamStart = lexer.offset;
    if (bytes[streamStart] === 0x0d && bytes[streamStart + 1] === 0x0a) {
      streamStart += 2;
    } else if (bytes[streamStart] === 0x0a || bytes[streamStart] === 0x0d) {
      streamStart += 1;
    }

    const lengthEntry = dictGet(dictNode, "Length");
    const resolvedLength =
      lengthEntry?.kind === "number"
        ? lengthEntry.value
        : lengthEntry?.kind === "ref"
          ? resolveIndirectIntegerFromBytes(bytes, lengthEntry.objectNumber, lengthEntry.generationNumber)
          : undefined;
    let rawStreamBytes: Uint8Array | undefined;
    let streamEnd = streamStart;
    if (resolvedLength !== undefined && resolvedLength >= 0 && streamStart + resolvedLength <= bytes.length) {
      const candidateEnd = streamStart + resolvedLength;
      const tailSlice = bytes.subarray(candidateEnd, Math.min(bytes.length, candidateEnd + 32));
      const tailStr = new TextDecoder("latin1").decode(tailSlice);
      if (tailStr.includes("endstream")) {
        rawStreamBytes = bytes.subarray(streamStart, candidateEnd);
        streamEnd = candidateEnd + tailStr.indexOf("endstream") + "endstream".length;
      }
    }
    if (!rawStreamBytes) {
      const marker = findEndstreamBeforeEndobj(bytes, streamStart);
      if (marker < 0) {
        throw new PdfError("E_PARSE", "Missing endstream keyword in PDF stream object");
      }
      let dataEnd = marker;
      if (bytes[dataEnd - 2] === 0x0d && bytes[dataEnd - 1] === 0x0a) {
        dataEnd -= 2;
      } else if (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d) {
        dataEnd -= 1;
      }
      rawStreamBytes = bytes.subarray(streamStart, Math.max(streamStart, dataEnd));
      streamEnd = marker + ENDSTREAM_BYTES.length;
    }
    lexer.offset = streamEnd;
    return {
      kind: "stream",
      dict: dictNode,
      rawBytes: rawStreamBytes,
      span: { start: dictNode.span!.start, end: streamEnd },
    };
  }
  lexer.offset = savedAfterDict;
  return dictNode;
}

const ENDSTREAM_BYTES = new TextEncoder().encode("endstream");
const STARTXREF_BYTES = new TextEncoder().encode("startxref");

function findSubsequence(haystack: Uint8Array, needle: Uint8Array, fromIndex = 0): number {
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function findLastSubsequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = haystack.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function parseHeaderVersion(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  const idx = head.indexOf("%PDF-");
  if (idx < 0) {
    throw new PdfError("E_PARSE", "Invalid PDF header: missing %PDF- signature");
  }
  return head.slice(idx + 5, idx + 8);
}

function parseObjectAtOffset(bytes: Uint8Array, offset: number, maxRecursionDepth: number, recoverEmptyObject = false): PdfIndirectObject {
  const lexer = new CosByteLexer(bytes, offset);
  const objNumTok = lexer.nextToken();
  const genNumTok = lexer.nextToken();
  const objKwTok = lexer.nextToken();
  if (
    objNumTok?.kind !== "number" ||
    genNumTok?.kind !== "number" ||
    objKwTok?.kind !== "keyword" ||
    objKwTok.value !== "obj"
  ) {
    throw new PdfError("E_PARSE", `Malformed indirect object header at byte offset ${offset}`);
  }
  const value = parseNodeFromLexer(lexer, bytes, maxRecursionDepth, recoverEmptyObject);
  if (!value) {
    throw new PdfError("E_PARSE", `Empty indirect object ${objNumTok.value} at offset ${offset}`);
  }
  return {
    objectNumber: objNumTok.value,
    generationNumber: genNumTok.value,
    value,
    span: { start: objNumTok.span.start, end: lexer.offset },
  };
}

function parseXrefRevisionAt(bytes: Uint8Array, xrefOffset: number, maxDecompressedBytes: number, maxRecursionDepth: number): PdfRevision {
  if (xrefOffset < 0 || xrefOffset >= bytes.length) {
    throw new PdfError("E_PARSE", `Invalid xref offset: ${xrefOffset}`);
  }
  const lexer = new CosByteLexer(bytes, xrefOffset);
  const firstTok = lexer.nextToken();
  if (!firstTok) {
    throw new PdfError("E_PARSE", `Empty xref at offset ${xrefOffset}`);
  }

  if (firstTok.kind === "keyword" && firstTok.value === "xref") {
    const entries = new Map<number, PdfXRefEntry>();
    while (true) {
      const saved = lexer.offset;
      const tok = lexer.nextToken();
      if (!tok) {
        throw new PdfError("E_PARSE", "Unexpected EOF in xref table");
      }
      if (tok.kind === "keyword" && tok.value === "trailer") {
        break;
      }
      if (tok.kind !== "number") {
        lexer.offset = saved;
        break;
      }
      const startObj = tok.value;
      const countTok = lexer.nextToken();
      if (countTok?.kind !== "number") {
        throw new PdfError("E_PARSE", "Malformed xref subsection header");
      }
      const count = countTok.value;
      for (let i = 0; i < count; i++) {
        const offTok = lexer.nextToken();
        const genTok = lexer.nextToken();
        const flagTok = lexer.nextToken();
        if (offTok?.kind !== "number" || genTok?.kind !== "number" || flagTok?.kind !== "keyword") {
          throw new PdfError("E_PARSE", "Malformed xref entry row");
        }
        const objNum = startObj + i;
        if (flagTok.value === "n") {
          entries.set(objNum, {
            type: "uncompressed",
            objectNumber: objNum,
            offset: offTok.value,
            generationNumber: genTok.value,
          });
        } else {
          entries.set(objNum, {
            type: "free",
            objectNumber: objNum,
            nextFreeObjectNumber: offTok.value,
            generationNumber: genTok.value,
          });
        }
      }
    }
    const trailerNode = parseNodeFromLexer(lexer, bytes, maxRecursionDepth);
    if (!trailerNode || trailerNode.kind !== "dict") {
      throw new PdfError("E_PARSE", "Missing trailer dictionary after xref table");
    }
    const prevNode = dictGet(trailerNode, "Prev");
    return {
      xrefOffset,
      trailer: trailerNode,
      entries,
      previousXrefOffset: prevNode?.kind === "number" ? prevNode.value : undefined,
    };
  }

  // Cross-reference stream (PDF 1.5+)
  const xrefObj = parseObjectAtOffset(bytes, xrefOffset, maxRecursionDepth);
  if (xrefObj.value.kind !== "stream") {
    throw new PdfError("E_PARSE", `Expected xref table or XRef stream at offset ${xrefOffset}`);
  }
  const dict = xrefObj.value.dict;
  const wArray = dictGet(dict, "W");
  const sizeNode = dictGet(dict, "Size");
  if (wArray?.kind !== "array" || wArray.items.length < 3 || sizeNode?.kind !== "number") {
    throw new PdfError("E_PARSE", "Invalid XRef stream dictionary: missing /W or /Size");
  }
  const w0 = wArray.items[0]?.kind === "number" ? wArray.items[0].value : 0;
  const w1 = wArray.items[1]?.kind === "number" ? wArray.items[1].value : 0;
  const w2 = wArray.items[2]?.kind === "number" ? wArray.items[2].value : 0;
  const stride = w0 + w1 + w2;

  const indexArray = dictGet(dict, "Index");
  const subsections: Array<[number, number]> = [];
  if (indexArray?.kind === "array" && indexArray.items.length >= 2) {
    for (let i = 0; i + 1 < indexArray.items.length; i += 2) {
      const first = indexArray.items[i];
      const count = indexArray.items[i + 1];
      if (first?.kind === "number" && count?.kind === "number") {
        subsections.push([first.value, count.value]);
      }
    }
  } else {
    subsections.push([0, sizeNode.value]);
  }

  const decoded = decodeStreamObject(xrefObj.value, maxDecompressedBytes);
  const entries = new Map<number, PdfXRefEntry>();
  let pos = 0;

  const readInt = (len: number): number => {
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = v * 256 + (decoded[pos++] ?? 0);
    }
    return v;
  };

  for (const [startObj, count] of subsections) {
    for (let i = 0; i < count && pos + stride <= decoded.length; i++) {
      const objNum = startObj + i;
      const field0 = w0 > 0 ? readInt(w0) : 1;
      const field1 = readInt(w1);
      const field2 = w2 > 0 ? readInt(w2) : 0;
      if (field0 === 0) {
        entries.set(objNum, {
          type: "free",
          objectNumber: objNum,
          nextFreeObjectNumber: field1,
          generationNumber: field2,
        });
      } else if (field0 === 1) {
        entries.set(objNum, {
          type: "uncompressed",
          objectNumber: objNum,
          offset: field1,
          generationNumber: field2,
        });
      } else if (field0 === 2) {
        entries.set(objNum, {
          type: "compressed",
          objectNumber: objNum,
          objectStreamNumber: field1,
          indexInStream: field2,
        });
      }
    }
  }

  const prevNode = dictGet(dict, "Prev");
  return {
    xrefOffset,
    trailer: dict,
    entries,
    previousXrefOffset: prevNode?.kind === "number" ? prevNode.value : undefined,
  };
}

function isAsciiWhitespace(ch: number): boolean {
  return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0c || ch === 0x00;
}

function isAsciiDigit(ch: number): boolean {
  return ch >= 0x30 && ch <= 0x39;
}

function repairScanCosDocument(bytes: Uint8Array, maxObjects: number, maxRecursionDepth: number): {
  objects: Map<number, PdfIndirectObject>;
  trailers: PdfCosDict[];
} {
  const objects = new Map<number, PdfIndirectObject>();
  const trailers: PdfCosDict[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    // Like PDF.js XRef.indexObjects, retain trailers before trying ObjStm
    // decoding: their Encrypt/ID entries are needed to decrypt those streams.
    while (pos < bytes.length && !isAsciiDigit(bytes[pos]!)) {
      if (bytes[pos] === 0x25) {
        while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) pos++;
        continue;
      }
      if (bytes[pos] === 0x74 && (pos === 0 || isAsciiWhitespace(bytes[pos - 1]!))) {
        const lexer = new CosByteLexer(bytes, pos);
        try {
          const token = lexer.nextToken();
          if (token?.kind === "keyword" && token.value === "trailer") {
            const trailer = parseNodeFromLexer(lexer, bytes, maxRecursionDepth);
            if (trailer?.kind === "dict") trailers.push(trailer);
            pos = lexer.offset;
            continue;
          }
        } catch (error) {
          if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
          // Continue scanning past a damaged trailer.
        }
      }
      pos++;
    }
    if (pos >= bytes.length) break;
    if (pos > 0 && !isAsciiWhitespace(bytes[pos - 1]!)) {
      while (pos < bytes.length && !isAsciiWhitespace(bytes[pos]!)) pos++;
      continue;
    }
    const headerStart = pos;
    while (pos < bytes.length && isAsciiDigit(bytes[pos]!)) pos++;
    if (pos >= bytes.length || !isAsciiWhitespace(bytes[pos]!)) continue;
    while (pos < bytes.length && isAsciiWhitespace(bytes[pos]!)) pos++;
    const genStart = pos;
    while (pos < bytes.length && isAsciiDigit(bytes[pos]!)) pos++;
    if (pos === genStart || pos >= bytes.length || !isAsciiWhitespace(bytes[pos]!)) continue;
    while (pos < bytes.length && isAsciiWhitespace(bytes[pos]!)) pos++;
    if (
      pos + 3 <= bytes.length &&
      bytes[pos] === 0x6f && // 'o'
      bytes[pos + 1] === 0x62 && // 'b'
      bytes[pos + 2] === 0x6a && // 'j'
      (pos + 3 === bytes.length ||
        isAsciiWhitespace(bytes[pos + 3]!) ||
        bytes[pos + 3] === 0x3c || // '<'
        bytes[pos + 3] === 0x5b || // '['
        bytes[pos + 3] === 0x2f || // '/'
        bytes[pos + 3] === 0x28) // '('
    ) {
      pos += 3;
      try {
        const parsed = parseObjectAtOffset(bytes, headerStart, maxRecursionDepth, true);
        objects.set(parsed.objectNumber, parsed);
        if (parsed.value.kind === "stream") {
          const type = dictGet(parsed.value.dict, "Type");
          if (type?.kind === "name" && type.decoded === "XRef") trailers.push(parsed.value.dict);
        }
        if (objects.size > maxObjects) throw new PdfError("E_LIMIT", "PDF object count limit exceeded");
        if (parsed.span && parsed.span.end > pos) {
          pos = parsed.span.end;
        }
      } catch (error) {
        if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
        // Skip unparseable fragments during full-file repair scan
      }
    }
  }

  return { objects, trailers };
}

function unpackRecoveredObjects(objects: Map<number, PdfIndirectObject>, maxObjects: number, maxDecompressedBytes: number, maxRecursionDepth: number): void {
  // Unpack any discovered /Type /ObjStm compressed object streams so Catalog/Info inside ObjStm can be recovered
  for (const obj of [...objects.values()]) {
    if (obj.value.kind === "stream") {
      const t = dictGet(obj.value.dict, "Type");
      if (t?.kind === "name" && t.decoded === "ObjStm") {
        try {
          for (const [unpackedNum, unpackedVal] of unpackObjectStream(obj.value, maxDecompressedBytes, maxRecursionDepth).entries()) {
            if (!objects.has(unpackedNum)) {
              objects.set(unpackedNum, {
                objectNumber: unpackedNum,
                generationNumber: 0,
                value: unpackedVal,
              });
              if (objects.size > maxObjects) throw new PdfError("E_LIMIT", "PDF object count limit exceeded");
            }
          }
        } catch (error) {
          if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
          // Ignore damaged object stream
        }
      }
    }
  }

}

function recoveredReferences(objects: Map<number, PdfIndirectObject>): { rootRef?: PdfCosRef; infoRef?: PdfCosRef } {
  let rootRef: PdfCosRef | undefined;
  let infoRef: PdfCosRef | undefined;
  for (const obj of objects.values()) {
    const dict = obj.value.kind === "dict" ? obj.value : obj.value.kind === "stream" ? obj.value.dict : undefined;
    if (!dict) continue;
    const typeEntry = dictGet(dict, "Type");
    if (typeEntry?.kind === "name" && typeEntry.decoded === "Catalog") {
      rootRef = { kind: "ref", objectNumber: obj.objectNumber, generationNumber: obj.generationNumber };
    } else if (!rootRef && typeEntry?.kind === "name" && typeEntry.decoded === "XRef") {
      const xrefRoot = dictGet(dict, "Root");
      if (xrefRoot?.kind === "ref") rootRef = xrefRoot;
    }
    if (dictGet(dict, "Title") || dictGet(dict, "Producer") || dictGet(dict, "Author")) {
      infoRef = { kind: "ref", objectNumber: obj.objectNumber, generationNumber: obj.generationNumber };
    }
  }

  return { ...(rootRef ? { rootRef } : {}), ...(infoRef ? { infoRef } : {}) };
}

function unpackObjectStream(
  streamObj: PdfCosStream,
  maxDecompressedBytes: number,
  maxRecursionDepth: number
): Map<number, PdfCosNode> {
  const nNode = dictGet(streamObj.dict, "N");
  const firstNode = dictGet(streamObj.dict, "First");
  if (nNode?.kind !== "number" || firstNode?.kind !== "number") {
    throw new PdfError("E_PARSE", "Invalid /ObjStm dictionary: missing /N or /First");
  }
  const decoded = decodeStreamObject(streamObj, maxDecompressedBytes);
  const headerLexer = new CosByteLexer(decoded, 0);
  const pairs: Array<{ objectNumber: number; relativeOffset: number }> = [];
  for (let i = 0; i < nNode.value; i++) {
    const numTok = headerLexer.nextToken();
    const offTok = headerLexer.nextToken();
    if (numTok?.kind === "number" && offTok?.kind === "number") {
      pairs.push({ objectNumber: numTok.value, relativeOffset: offTok.value });
    }
  }
  const result = new Map<number, PdfCosNode>();
  for (const pair of pairs) {
    try {
      const valLexer = new CosByteLexer(decoded, firstNode.value + pair.relativeOffset);
      const node = parseNodeFromLexer(valLexer, decoded, maxRecursionDepth);
      if (node) {
        result.set(pair.objectNumber, node);
      }
    } catch (error) {
      if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
      // Skip malformed entry in object stream
    }
  }
  return result;
}

export function parseCosDocument(bytes: Uint8Array, options: ParseCosOptions = {}): ParsedCosDocument {
  const version = parseHeaderVersion(bytes);
  const recovery = options.recovery ?? "strict";
  const maxObjects = options.maxObjects ?? Infinity;
  const maxDecompressedBytes = options.maxDecompressedBytes ?? Infinity;
  const maxRecursionDepth = options.maxRecursionDepth ?? Infinity;

  const startXrefIdx = findLastSubsequence(bytes, STARTXREF_BYTES);
  const revisions: PdfRevision[] = [];
  const mergedXref = new Map<number, PdfXRefEntry>();
  let rootRef: PdfCosRef | undefined;
  let infoRef: PdfCosRef | undefined;
  let encryptRef: PdfCosRef | undefined;
  let encryptNode: PdfCosRef | PdfCosDict | undefined;
  let idArray: PdfCosArray | undefined;

  let useRepair = false;
  if (startXrefIdx < 0) {
    if (recovery === "repair") {
      useRepair = true;
    } else {
      throw new PdfError("E_PARSE", "Invalid PDF trailer: missing startxref");
    }
  } else {
    const startLexer = new CosByteLexer(bytes, startXrefIdx + STARTXREF_BYTES.length);
    const offsetTok = startLexer.nextToken();
    if (offsetTok?.kind !== "number") {
      if (recovery === "repair") {
        useRepair = true;
      } else {
        throw new PdfError("E_PARSE", "Invalid startxref byte offset");
      }
    } else {
      try {
        let currentXrefOffset: number | undefined = offsetTok.value;
        const visitedOffsets = new Set<number>();
        while (currentXrefOffset !== undefined && !visitedOffsets.has(currentXrefOffset)) {
          visitedOffsets.add(currentXrefOffset);
          const rev = parseXrefRevisionAt(bytes, currentXrefOffset, maxDecompressedBytes, maxRecursionDepth);
          revisions.push(rev);
          for (const [num, entry] of rev.entries.entries()) {
            if (!mergedXref.has(num)) {
              mergedXref.set(num, entry);
            }
          }
          const r = dictGet(rev.trailer, "Root");
          if (!rootRef && r?.kind === "ref") rootRef = r;
          const inf = dictGet(rev.trailer, "Info");
          if (!infoRef && inf?.kind === "ref") infoRef = inf;
          const enc = dictGet(rev.trailer, "Encrypt");
          if (!encryptNode && (enc?.kind === "ref" || enc?.kind === "dict")) {
            encryptNode = enc;
            if (enc.kind === "ref") encryptRef = enc;
          }
          const id = dictGet(rev.trailer, "ID");
          if (!idArray && id?.kind === "array") idArray = id;

          currentXrefOffset = rev.previousXrefOffset;
        }
      } catch (err) {
        if (err instanceof PdfError && err.code === "E_LIMIT") throw err;
        if (recovery === "repair") {
          useRepair = true;
        } else {
          throw err;
        }
      }
    }
  }

  let objects = new Map<number, PdfIndirectObject>();
  if (useRepair || !rootRef) {
    if (recovery !== "repair") {
      throw new PdfError("E_PARSE", "PDF trailer missing /Root reference");
    }
    useRepair = true;
    const scanned = repairScanCosDocument(bytes, maxObjects, maxRecursionDepth);
    objects = scanned.objects;
    revisions.length = 0;
    mergedXref.clear();
    // Prefer a trailer carrying encryption and ID, as PDF.js does. Search the
    // latest revision first to match the latest object bodies retained above.
    const hasObjectStreams = [...objects.values()].some(obj => {
      const type = obj.value.kind === "stream" && dictGet(obj.value.dict, "Type");
      return type && type.kind === "name" && type.decoded === "ObjStm";
    });
    const candidates = scanned.trailers.filter(dict => {
      const root = dictGet(dict, "Root");
      if (root?.kind !== "ref") return false;
      const catalog = objects.get(root.objectNumber)?.value;
      // Compressed roots can only be validated after authentication/unpacking.
      if (!catalog) return hasObjectStreams;
      if (catalog.kind !== "dict") return false;
      const pages = dictGet(catalog, "Pages");
      if (pages?.kind === "dict") return true;
      if (pages?.kind !== "ref") return false;
      const pageTree = objects.get(pages.objectNumber)?.value;
      return pageTree ? pageTree.kind === "dict" : hasObjectStreams;
    }).reverse();
    const encrypted = candidates.filter(dict => {
      const value = dictGet(dict, "Encrypt");
      return value?.kind === "dict" || value?.kind === "ref";
    });
    const preferred = encrypted.length ? encrypted : candidates;
    const trailer = preferred.find(dict => dictGet(dict, "ID")?.kind === "array") ?? preferred[0];
    const root = trailer && dictGet(trailer, "Root");
    const info = trailer && dictGet(trailer, "Info");
    const encrypt = trailer && dictGet(trailer, "Encrypt");
    const id = trailer && dictGet(trailer, "ID");
    rootRef = root?.kind === "ref" ? root : undefined;
    infoRef = info?.kind === "ref" ? info : undefined;
    encryptNode = encrypt?.kind === "ref" || encrypt?.kind === "dict" ? encrypt : undefined;
    encryptRef = encrypt?.kind === "ref" ? encrypt : undefined;
    idArray = id?.kind === "array" ? id : undefined;
    // Without any trailer, an unencrypted catalog may itself be compressed.
    if (!rootRef && !encryptNode) unpackRecoveredObjects(objects, maxObjects, maxDecompressedBytes, maxRecursionDepth);
    const fallback = recoveredReferences(objects);
    rootRef ??= fallback.rootRef;
    infoRef ??= fallback.infoRef;
    if (!rootRef) throw new PdfError("E_PARSE", "Unable to repair PDF: no /Type /Catalog object found");
  } else {
    for (const [objNum, entry] of mergedXref.entries()) {
      if (entry.type === "uncompressed") {
        const parsed = parseObjectAtOffset(bytes, entry.offset ?? 0, maxRecursionDepth, recovery === "repair");
        objects.set(objNum, parsed);
        if (objects.size > maxObjects) throw new PdfError("E_LIMIT", "PDF object count limit exceeded");
      }
    }
  }

  const doc = new ParsedCosDocument({
    version,
    bytes,
    objects,
    revisions,
    rootRef,
    infoRef,
    encryptRef,
    idArray,
    maxDecompressedBytes,
    maxRecursionDepth,
  });

  if (encryptNode) {
    const encryptDict = doc.resolveDict(encryptNode);
    if (!encryptDict) {
      throw new PdfError("E_PARSE", "Missing /Encrypt dictionary object");
    }
    let idFirstBytes = new Uint8Array(16);
    if (idArray && idArray.items.length > 0) {
      const firstId = idArray.items[0];
      if (firstId?.kind === "string") {
        idFirstBytes = new Uint8Array(firstId.bytes);
      }
    }
    const encState = authenticateStandardEncryption(encryptDict, idFirstBytes, options.password ?? "", {
      resolve: node => node.kind === "ref" ? doc.getObject(node.objectNumber) : node,
      maxRecursionDepth,
    });
    doc.encryption = encState;
    decryptCosDocument(doc, encState);
  }

  if (useRepair) {
    unpackRecoveredObjects(objects, maxObjects, maxDecompressedBytes, maxRecursionDepth);
    doc.infoRef ??= recoveredReferences(objects).infoRef;
  }

  // Unpack compressed objects from /ObjStm streams after decryption
  const objStmCache = new Map<number, Map<number, PdfCosNode>>();
  for (const [objNum, entry] of mergedXref.entries()) {
    if (entry.type === "compressed" && entry.objectStreamNumber !== undefined) {
      let unpacked = objStmCache.get(entry.objectStreamNumber);
      if (!unpacked) {
        const stmObj = objects.get(entry.objectStreamNumber)?.value;
        if (stmObj?.kind === "stream") {
          unpacked = unpackObjectStream(stmObj, maxDecompressedBytes, maxRecursionDepth);
          objStmCache.set(entry.objectStreamNumber, unpacked);
        }
      }
      const val = unpacked?.get(objNum);
      if (val) {
        objects.set(objNum, {
          objectNumber: objNum,
          generationNumber: 0,
          value: val,
        });
        if (objects.size > maxObjects) throw new PdfError("E_LIMIT", "PDF object count limit exceeded");
      }
    }
  }

  return doc;
}
