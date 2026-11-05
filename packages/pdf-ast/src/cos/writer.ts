import { linearizedOutput, type LinearizationObject } from "./linearized-writer.js";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
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
  type PdfCosNode,
  type PdfCosRef,
  type PdfIndirectObject,
} from "../ast.js";
import { PdfError } from "../errors.js";
import { normalizeContentBytes } from "../content/normalize.js";
import { decodeStreamObject, encodeFlate } from "./filters.js";
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

export interface PdfOutputStorage {
  readonly fs: FileSystem;
  readonly directory: string;
  readonly cacheBytes?: number;
}

export interface SerializeCosStreamOptions extends SerializeCosOptions {
  readonly chunkBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

function* serializeCosDocumentOutput(options: SerializeCosStreamOptions): Generator<Uint8Array | void, void, void> {
  yield;

  let work = 0;

  const maxOutputBytes = options.maxOutputBytes ?? Infinity;
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("chunkBytes must be a positive safe integer");
  if (maxOutputBytes !== Infinity && (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0)) throw new RangeError("maxOutputBytes must be a nonnegative safe integer or Infinity");
  let offset = 0;
  function* emit(bytes: Uint8Array): Generator<Uint8Array, void, void> {
    if (bytes.length > maxOutputBytes - offset) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
    for (let position = 0; position < bytes.length; position += chunkBytes) {
      const chunk = new Uint8Array(bytes.subarray(position, Math.min(bytes.length, position + chunkBytes)));
      offset += chunk.length;
      yield chunk;
    }
  }
  function* emitNode(node: PdfCosNode): Generator<Uint8Array, void, void> {
    for (const chunk of serializeCosNodeChunks(node, { chunkBytes, maxOutputBytes: maxOutputBytes - offset,
      ...(options.maxRecursionDepth === undefined ? {} : { maxRecursionDepth: options.maxRecursionDepth }),
      ...(options.signal === undefined ? {} : { signal: options.signal }) })) {
      offset += chunk.length;
      yield chunk;
    }
  }
  const maxObjects = options.maxObjects ?? Infinity;
  const sorted = [...options.objects].sort((a, b) => a.objectNumber - b.objectNumber);

  if (sorted.length > maxObjects) {
    throw new PdfError("E_LIMIT", "PDF object limit exceeded");
  }

  const maxObjectNumber = sorted.length > 0 ? sorted[sorted.length - 1]!.objectNumber : 0;
  if (maxObjectNumber > maxObjects) {
    throw new PdfError("E_LIMIT", "PDF largest object number exceeds limit");
  }

  if (options.normalizeContent) {
    const objects = new Map(sorted.map(object => [object.objectNumber, object]));
    const seen = new Set<number>();
    function normalize(node: PdfCosNode | undefined): void {
      if (node?.kind === "ref") {
        if (seen.has(node.objectNumber)) return;
        seen.add(node.objectNumber);
        const object = objects.get(node.objectNumber);
        if (!object) return;
        if (object.value.kind === "stream") {
          const bytes = normalizeContentBytes(decodeStreamObject(object.value, Infinity, ref => ref?.kind === "ref" ? objects.get(ref.objectNumber)?.value : ref));
          objects.set(node.objectNumber, { ...object, value: cosStream(bytes, { dict: { ...object.value.dict, entries: object.value.dict.entries.filter(entry => !["Filter", "DecodeParms", "Length"].includes(entry.key.decoded)) } }) });
        } else normalize(object.value);
      } else if (node?.kind === "array") for (const item of node.items) normalize(item);
    }
    const visited = new Set<number>();
    function pages(node: PdfCosNode | undefined): void {
      if (node?.kind === "ref") {
        if (visited.has(node.objectNumber)) return;
        visited.add(node.objectNumber); pages(objects.get(node.objectNumber)?.value);
      } else if (node?.kind === "array") for (const item of node.items) pages(item);
      else if (node?.kind === "dict") {
        const type = dictGet(node, "Type");
        if (type?.kind === "name" && type.decoded === "Page") normalize(dictGet(node, "Contents"));
        else pages(dictGet(node, "Kids"));
      }
    }
    const root = objects.get(options.rootRef.objectNumber)?.value;
    if (root?.kind === "dict") pages(dictGet(root, "Pages"));
    for (let i = 0; i < sorted.length; i++) sorted[i] = objects.get(sorted[i]!.objectNumber)!;
  }

  if (options.linearize || sorted.some(object => object.value.kind === "dict" && dictGet(object.value, "Linearized"))) {
    const objects = new Map(sorted.map(object => [object.objectNumber, object]));
    const work = linearizedOutput([...objects.keys()], options);
    let step = work.next();
    while (!step.done) {
      options.signal?.throwIfAborted();
      if (step.value instanceof Uint8Array || step.value === undefined) { yield step.value; step = work.next(); continue; }
      const request = step.value, object = objects.get("object" in request ? request.object : request.stream)!;
      const node = object.value;
      if ("stream" in request) {
        if (node.kind === "stream") yield* emit(options.normalizeContent && node.decodedBytes ? node.decodedBytes : node.rawBytes);
        step = work.next(); continue;
      }
      let value: LinearizationObject = { value: node };
      if (node.kind === "stream") {
        const bytes = options.normalizeContent && node.decodedBytes ? node.decodedBytes : node.rawBytes;
        const entries = node.dict.entries.filter(entry => entry.key.decoded !== "Length" && !(options.normalizeContent && node.kind === "stream" && node.decodedBytes && ["Filter", "DecodeParms"].includes(entry.key.decoded)));
        value = { value: { kind: "dict", entries: [...entries, { key: cosName("Length"), value: cosNumber(bytes.length) }] }, streamLength: bytes.length };
      }
      step = work.next(value);
    }
    return;
  }

  const rawVersion = options.version ?? "1.7";
  const version =
    options.objectStreams === "generate" && Number.parseFloat(rawVersion) < 1.5
      ? "1.5"
      : rawVersion;
  const header = textEncoder.encode(`%PDF-${version}\n%\x81\x81\x81\x81\n\n`);
  yield* emit(header);

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
        yield* emit(textEncoder.encode(`${dObj.objectNumber} ${dObj.generationNumber} obj\n`));
        yield* emitNode(dObj.value);
        yield* emit(textEncoder.encode("\nendobj\n\n"));
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
      yield* emit(textEncoder.encode(`${xrefStmNum} 0 obj\n`));
      yield* emitNode(xrefStreamNode);
      yield* emit(textEncoder.encode(`\nendobj\n\nstartxref\n${xrefOffset}\n%%EOF`));
      return;
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
    yield* emit(textEncoder.encode(`${obj.objectNumber} ${obj.generationNumber} obj\n`));
    yield* emitNode(value);
    yield* emit(textEncoder.encode("\nendobj\n\n"));
  }

