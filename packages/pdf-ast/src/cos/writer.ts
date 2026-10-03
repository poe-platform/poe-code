import { drainWork } from "../work.js";
import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictGet,
  formatPdfNumber,
  type PdfCosArray,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosRef,
  type PdfIndirectObject,
} from "../ast.js";
import { PdfError } from "../errors.js";
import { encodeFlate } from "./filters.js";
import type { ParsedCosDocument } from "./parser.js";

export interface SerializeCosOptions {
  readonly objects: readonly PdfIndirectObject[];
  readonly rootRef: PdfCosRef;
  readonly infoRef?: PdfCosRef | undefined;
  readonly encryptRef?: PdfCosRef | undefined;
  readonly idArray?: PdfCosArray | undefined;
  readonly version?: string | undefined;
  readonly normalizeContent?: boolean | undefined;
  readonly objectStreams?: "preserve" | "disable" | "generate" | undefined;
  readonly linearize?: boolean | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly maxObjects?: number | undefined;
  readonly maxRecursionDepth?: number | undefined;
}

const textEncoder = new TextEncoder();

export interface SerializeCosNodeOptions {
  readonly chunkBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxRecursionDepth?: number;
  readonly signal?: AbortSignal;
}

function* cosNodeParts(node: PdfCosNode, depth: number, maxDepth: number, textChunk: number): Generator<string | Uint8Array, void, void> {
  if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
  switch (node.kind) {
    case "null": yield "null"; return;
    case "boolean": yield node.value ? "true" : "false"; return;
    case "number": {
      if (!Number.isFinite(node.value)) throw new PdfError("E_CAPABILITY", "Non-finite PDF number");
      const raw = node.raw.includes("e") || node.raw.includes("E") ? formatPdfNumber(node.value) : node.raw;
      for (let start = 0; start < raw.length;) {
        let end = Math.min(raw.length, start + textChunk);
        // Preserve UTF-8 behavior even for caller-supplied malformed number text.
        const last = raw.charCodeAt(end - 1);
        if (end < raw.length && last >= 0xd800 && last <= 0xdbff) end++;
        yield raw.slice(start, end);
        start = end;
      }
      return;
    }
    case "name": {
      yield "/";
      let part = "";
      for (let i = 0; i < node.decoded.length; i++) {
        const code = node.decoded.charCodeAt(i);
        part += code <= 0x20 || code > 0x7e || "#()<>[]{}/%".includes(node.decoded[i]!)
          ? `#${code.toString(16).padStart(2, "0").toUpperCase()}` : node.decoded[i];
        if (part.length >= textChunk) { yield part; part = ""; }
      }
      if (part) yield part;
      return;
    }
    case "string": {
      const hex = node.format === "hex";
      yield hex ? "<" : "(";
      // Literal bytes are not UTF-8 text. Keep escaping independent of encoding.
      const capacity = Math.min(textChunk, Math.max(1, node.bytes.length * 2));
      let bytes = new Uint8Array(capacity);
      let used = 0;
      for (const byte of node.bytes) {
        let first = byte;
        let second: number | undefined;
        if (hex) {
          first = "0123456789ABCDEF".charCodeAt(byte >>> 4);
          second = "0123456789ABCDEF".charCodeAt(byte & 15);
        } else if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
          first = 0x5c; second = byte;
        } else if (byte === 0x0a || byte === 0x0d || byte === 0x09) {
          first = 0x5c; second = byte === 0x0a ? 0x6e : byte === 0x0d ? 0x72 : 0x74;
        }
        bytes[used++] = first;
        if (used === capacity) { yield bytes; bytes = new Uint8Array(capacity); used = 0; }
        if (second !== undefined) {
          bytes[used++] = second;
          if (used === capacity) { yield bytes; bytes = new Uint8Array(capacity); used = 0; }
        }
      }
      if (used) yield bytes.subarray(0, used);
      yield hex ? ">" : ")";
      return;
    }
    case "ref": yield `${node.objectNumber} ${node.generationNumber} R`; return;
    case "array":
      yield "[ ";
      for (const item of node.items) { yield* cosNodeParts(item, depth + 1, maxDepth, textChunk); yield " "; }
      yield "]";
      return;
    case "dict":
      yield "<<\n";
      for (const entry of node.entries) {
        yield* cosNodeParts(entry.key, depth + 1, maxDepth, textChunk);
        yield " ";
        yield* cosNodeParts(entry.value, depth + 1, maxDepth, textChunk);
        yield "\n";
      }
      yield ">>";
      return;
    case "stream": {
      // Override Length while traversing; no copied dictionary or stream body.
      if (depth + 1 > maxDepth) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
      yield "<<\n";
      let hasLength = false;
      for (const entry of node.dict.entries) {
        yield* cosNodeParts(entry.key, depth + 2, maxDepth, textChunk);
        yield " ";
        if (entry.key.decoded === "Length") {
          hasLength = true;
          yield* cosNodeParts(cosNumber(node.rawBytes.length), depth + 2, maxDepth, textChunk);
        } else yield* cosNodeParts(entry.value, depth + 2, maxDepth, textChunk);
        yield "\n";
      }
      if (!hasLength) {
        yield* cosNodeParts(cosName("Length"), depth + 2, maxDepth, textChunk);
        yield " ";
        yield* cosNodeParts(cosNumber(node.rawBytes.length), depth + 2, maxDepth, textChunk);
        yield "\n";
      }
      yield ">>\nstream\n";
      yield node.rawBytes;
      yield "\nendstream";
    }
  }
}

