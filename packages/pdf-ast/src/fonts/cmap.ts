import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
export type { PdfFontAllocationOptions } from "./memory.js";
import { CosByteLexer, type CosToken } from "../cos/lexer.js";
import { bytesToString } from "../bytes.js";
import { CMap } from "../vendor/pdfjs-fonts.mjs";

export interface ParsedToUnicodeCMap {
  readonly map: ReadonlyMap<number, string>;
  readonly isTwoByte: boolean;
  iterateBytes(bytes: Uint8Array): Generator<{ charCode: number; unicode: string }, void, void>;
  decodeBytes(bytes: Uint8Array): Array<{ charCode: number; unicode: string }>;
}

function bytesToBigEndianUint(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = ((value << 8) | byte) >>> 0;
  return value;
}

function isString(token: CosToken | undefined): token is Extract<CosToken, { kind: "string" | "hex-string" }> {
  return token?.kind === "string" || token?.kind === "hex-string";
}

// PDF.js readToUnicode accepts numeric CIDs and restores omitted leading zero
// bytes before decoding UTF-16BE. Build in chunks to avoid argument limits.
function decodeDestination(value: number | string): string {
  if (typeof value === "number") return String.fromCodePoint(value);
  if (value.length % 2) value = "\0" + value;
  let decoded = "";
  for (let index = 0; index < value.length; index += 2) {
    decoded += String.fromCharCode((value.charCodeAt(index) << 8) | value.charCodeAt(index + 1));
  }
  return decoded;
}

export function parseCharacterCMap(cmapBytes: Uint8Array, options: PdfFontAllocationOptions = {}): CMap {
  return parseCMap(cmapBytes, new PdfFontAllocation(options));
}

function parseCMap(cmapBytes: Uint8Array, allocation: PdfFontAllocation): CMap {
  // Cover lexer number-array growth, token copies, byte strings and destination
  // arrays conservatively; expanded ranges are admitted separately below.
  allocation.admit(1024 + cmapBytes.length * 32);
  const lexer = new CosByteLexer(cmapBytes);
  const cmap = new CMap(false, bytes => allocation.admit(bytes));
  let inferredLength = 1;
  let section = "";
  // The block grammar follows PDF.js parseBfChar/parseBfRange/parseCidChar/
  // parseCidRange/parseCodespaceRange, adapted to our synchronous lexer.
  while (true) {
    const source = lexer.nextToken();
    if (!source) break;
    if (source.kind === "keyword") {
      if (source.value === "endcmap") break;
      section = source.value;
      continue;
    }
    if (!isString(source) || source.bytes.length < 1 || source.bytes.length > 4) continue;
    if (!["begincodespacerange", "beginbfchar", "begincidchar", "beginbfrange", "begincidrange"].includes(section)) continue;
    const low = bytesToBigEndianUint(source.bytes);
    const next = lexer.nextToken();
    if (section === "begincodespacerange") {
      if (isString(next) && next.bytes.length === source.bytes.length) cmap.addCodespaceRange(source.bytes.length, low, bytesToBigEndianUint(next.bytes));
    } else if (section === "beginbfchar" || section === "begincidchar") {
      inferredLength = Math.max(inferredLength, source.bytes.length);
      if (isString(next)) cmap.mapOne(low, bytesToString(next.bytes));
      else if (next?.kind === "number" && next.isInteger) cmap.mapOne(low, next.value);
    } else if (section === "beginbfrange" || section === "begincidrange") {
      inferredLength = Math.max(inferredLength, source.bytes.length);
      const destination = lexer.nextToken();
      if (!isString(next) || !destination) continue;
      const high = bytesToBigEndianUint(next.bytes);
      if (destination.kind === "array-start") {
        const array: Array<number | string> = [];
        while (true) {
          const item = lexer.nextToken();
          if (!item || item.kind === "array-end") break;
          if (isString(item)) array.push(bytesToString(item.bytes));
          else if (item.kind === "number" && item.isInteger) array.push(item.value);
        }
        try { cmap.mapBfRangeToArray(low, high, array); } catch (error) { allocation.rethrowAllocationFailure(error); /* PDF.js skips oversized ranges. */ }
      } else {
        try {
          if (isString(destination)) cmap.mapBfRange(low, high, bytesToString(destination.bytes));
          else if (destination.kind === "number" && destination.isInteger) {
            if (section === "begincidrange") cmap.mapCidRange(low, high, destination.value);
            else cmap.mapBfRange(low, high, String.fromCharCode(destination.value));
          }
        } catch (error) { allocation.rethrowAllocationFailure(error); /* Match PDF.js range-budget recovery. */ }
      }
    }
  }
  // Legacy callers often provide mapping blocks without a codespace declaration.
  // Preserve their fixed-width decoding, including zero-prefixed source codes.
  if (!cmap.numCodespaceRanges) cmap.addCodespaceRange(inferredLength, 0, 2 ** (8 * inferredLength) - 1);
  return cmap;
}

export function* iterateCMapCharacters(cmap: CMap, bytes: Uint8Array): Generator<{ charCode: number; isSpace: boolean }, void, void> {
  // PDF.js only requires charCodeAt; avoid constructing a token-sized string.
  const input = { charCodeAt: (index: number) => bytes[index] ?? NaN };
  const result = { charcode: 0, length: 0 };
  for (let offset = 0; offset < bytes.length;) {
    cmap.readCharCode(input, offset, result);
    if (offset + result.length > bytes.length) break;
    yield { charCode: result.charcode, isSpace: result.length === 1 && bytes[offset] === 0x20 };
    offset += result.length;
  }
}

export function readCMapCharacters(cmap: CMap, bytes: Uint8Array): Array<{ charCode: number; isSpace: boolean }> {
  return [...iterateCMapCharacters(cmap, bytes)];
}

export function parseToUnicodeCMap(cmapBytes: Uint8Array, options: PdfFontAllocationOptions = {}): ParsedToUnicodeCMap {
  const allocation = new PdfFontAllocation(options);
  const cmap = parseCMap(cmapBytes, allocation);
  const map = new Map<number, string>();
  cmap.forEach((code, value) => {
    allocation.admit(68 + (typeof value === "string" ? value.length * 2 : 0));
    map.set(code, decodeDestination(value));
  });
  const isTwoByte = cmap.codespaceRanges.slice(1).some(ranges => ranges.length > 0);
  function* iterateBytes(bytes: Uint8Array): Generator<{ charCode: number; unicode: string }, void, void> {
    for (const { charCode } of iterateCMapCharacters(cmap, bytes)) yield {
      charCode,
      unicode: map.get(charCode) ?? (charCode >= 0x20 && charCode <= 0x10ffff ? String.fromCodePoint(charCode) : ""),
    };
  }
  return { map, isTwoByte, iterateBytes, decodeBytes(bytes) { return [...iterateBytes(bytes)]; } };

}

export function generateToUnicodeCMap(cidToUnicode: ReadonlyMap<number, string>): Uint8Array {
  const entries = [...cidToUnicode.entries()].sort((a, b) => a[0] - b[0]);
  const lines: string[] = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /PoeCode-UTF16-H def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];

  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [cid, uni] of chunk) {
      const cidHex = cid.toString(16).toUpperCase().padStart(4, "0");
      let uniHex = "";
      for (let j = 0; j < uni.length; j++) {
        uniHex += uni.charCodeAt(j).toString(16).toUpperCase().padStart(4, "0");
      }
      lines.push(`<${cidHex}> <${uniHex}>`);
    }
    lines.push("endbfchar");
  }

  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return new TextEncoder().encode(lines.join("\n"));
}