  const xrefOffset = offset;
  const size = maxObjectNumber + 1;
  yield* emit(textEncoder.encode(`xref\n0 ${size}\n0000000000 65535 f \n`));
  for (let i = 1; i < size; i++) {
    if (++work % 16 === 0) yield;

    const entry = objectOffsets.get(i);
    if (entry) {
      yield* emit(textEncoder.encode(`${String(entry.offset).padStart(10, "0")} ${String(entry.generation).padStart(5, "0")} n \n`));
    } else {
      yield* emit(textEncoder.encode("0000000000 65535 f \n"));
    }
  }

  const trailerDict = cosDict({
    Size: cosNumber(size),
    Root: options.rootRef,
    Info: options.infoRef,
    Encrypt: options.encryptRef,
    ID: options.idArray,
  });
  yield* emit(textEncoder.encode("trailer\n"));
  yield* emitNode(trailerDict);
  yield* emit(textEncoder.encode(`\n\nstartxref\n${xrefOffset}\n%%EOF`));
  return;
}

/** Buffered compatibility path over the same chunk-producing serializer. */
export function* serializeCosDocumentSteps(options: SerializeCosOptions): Generator<void, Uint8Array, void> {
  const chunks: Uint8Array[] = [];
  const work = serializeCosDocumentOutput(options);
  let step = work.next();
  while (!step.done) {
    if (step.value) chunks.push(step.value.byteLength === step.value.buffer.byteLength ? step.value : new Uint8Array(step.value));
    yield;
    step = work.next();
  }
  return concatByteArrays(chunks);
}