/** Owned output chunks, produced only when the consumer advances the iterator. */
export function* serializeCosNodeChunks(node: PdfCosNode, options: SerializeCosNodeOptions = {}, depth = 0): Generator<Uint8Array, void, void> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxOutputBytes ?? Infinity;
  const maxDepth = options.maxRecursionDepth ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("chunkBytes must be a positive safe integer");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("maxOutputBytes must be a nonnegative safe integer or Infinity");
  if (maxDepth !== Infinity && (!Number.isSafeInteger(maxDepth) || maxDepth < 1)) throw new RangeError("maxRecursionDepth must be a positive safe integer or Infinity");
  options.signal?.throwIfAborted();
  const capacity = Math.min(chunkBytes, maximum);
  if (capacity === 0) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
  let total = 0;
  let output: Uint8Array | undefined;
  let used = 0;
  for (const part of cosNodeParts(node, depth, maxDepth, capacity)) {
    options.signal?.throwIfAborted();
    let length = typeof part === "string" ? 0 : part.length;
    if (typeof part === "string") {
      for (const character of part) {
        const code = character.codePointAt(0)!;
        length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      }
    }
    if (length > maximum - total) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
    total += length;
    const bytes = typeof part === "string" ? textEncoder.encode(part) : part;
    let position = 0;
    while (position < bytes.length) {
      options.signal?.throwIfAborted();
      output ??= new Uint8Array(capacity);
      const count = Math.min(bytes.length - position, capacity - used);
      output.set(bytes.subarray(position, position + count), used);
      used += count;
      position += count;
      if (used === capacity) {
        yield output;
        output = undefined;
        used = 0;
      }
    }
  }
  if (output && used) yield output.subarray(0, used);
}

export function serializeCosNodeBytes(node: PdfCosNode, depth = 0, maxRecursionDepth = Infinity): Uint8Array {
  return concatByteArrays([...serializeCosNodeChunks(node, { maxRecursionDepth }, depth)]);
}

export function concatByteArrays(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out;
}

