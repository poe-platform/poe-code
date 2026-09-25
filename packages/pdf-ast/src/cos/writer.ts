import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictGet,
  dictSet,
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
  readonly maxOutputBytes?: number | undefined;
  readonly maxObjects?: number | undefined;
}

const textEncoder = new TextEncoder();

export function serializeCosNodeBytes(node: PdfCosNode, depth = 0): Uint8Array {
  if (depth > 128) {
    throw new PdfError("E_CAPABILITY", "PDF object graph nesting depth exceeded");
  }
  switch (node.kind) {
    case "null":
      return textEncoder.encode("null");
    case "boolean":
      return textEncoder.encode(node.value ? "true" : "false");
    case "number": {
      if (!Number.isFinite(node.value)) {
        throw new PdfError("E_CAPABILITY", "Non-finite PDF number");
      }
      const hasExp = node.raw.includes("e") || node.raw.includes("E");
      const outRaw = hasExp ? formatPdfNumber(node.value) : node.raw;
      return textEncoder.encode(outRaw);
    }
    case "name": {
      let escaped = "/";
      for (let i = 0; i < node.decoded.length; i++) {
        const code = node.decoded.charCodeAt(i);
        if (
          code <= 0x20 ||
          code > 0x7e ||
          code === 0x23 || // #
          code === 0x28 || // (
          code === 0x29 || // )
          code === 0x3c || // <
          code === 0x3e || // >
          code === 0x5b || // [
          code === 0x5d || // ]
          code === 0x7b || // {
          code === 0x7d || // }
          code === 0x2f || // /
          code === 0x25    // %
        ) {
          escaped += `#${code.toString(16).padStart(2, "0").toUpperCase()}`;
        } else {
          escaped += node.decoded[i];
        }
      }
      return textEncoder.encode(escaped);
    }
    case "string": {
      if (node.format === "hex") {
        let hex = "<";
        for (let i = 0; i < node.bytes.length; i++) {
          hex += node.bytes[i]!.toString(16).padStart(2, "0").toUpperCase();
        }
        hex += ">";
        return textEncoder.encode(hex);
      }
      // Literal string with balanced parens and escaped control characters
      const out: number[] = [0x28]; // (
      for (let i = 0; i < node.bytes.length; i++) {
        const b = node.bytes[i]!;
        if (b === 0x28 || b === 0x29 || b === 0x5c) {
          out.push(0x5c, b);
        } else if (b === 0x0a) {
          out.push(0x5c, 0x6e);
        } else if (b === 0x0d) {
          out.push(0x5c, 0x72);
        } else if (b === 0x09) {
          out.push(0x5c, 0x74);
        } else {
          out.push(b);
        }
      }
      out.push(0x29); // )
      return Uint8Array.from(out);
    }
    case "ref":
      return textEncoder.encode(`${node.objectNumber} ${node.generationNumber} R`);
    case "array": {
      const parts: Uint8Array[] = [textEncoder.encode("[ ")];
      for (let i = 0; i < node.items.length; i++) {
        parts.push(serializeCosNodeBytes(node.items[i]!, depth + 1));
        parts.push(textEncoder.encode(" "));
      }
      parts.push(textEncoder.encode("]"));
      return concatByteArrays(parts);
    }
    case "dict": {
      const parts: Uint8Array[] = [textEncoder.encode("<<\n")];
      for (const entry of node.entries) {
        parts.push(serializeCosNodeBytes(entry.key, depth + 1));
        parts.push(textEncoder.encode(" "));
        parts.push(serializeCosNodeBytes(entry.value, depth + 1));
        parts.push(textEncoder.encode("\n"));
      }
      parts.push(textEncoder.encode(">>"));
      return concatByteArrays(parts);
    }
    case "stream": {
      const dictClone: PdfCosDict = {
        kind: "dict",
        entries: node.dict.entries.map(e =>
          e.key.decoded === "Length"
            ? { key: e.key, value: cosNumber(node.rawBytes.length) }
            : e
        ),
      };
      if (!dictGet(dictClone, "Length")) {
        dictSet(dictClone, "Length", cosNumber(node.rawBytes.length));
      }
      const dictBytes = serializeCosNodeBytes(dictClone, depth + 1);
      return concatByteArrays([
        dictBytes,
        textEncoder.encode("\nstream\n"),
        node.rawBytes,
        textEncoder.encode("\nendstream"),
      ]);
    }
  }
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

export function serializeCosDocument(options: SerializeCosOptions): Uint8Array {
  const maxOutputBytes = options.maxOutputBytes ?? 64_000_000;
  const maxObjects = options.maxObjects ?? 1_000_000;
  const sorted = [...options.objects].sort((a, b) => a.objectNumber - b.objectNumber);

  if (sorted.length > maxObjects) {
    throw new PdfError("E_LIMIT", "PDF object limit exceeded");
  }

  const maxObjectNumber = sorted.length > 0 ? sorted[sorted.length - 1]!.objectNumber : 0;
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
      const bodyChunks: Uint8Array[] = [];
      const headerPairs: string[] = [];
      let relOffset = 0;
      for (const pObj of packable) {
        headerPairs.push(`${pObj.objectNumber} ${relOffset}`);
        const bBytes = serializeCosNodeBytes(pObj.value);
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
        directOffsets.set(dObj.objectNumber, { offset, generation: dObj.generationNumber });
        const prefix = textEncoder.encode(`${dObj.objectNumber} ${dObj.generationNumber} obj\n`);
        const body = serializeCosNodeBytes(dObj.value);
        const suffix = textEncoder.encode("\nendobj\n\n");
        offset += prefix.length + body.length + suffix.length;
        chunks.push(prefix, body, suffix);
      }
      const compressedMap = new Map<number, number>();
      for (let idx = 0; idx < packable.length; idx++) {
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
      const xrefBody = serializeCosNodeBytes(xrefStreamNode);
      const xrefSuffix = textEncoder.encode(`\nendobj\n\nstartxref\n${xrefOffset}\n%%EOF`);
      chunks.push(xrefPrefix, xrefBody, xrefSuffix);
      return concatByteArrays(chunks);
    }
  }

  const objectOffsets = new Map<number, { offset: number; generation: number }>();

  for (const obj of sorted) {
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
    const body = serializeCosNodeBytes(value);
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
    serializeCosNodeBytes(trailerDict),
    textEncoder.encode(`\n\nstartxref\n${xrefOffset}\n%%EOF`),
  ]);

  if (offset + trailerBytes.length > maxOutputBytes) {
    throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
  }
  chunks.push(trailerBytes);
  return concatByteArrays(chunks);
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