/** Layout is measured before output, so linearized bytes stream without patching. */
export async function* serializeCosDocumentChunks(options: SerializeCosStreamOptions, _storage?: PdfOutputStorage): AsyncGenerator<Uint8Array, void, void> {
  const work = serializeCosDocumentOutput(options);
  let turns = 0;
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const step = work.next();
      if (step.done) return;
      if (step.value) yield step.value;
      options.signal?.throwIfAborted();
      if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally { work.return(); }
}

export async function serializeCosDocumentTo(options: SerializeCosStreamOptions,
  output: { write(bytes: Uint8Array): Promise<void> }, storage?: PdfOutputStorage): Promise<void> {
  for await (const chunk of serializeCosDocumentChunks(options, storage)) {
    options.signal?.throwIfAborted();
    await output.write(chunk);
    options.signal?.throwIfAborted();
  }
}

export function serializeCosDocument(options: SerializeCosOptions): Uint8Array {
  return drainWork(serializeCosDocumentSteps(options));
}

export function* appendIncrementalRevisionChunks(
  originalBytes: Uint8Array,
  doc: ParsedCosDocument,
  updatedObjects: readonly PdfIndirectObject[],
  options: SerializeCosNodeOptions = {},
): Generator<Uint8Array, void, void> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxOutputBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("chunkBytes must be a positive safe integer");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("maxOutputBytes must be a nonnegative safe integer or Infinity");
  let offset = 0;
  function* emit(bytes: Uint8Array): Generator<Uint8Array, void, void> {
    if (bytes.length > maximum - offset) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
    for (let position = 0; position < bytes.length; position += chunkBytes) {
      options.signal?.throwIfAborted();
      const chunk = new Uint8Array(bytes.subarray(position, Math.min(bytes.length, position + chunkBytes)));
      offset += chunk.length;
      yield chunk;
    }
  }
  function* node(value: PdfCosNode): Generator<Uint8Array, void, void> {
    for (const chunk of serializeCosNodeChunks(value, { ...options, chunkBytes, maxOutputBytes: maximum - offset })) {
      offset += chunk.length;
      yield chunk;
    }
  }
  yield* emit(originalBytes);
  yield* emit(textEncoder.encode("\n"));
  const offsets = new Map<number, { offset: number; generation: number }>();
  let maxObjNum = doc.maxObjectNumber;
  for (const obj of updatedObjects) {
    if (obj.objectNumber > maxObjNum) maxObjNum = obj.objectNumber;
    offsets.set(obj.objectNumber, { offset, generation: obj.generationNumber });
    yield* emit(textEncoder.encode(`${obj.objectNumber} ${obj.generationNumber} obj\n`));
    yield* node(obj.value);
    yield* emit(textEncoder.encode("\nendobj\n\n"));
  }
  const xrefOffset = offset;
  yield* emit(textEncoder.encode("xref\n0 1\n0000000000 65535 f \n"));
  const sortedNums = [...offsets.keys()].sort((a, b) => a - b);
  for (const num of sortedNums) {
    const entry = offsets.get(num)!;
    yield* emit(textEncoder.encode(`${num} 1\n${String(entry.offset).padStart(10, "0")} ${String(entry.generation).padStart(5, "0")} n \n`));
  }
  const trailerDict = cosDict({
    Size: cosNumber(maxObjNum + 1), Root: doc.rootRef, Info: doc.infoRef,
    Prev: cosNumber(doc.revisions[0]?.xrefOffset ?? 0),
  });
  yield* emit(textEncoder.encode("trailer\n"));
  yield* node(trailerDict);
  yield* emit(textEncoder.encode(`\n\nstartxref\n${xrefOffset}\n%%EOF`));
}

export function appendIncrementalRevision(originalBytes: Uint8Array, doc: ParsedCosDocument, updatedObjects: readonly PdfIndirectObject[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const chunk of appendIncrementalRevisionChunks(originalBytes, doc, updatedObjects)) {
    chunks.push(chunk.byteLength === chunk.buffer.byteLength ? chunk : new Uint8Array(chunk));
  }
  return concatByteArrays(chunks);
}