export function* serializeCosDocumentSteps(options: SerializeCosOptions): Generator<void, Uint8Array, void> {
  yield;

  let work = 0;

  const maxOutputBytes = options.maxOutputBytes ?? Infinity;
  const maxObjects = options.maxObjects ?? Infinity;
  const sorted = [...options.objects].sort((a, b) => a.objectNumber - b.objectNumber);

  if (sorted.length > maxObjects) {
    throw new PdfError("E_LIMIT", "PDF object limit exceeded");
  }

  let maxObjectNumber = sorted.length > 0 ? sorted[sorted.length - 1]!.objectNumber : 0;
  if (maxObjectNumber > maxObjects) {
    throw new PdfError("E_LIMIT", "PDF largest object number exceeds limit");
  }

  const rawVersion = options.version ?? "1.7";
  const version =
    options.objectStreams === "generate" && Number.parseFloat(rawVersion) < 1.5
      ? "1.5"
      : rawVersion;
  const header = textEncoder.encode(`%PDF-${version}\n%\x81\x81\x81\x81\n\n`);
  const chunks: Uint8Array[] = [header];
  let offset = header.length;

  if (options.objectStreams === "generate" && !options.encryptRef && !options.normalizeContent) {
    const packable: PdfIndirectObject[] = [];
    const direct: PdfIndirectObject[] = [];
    for (const obj of sorted) {
      if (++work % 16 === 0) yield;

      const isLinearized = obj.value.kind === "dict" && dictGet(obj.value, "Linearized") !== undefined;
      if (obj.value.kind !== "stream" && obj.generationNumber === 0 && !isLinearized) {
        packable.push(obj);
      } else {
        direct.push(obj);
      }
    }
    if (packable.length > 0) {
      const objStmNum = maxObjectNumber + 1;
      const xrefStmNum = maxObjectNumber + 2;
      if (xrefStmNum > maxObjects) {
        throw new PdfError("E_LIMIT", "PDF largest object number exceeds limit");
      }
      const bodyChunks: Uint8Array[] = [];
      const headerPairs: string[] = [];
      let relOffset = 0;
      for (const pObj of packable) {
        if (++work % 16 === 0) yield;

        headerPairs.push(`${pObj.objectNumber} ${relOffset}`);
        const bBytes = serializeCosNodeBytes(pObj.value, 0, options.maxRecursionDepth);
        const nl = textEncoder.encode("\n");
        bodyChunks.push(bBytes, nl);
        relOffset += bBytes.length + nl.length;
      }
      const headerBytes = textEncoder.encode(headerPairs.join(" ") + "\n");
      const rawObjStm = concatByteArrays([headerBytes, ...bodyChunks]);
      const compObjStm = encodeFlate(rawObjStm);
      const objStmValue = cosStream(compObjStm, {
        dict: cosDict({
          Type: cosName("ObjStm"),
          N: cosNumber(packable.length),
          First: cosNumber(headerBytes.length),
          Filter: cosName("FlateDecode"),
          Length: cosNumber(compObjStm.length),
        }),
        compress: false,
      });
      const allDirect: PdfIndirectObject[] = [
        ...direct,
        { objectNumber: objStmNum, generationNumber: 0, value: objStmValue },
      ];
      const directOffsets = new Map<number, { offset: number; generation: number }>();
      for (const dObj of allDirect) {
        if (++work % 16 === 0) yield;

        directOffsets.set(dObj.objectNumber, { offset, generation: dObj.generationNumber });
        const prefix = textEncoder.encode(`${dObj.objectNumber} ${dObj.generationNumber} obj\n`);
        const body = serializeCosNodeBytes(dObj.value, 0, options.maxRecursionDepth);
        const suffix = textEncoder.encode("\nendobj\n\n");
        offset += prefix.length + body.length + suffix.length;
        if (offset > maxOutputBytes) {
          throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
        }
        chunks.push(prefix, body, suffix);
      }
      const compressedMap = new Map<number, number>();
      for (let idx = 0; idx < packable.length; idx++) {
        if (++work % 16 === 0) yield;

        compressedMap.set(packable[idx]!.objectNumber, idx);
      }
      const xrefOffset = offset;
      const size = xrefStmNum + 1;
      const xrefRaw = new Uint8Array(size * 7);
      const writeEntry7 = (objIdx: number, type: number, f1: number, f2: number) => {
        const base = objIdx * 7;
        xrefRaw[base] = type & 0xff;
        xrefRaw[base + 1] = (f1 >>> 24) & 0xff;
        xrefRaw[base + 2] = (f1 >>> 16) & 0xff;
        xrefRaw[base + 3] = (f1 >>> 8) & 0xff;
        xrefRaw[base + 4] = f1 & 0xff;
        xrefRaw[base + 5] = (f2 >>> 8) & 0xff;
        xrefRaw[base + 6] = f2 & 0xff;
      };
      writeEntry7(0, 0, 0, 65535);
      for (let i = 1; i < size; i++) {
        if (++work % 16 === 0) yield;

        if (i === xrefStmNum) {
          writeEntry7(i, 1, xrefOffset, 0);
        } else if (compressedMap.has(i)) {
          writeEntry7(i, 2, objStmNum, compressedMap.get(i)!);
        } else if (directOffsets.has(i)) {
          const d = directOffsets.get(i)!;
          writeEntry7(i, 1, d.offset, d.generation);
        } else {
          writeEntry7(i, 0, 0, 65535);
        }
      }
      const compXref = encodeFlate(xrefRaw);
      const xrefStreamNode = cosStream(compXref, {
        dict: cosDict({
          Type: cosName("XRef"),
          Size: cosNumber(size),
          W: cosArray([cosNumber(1), cosNumber(4), cosNumber(2)]),
          Root: options.rootRef,
          Info: options.infoRef,
          ID: options.idArray,
          Filter: cosName("FlateDecode"),
          Length: cosNumber(compXref.length),
        }),
        compress: false,
      });
      const xrefPrefix = textEncoder.encode(`${xrefStmNum} 0 obj\n`);
      const xrefBody = serializeCosNodeBytes(xrefStreamNode, 0, options.maxRecursionDepth);
      const xrefSuffix = textEncoder.encode(`\nendobj\n\nstartxref\n${xrefOffset}\n%%EOF`);
      if (offset + xrefPrefix.length + xrefBody.length + xrefSuffix.length > maxOutputBytes) {
        throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
      }
      chunks.push(xrefPrefix, xrefBody, xrefSuffix);
      return concatByteArrays(chunks);
    }
  }

  const hasLinearizedObj = sorted.some(
    o => o.value.kind === "dict" && dictGet(o.value, "Linearized") !== undefined
  );
  if (options.linearize || hasLinearizedObj) {
    let linObj = sorted.find(
      o => o.value.kind === "dict" && dictGet(o.value, "Linearized") !== undefined
    );
    let hintObj = sorted.find(
      o =>
        o.value.kind === "stream" &&
        dictGet(o.value.dict, "Type")?.kind === "name" &&
        (dictGet(o.value.dict, "Type") as any)?.decoded === "Hint"
    );
    let nextObjNum = maxObjectNumber + 1;
    if (!linObj) {
      linObj = {
        objectNumber: nextObjNum++,
        generationNumber: 0,
        value: cosDict({ Linearized: cosNumber(1) }),
      };
      sorted.push(linObj);
    }
    if (!hintObj) {
      const hintRaw = encodeFlate(new Uint8Array(64));
      hintObj = {
        objectNumber: nextObjNum++,
        generationNumber: 0,
        value: cosStream(hintRaw, {
          dict: cosDict({
            Type: cosName("Hint"),
            S: cosNumber(32),
            Filter: cosName("FlateDecode"),
            Length: cosNumber(hintRaw.length),
          }),
          compress: false,
        }),
      };
      sorted.push(hintObj);
    }
    if (nextObjNum - 1 > maxObjectNumber) {
      maxObjectNumber = nextObjNum - 1;
    }
    if (maxObjectNumber > maxObjects) {
      throw new PdfError("E_LIMIT", "PDF largest object number exceeds limit");
    }

    // Find first Page object and total Page count
    let pageCount = 0;
    let firstPageObjNum = options.rootRef.objectNumber;
    for (const o of sorted) {
      if (++work % 16 === 0) yield;

      if (o.value.kind === "dict") {
        const t = dictGet(o.value, "Type");
        if (t?.kind === "name" && t.decoded === "Page") {
          if (pageCount === 0) firstPageObjNum = o.objectNumber;
          pageCount++;
        }
      }
    }
    if (pageCount === 0) pageCount = 1;

    // Order: linObj first, hintObj second, rootRef third, firstPageObj fourth, then the rest
    const priorityNums = [
      linObj.objectNumber,
      hintObj.objectNumber,
      options.rootRef.objectNumber,
      firstPageObjNum,
    ];
    sorted.sort((a, b) => {
      const pa = priorityNums.indexOf(a.objectNumber);
      const pb = priorityNums.indexOf(b.objectNumber);
      if (pa >= 0 && pb >= 0) return pa - pb;
      if (pa >= 0) return -1;
      if (pb >= 0) return 1;
      return a.objectNumber - b.objectNumber;
    });

    const fixedNum = (n: number): import("../ast.js").PdfCosNumber => ({
      kind: "number",
      value: n,
      isInteger: true,
      raw: String(n).padStart(10, "0"),
    });
    const linIdx = sorted.indexOf(linObj);
    if (linIdx >= 0) {
      sorted[linIdx] = {
        ...linObj,
        value: cosDict({
          Linearized: cosNumber(1),
          L: fixedNum(0),
          H: cosArray([fixedNum(0), fixedNum(0)]),
          O: cosNumber(firstPageObjNum),
          E: fixedNum(0),
          N: cosNumber(pageCount),
          T: fixedNum(0),
        }),
      };
    }
  }

  const objectOffsets = new Map<number, { offset: number; generation: number }>();

  for (const obj of sorted) {
    if (++work % 16 === 0) yield;

    objectOffsets.set(obj.objectNumber, { offset, generation: obj.generationNumber });
    let value = obj.value;
    if (options.normalizeContent && value.kind === "stream" && value.decodedBytes) {
      const entries = value.dict.entries.filter(
        e => e.key.decoded !== "Filter" && e.key.decoded !== "DecodeParms" && e.key.decoded !== "Length"
      );
      entries.push({ key: cosName("Length"), value: cosNumber(value.decodedBytes.length) });
      value = {
        kind: "stream",
        dict: { kind: "dict", entries },
        rawBytes: value.decodedBytes,
        decodedBytes: value.decodedBytes,
      };
    }
    const prefix = textEncoder.encode(`${obj.objectNumber} ${obj.generationNumber} obj\n`);
    const body = serializeCosNodeBytes(value, 0, options.maxRecursionDepth);
    const suffix = textEncoder.encode("\nendobj\n\n");
    offset += prefix.length + body.length + suffix.length;
    if (offset > maxOutputBytes) {
      throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
    }
    chunks.push(prefix, body, suffix);
  }

  const xrefOffset = offset;
  const size = maxObjectNumber + 1;
  let xrefText = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) {
    if (++work % 16 === 0) yield;

    const entry = objectOffsets.get(i);
    if (entry) {
      xrefText += `${String(entry.offset).padStart(10, "0")} ${String(entry.generation).padStart(5, "0")} n \n`;
    } else {
      xrefText += `0000000000 65535 f \n`;
    }
  }

  const trailerDict = cosDict({
    Size: cosNumber(size),
    Root: options.rootRef,
    Info: options.infoRef,
    Encrypt: options.encryptRef,
    ID: options.idArray,
  });
  const trailerBytes = concatByteArrays([
    textEncoder.encode(xrefText),
    textEncoder.encode("trailer\n"),
    serializeCosNodeBytes(trailerDict, 0, options.maxRecursionDepth),
    textEncoder.encode(`\n\nstartxref\n${xrefOffset}\n%%EOF`),
  ]);

  if (offset + trailerBytes.length > maxOutputBytes) {
    throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
  }
  chunks.push(trailerBytes);
  const fullBytes = concatByteArrays(chunks);
  const linObjAfter = sorted.find(
    o => o.value.kind === "dict" && dictGet(o.value, "Linearized") !== undefined
  );
  const hintObjAfter = sorted.find(
    o =>
      o.value.kind === "stream" &&
      dictGet(o.value.dict, "Type")?.kind === "name" &&
      (dictGet(o.value.dict, "Type") as any)?.decoded === "Hint"
  );
  if (linObjAfter && hintObjAfter) {
    const linEntry = objectOffsets.get(linObjAfter.objectNumber);
    const hintEntry = objectOffsets.get(hintObjAfter.objectNumber);
    const oNode = dictGet(linObjAfter.value as PdfCosDict, "O");
    const firstPageNum = oNode?.kind === "number" ? oNode.value : options.rootRef.objectNumber;
    let hintLength = 120;
    let endFirstPage = xrefOffset;
    const sortedOffsets = [...objectOffsets.entries()].sort((a, b) => a[1].offset - b[1].offset);
    for (let i = 0; i < sortedOffsets.length; i++) {
      if (++work % 16 === 0) yield;

      const [objNum, info] = sortedOffsets[i]!;
      const nextOff = sortedOffsets[i + 1]?.[1].offset ?? xrefOffset;
      if (objNum === hintObjAfter.objectNumber) {
        hintLength = nextOff - info.offset;
      }
      if (objNum === firstPageNum) {
        endFirstPage = nextOff;
      }
    }
    const fixedNum = (n: number): import("../ast.js").PdfCosNumber => ({
      kind: "number",
      value: n,
      isInteger: true,
      raw: String(n).padStart(10, "0"),
    });
    const updatedLinDict = cosDict({
      Linearized: cosNumber(1),
      L: fixedNum(fullBytes.length),
      H: cosArray([fixedNum(hintEntry?.offset ?? 0), fixedNum(hintLength)]),
      O: cosNumber(firstPageNum),
      E: fixedNum(endFirstPage),
      N: dictGet(linObjAfter.value as PdfCosDict, "N") ?? cosNumber(1),
      T: fixedNum(xrefOffset),
    });
    const prefix = textEncoder.encode(`${linObjAfter.objectNumber} ${linObjAfter.generationNumber} obj\n`);
    const updatedBody = serializeCosNodeBytes(updatedLinDict, 0, options.maxRecursionDepth);
    if (linEntry) {
      fullBytes.set(updatedBody, linEntry.offset + prefix.length);
    }
  }
  return fullBytes;
}

