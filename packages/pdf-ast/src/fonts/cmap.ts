import { CosByteLexer } from "../cos/lexer.js";

export interface ParsedToUnicodeCMap {
  readonly map: ReadonlyMap<number, string>;
  readonly isTwoByte: boolean;
  decodeBytes(bytes: Uint8Array): Array<{ charCode: number; unicode: string }>;
}

function bytesToBigEndianUint(bytes: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < bytes.length; i++) {
    v = (v << 8) | bytes[i]!;
  }
  return v >>> 0;
}

function decodeUtf16BeBytes(bytes: Uint8Array): string {
  if (bytes.length === 1) {
    return String.fromCharCode(bytes[0]!);
  }
  const units: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    units.push((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return String.fromCharCode(...units);
}

function incrementStringCodePoint(str: string, delta: number): string {
  if (str.length === 0) return "";
  const prefix = str.slice(0, -1);
  const lastCp = str.codePointAt(str.length - 1) ?? 0;
  return prefix + String.fromCodePoint(lastCp + delta);
}

export function parseToUnicodeCMap(cmapBytes: Uint8Array): ParsedToUnicodeCMap {
  const lexer = new CosByteLexer(cmapBytes);
  const map = new Map<number, string>();
  let isTwoByte = false;

  while (true) {
    const tok = lexer.nextToken();
    if (!tok) break;

    if (tok.kind === "keyword" && tok.value === "begincodespacerange") {
      while (true) {
        const t1 = lexer.nextToken();
        if (!t1 || (t1.kind === "keyword" && t1.value === "endcodespacerange")) break;
        const t2 = lexer.nextToken();
        if (t1.kind === "hex-string" && t1.bytes.length >= 2) {
          isTwoByte = true;
        }
        if (!t2 || (t2.kind === "keyword" && t2.value === "endcodespacerange")) break;
      }
    } else if (tok.kind === "keyword" && tok.value === "beginbfchar") {
      while (true) {
        const srcTok = lexer.nextToken();
        if (!srcTok || (srcTok.kind === "keyword" && srcTok.value === "endbfchar")) break;
        const dstTok = lexer.nextToken();
        if (!dstTok || (dstTok.kind === "keyword" && dstTok.value === "endbfchar")) break;
        if (srcTok.kind === "hex-string" && dstTok.kind === "hex-string") {
          if (srcTok.bytes.length >= 2) isTwoByte = true;
          const code = bytesToBigEndianUint(srcTok.bytes);
          map.set(code, decodeUtf16BeBytes(dstTok.bytes));
        }
      }
    } else if (tok.kind === "keyword" && tok.value === "beginbfrange") {
      while (true) {
        const startTok = lexer.nextToken();
        if (!startTok || (startTok.kind === "keyword" && startTok.value === "endbfrange")) break;
        const endTok = lexer.nextToken();
        const targetTok = lexer.nextToken();
        if (!endTok || !targetTok) break;
        if (startTok.kind === "hex-string" && endTok.kind === "hex-string") {
          if (startTok.bytes.length >= 2) isTwoByte = true;
          const startCode = bytesToBigEndianUint(startTok.bytes);
          const endCode = bytesToBigEndianUint(endTok.bytes);
          if (targetTok.kind === "hex-string") {
            const baseStr = decodeUtf16BeBytes(targetTok.bytes);
            for (let c = startCode; c <= endCode && c - startCode <= 65535; c++) {
              map.set(c, incrementStringCodePoint(baseStr, c - startCode));
            }
          } else if (targetTok.kind === "array-start") {
            let c = startCode;
            while (true) {
              const item = lexer.nextToken();
              if (!item || item.kind === "array-end") break;
              if (item.kind === "hex-string" && c <= endCode) {
                map.set(c, decodeUtf16BeBytes(item.bytes));
                c++;
              }
            }
          }
        }
      }
    }
  }

  return {
    map,
    isTwoByte,
    decodeBytes(bytes: Uint8Array): Array<{ charCode: number; unicode: string }> {
      const out: Array<{ charCode: number; unicode: string }> = [];
      if (isTwoByte && bytes.length >= 2 && bytes.length % 2 === 0) {
        for (let i = 0; i < bytes.length; i += 2) {
          const cid = (bytes[i]! << 8) | bytes[i + 1]!;
          const mapped = map.get(cid) ?? (cid >= 0x20 ? String.fromCodePoint(cid) : "");
          out.push({ charCode: cid, unicode: mapped });
        }
        return out;
      }
      for (let i = 0; i < bytes.length; i++) {
        const code = bytes[i]!;
        const mapped = map.get(code) ?? (code >= 0x20 ? String.fromCharCode(code) : "");
        out.push({ charCode: code, unicode: mapped });
      }
      return out;
    },
  };
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