export function serializeCosDocument(options: SerializeCosOptions): Uint8Array {
  return drainWork(serializeCosDocumentSteps(options));
}

export function appendIncrementalRevision(
  originalBytes: Uint8Array,
  doc: ParsedCosDocument,
  updatedObjects: readonly PdfIndirectObject[]
): Uint8Array {
  const chunks: Uint8Array[] = [originalBytes, textEncoder.encode("\n")];
  let offset = originalBytes.length + 1;
  const offsets = new Map<number, { offset: number; generation: number }>();

  let maxObjNum = doc.maxObjectNumber;
  for (const obj of updatedObjects) {
    if (obj.objectNumber > maxObjNum) maxObjNum = obj.objectNumber;
    offsets.set(obj.objectNumber, { offset, generation: obj.generationNumber });
    const prefix = textEncoder.encode(`${obj.objectNumber} ${obj.generationNumber} obj\n`);
    const body = serializeCosNodeBytes(obj.value);
    const suffix = textEncoder.encode("\nendobj\n\n");
    offset += prefix.length + body.length + suffix.length;
    chunks.push(prefix, body, suffix);
  }

  const xrefOffset = offset;
  let xrefText = "xref\n0 1\n0000000000 65535 f \n";
  const sortedNums = [...offsets.keys()].sort((a, b) => a - b);
  for (const num of sortedNums) {
    const entry = offsets.get(num)!;
    xrefText += `${num} 1\n${String(entry.offset).padStart(10, "0")} ${String(entry.generation).padStart(5, "0")} n \n`;
  }

  const prevXrefOffset = doc.revisions[0]?.xrefOffset ?? 0;
  const trailerDict = cosDict({
    Size: cosNumber(maxObjNum + 1),
    Root: doc.rootRef,
    Info: doc.infoRef,
    Prev: cosNumber(prevXrefOffset),
  });

  chunks.push(
    textEncoder.encode(xrefText),
    textEncoder.encode("trailer\n"),
    serializeCosNodeBytes(trailerDict),
    textEncoder.encode(`\n\nstartxref\n${xrefOffset}\n%%EOF`)
  );
  return concatByteArrays(chunks);
}
