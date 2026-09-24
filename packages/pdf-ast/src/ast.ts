import { encodeFlate } from "./cos/filters.js";

export interface ByteSpan {
  readonly start: number;
  readonly end: number;
}

export type PdfRect = readonly [number, number, number, number];

// ============================================================================
// Layer 1: COS & Revision Object Graph AST
// ============================================================================

export interface PdfCosNull {
  readonly kind: "null";
  readonly span?: ByteSpan | undefined;
}

export interface PdfCosBoolean {
  readonly kind: "boolean";
  readonly value: boolean;
  readonly span?: ByteSpan | undefined;
}

export interface PdfCosNumber {
  readonly kind: "number";
  readonly value: number;
  readonly raw: string;
  readonly isInteger: boolean;
  readonly span?: ByteSpan | undefined;
}

export interface PdfCosName {
  readonly kind: "name";
  readonly decoded: string;
  readonly rawBytes: Uint8Array;
  readonly span?: ByteSpan | undefined;
}

export interface PdfCosString {
  readonly kind: "string";
  readonly format?: "literal" | "hex" | undefined;
  readonly encoding?: "literal" | "hex" | undefined;
  readonly bytes: Uint8Array;
  readonly span?: ByteSpan | undefined;
}

export interface PdfCosArray {
  readonly kind: "array";
  readonly items: PdfCosNode[];
  readonly span?: ByteSpan | undefined;
}

export interface PdfDictEntry {
  readonly key: PdfCosName;
  readonly value: PdfCosNode;
}

export interface PdfCosDict {
  readonly kind: "dict";
  readonly entries: PdfDictEntry[];
  readonly span?: ByteSpan | undefined;
}

export interface PdfCosStream {
  readonly kind: "stream";
  readonly dict: PdfCosDict;
  readonly rawBytes: Uint8Array;
  readonly decodedBytes?: Uint8Array | undefined;
  readonly span?: ByteSpan | undefined;
}

export interface PdfCosRef {
  readonly kind: "ref";
  readonly objectNumber: number;
  readonly generationNumber: number;
  readonly span?: ByteSpan | undefined;
}

export type PdfCosNode =
  | PdfCosNull
  | PdfCosBoolean
  | PdfCosNumber
  | PdfCosName
  | PdfCosString
  | PdfCosArray
  | PdfCosDict
  | PdfCosStream
  | PdfCosRef;

export interface PdfIndirectObject {
  readonly objectNumber: number;
  readonly generationNumber: number;
  readonly value: PdfCosNode;
  readonly span?: ByteSpan | undefined;
}

export interface PdfXRefEntry {
  readonly objectNumber: number;
  readonly generationNumber?: number | undefined;
  readonly type: "free" | "uncompressed" | "compressed";
  readonly offset?: number | undefined;
  readonly nextFreeObjectNumber?: number | undefined;
  readonly objectStreamNumber?: number | undefined;
  readonly indexInStream?: number | undefined;
  readonly indexInObjectStream?: number | undefined;
}

export interface PdfRevision {
  readonly xrefOffset: number;
  readonly entries: ReadonlyMap<number, PdfXRefEntry>;
  readonly trailer: PdfCosDict;
  readonly previousXrefOffset?: number | undefined;
}

export interface PdfPermissions {
  readonly print: boolean;
  readonly modify: boolean;
  readonly copy: boolean;
  readonly addNotes: boolean;
  readonly fillForms: boolean;
  readonly extractAccessibility: boolean;
  readonly assemble: boolean;
  readonly printHighRes: boolean;
}

export interface PdfEncryptionState {
  readonly filter: string;
  readonly version: number;
  readonly revision: number;
  readonly keyLengthBits: number;
  readonly encryptMetadata: boolean;
  readonly permissions: PdfPermissions;
  readonly fileKey: Uint8Array;
}

// ============================================================================
// Layer 2: Content Stream & Display List AST
// ============================================================================

export type PdfTextCommand =
  | { readonly kind: "font"; readonly fontName: string; readonly size: number }
  | { readonly kind: "matrix"; readonly matrix: readonly [number, number, number, number, number, number] }
  | { readonly kind: "move"; readonly tx: number; readonly ty: number; readonly setLeading?: boolean | undefined }
  | { readonly kind: "next-line" }
  | { readonly kind: "leading"; readonly leading: number }
  | { readonly kind: "char-spacing"; readonly charSpace: number }
  | { readonly kind: "word-spacing"; readonly wordSpace: number }
  | { readonly kind: "horiz-scaling"; readonly scalePercent: number }
  | { readonly kind: "render-mode"; readonly mode: number }
  | { readonly kind: "rise"; readonly rise: number }
  | { readonly kind: "show-text"; readonly token: PdfCosString }
  | { readonly kind: "show-text-array"; readonly items: readonly (PdfCosString | PdfCosNumber)[] };

export type PdfPathSegment =
  | { readonly kind: "move"; readonly x: number; readonly y: number }
  | { readonly kind: "line"; readonly x: number; readonly y: number }
  | { readonly kind: "cubic"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number }
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: "close" };

export type PdfContentNode =
  | { readonly kind: "graphics-group"; readonly ops: PdfContentNode[] }
  | {
      readonly kind: "marked-content";
      readonly tag: string;
      readonly properties?: PdfCosDict | string | undefined;
      readonly actualText?: string | undefined;
      readonly mcid?: number | undefined;
      readonly children: PdfContentNode[];
    }
  | { readonly kind: "text-object"; readonly commands: PdfTextCommand[] }
  | {
      readonly kind: "path-op";
      readonly segments: PdfPathSegment[];
      readonly paint: "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n";
      readonly clip?: "W" | "W*" | undefined;
    }
  | { readonly kind: "xobject"; readonly name: string }
  | { readonly kind: "inline-image"; readonly dict: PdfCosDict; readonly data: Uint8Array }
  | { readonly kind: "state-op"; readonly operator: string; readonly operands: PdfCosNode[] };

export interface PdfRgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface PdfPlacedGlyph {
  readonly charCode: number;
  readonly unicode: string;
  readonly bbox: PdfRect;
  readonly baselineY: number;
  readonly advanceWidth: number;
  readonly matrix: readonly [number, number, number, number, number, number];
  readonly fontSize: number;
  readonly fontName: string;
  readonly color: PdfRgbColor;
  readonly mcid?: number | undefined;
  readonly actualText?: string | undefined;
}

export interface PdfEvaluatedPath {
  readonly segments: readonly PdfPathSegment[];
  readonly strokeColor?: PdfRgbColor | undefined;
  readonly fillColor?: PdfRgbColor | undefined;
  readonly strokeWidth: number;
  readonly fillRule?: "nonzero" | "evenodd" | undefined;
  readonly dashArray?: readonly number[] | undefined;
  readonly isClip?: boolean | undefined;
}

export interface PdfEvaluatedImage {
  readonly name: string;
  readonly matrix: readonly [number, number, number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly colorSpace: string;
  readonly bitsPerComponent: number;
  readonly decodedRgba?: Uint8Array | undefined;
}

export interface PdfLinkAnnotation {
  readonly rect: PdfRect;
  readonly uri?: string | undefined;
  readonly contents?: string | undefined;
  readonly destinationPage?: number | undefined;
}

export interface PdfDisplayList {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly glyphs: readonly PdfPlacedGlyph[];
  readonly paths: readonly PdfEvaluatedPath[];
  readonly images: readonly PdfEvaluatedImage[];
  readonly annotations: readonly PdfLinkAnnotation[];
}

// ============================================================================
// Layer 3: High-Level Layout, Structure Tree & Extraction AST
// ============================================================================

export interface PdfTextWord {
  readonly text: string;
  readonly bbox: PdfRect;
  readonly fontSize?: number | undefined;
  readonly fontName?: string | undefined;
  readonly glyphs: readonly PdfPlacedGlyph[];
}

export interface PdfTextLine {
  readonly text: string;
  readonly bbox: PdfRect;
  readonly baselineY: number;
  readonly words: PdfTextWord[];
}

export interface PdfTextBlock {
  readonly kind: "heading" | "paragraph" | "list-item" | "code";
  readonly level?: number | undefined;
  readonly text?: string | undefined;
  readonly bbox: PdfRect;
  readonly lines: PdfTextLine[];
}

export interface PdfExtractedTableCell {
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
  readonly text: string;
  readonly bbox: PdfRect;
}

export interface PdfExtractedTable {
  readonly pageIndex: number;
  readonly bbox: PdfRect;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly cells?: readonly PdfExtractedTableCell[] | undefined;
}

export interface PdfExtractedPage {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: 0 | 90 | 180 | 270 | undefined;
  readonly blocks: PdfTextBlock[];
  readonly tables: readonly PdfExtractedTable[];
  readonly links?: readonly PdfLinkAnnotation[] | undefined;
}

export type PdfSemanticNode =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string; readonly links?: readonly PdfLinkAnnotation[] | undefined }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: string[] }
  | { readonly kind: "code-block"; readonly text: string }
  | { readonly kind: "table"; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: "link"; readonly text: string; readonly uri: string }
  | { readonly kind: "image"; readonly pageIndex: number; readonly width: number; readonly height: number };

// ============================================================================
// Helper Constructors for COS AST
// ============================================================================

const textEncoder = new TextEncoder();

export function cosNull(span?: ByteSpan): PdfCosNull {
  return { kind: "null", span };
}

export function cosBool(value: boolean, span?: ByteSpan): PdfCosBoolean {
  return { kind: "boolean", value, span };
}

export function formatPdfNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-10) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  const fixed = value.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" || fixed === "" ? "0" : fixed;
}

export function cosNumber(value: number, raw?: string, span?: ByteSpan): PdfCosNumber {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid non-finite PDF number: ${String(value)}`);
  }
  const isInteger = Number.isInteger(value);
  const formatted =
    raw !== undefined && !/[eE]/.test(raw)
      ? raw
      : formatPdfNumber(value);
  return { kind: "number", value, raw: formatted, isInteger, span };
}

export function cosName(decoded: string, rawBytes?: Uint8Array, span?: ByteSpan): PdfCosName {
  return {
    kind: "name",
    decoded,
    rawBytes: rawBytes ?? textEncoder.encode(decoded),
    span,
  };
}

export function cosString(value: string | Uint8Array, span?: ByteSpan): PdfCosString {
  if (typeof value === "string") {
    // Encode ASCII/Latin-1 directly or UTF-16BE with BOM if non-Latin1
    let needsUtf16 = false;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 0xff) {
        needsUtf16 = true;
        break;
      }
    }
    if (needsUtf16) {
      const bytes = new Uint8Array(2 + value.length * 2);
      bytes[0] = 0xfe;
      bytes[1] = 0xff;
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        bytes[2 + i * 2] = (code >>> 8) & 0xff;
        bytes[2 + i * 2 + 1] = code & 0xff;
      }
      return { kind: "string", format: "hex", bytes, span };
    }
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
      bytes[i] = value.charCodeAt(i) & 0xff;
    }
    return { kind: "string", format: "literal", bytes, span };
  }
  return { kind: "string", format: "literal", bytes: value, span };
}

export function cosHexString(hexOrBytes: string | Uint8Array, span?: ByteSpan): PdfCosString {
  if (typeof hexOrBytes === "string") {
    const clean = hexOrBytes.replace(/\s+/g, "");
    const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
    const bytes = new Uint8Array(padded.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return { kind: "string", format: "hex", bytes, span };
  }
  return { kind: "string", format: "hex", bytes: hexOrBytes, span };
}

export function cosArray(items: PdfCosNode[], span?: ByteSpan): PdfCosArray {
  return { kind: "array", items: [...items], span };
}

export function cosDict(
  entriesOrRecord: readonly PdfDictEntry[] | Record<string, PdfCosNode | undefined>,
  span?: ByteSpan
): PdfCosDict {
  if (Array.isArray(entriesOrRecord)) {
    return { kind: "dict", entries: [...entriesOrRecord], span };
  }
  const rec = entriesOrRecord as Record<string, PdfCosNode | undefined>;
  const entries: PdfDictEntry[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined) {
      entries.push({ key: cosName(k), value: v });
    }
  }
  return { kind: "dict", entries, span };
}

export function cosRef(objectNumber: number, generationNumber = 0, span?: ByteSpan): PdfCosRef {
  return { kind: "ref", objectNumber, generationNumber, span };
}

export function cosStream(
  dataOrDict: Uint8Array | PdfCosDict,
  optionsOrData: { dict?: PdfCosDict; compress?: boolean } | Uint8Array = {},
  span?: ByteSpan
): PdfCosStream {
  const data = dataOrDict instanceof Uint8Array ? dataOrDict : (optionsOrData as Uint8Array);
  const options: { dict?: PdfCosDict; compress?: boolean } =
    dataOrDict instanceof Uint8Array
      ? (optionsOrData as { dict?: PdfCosDict; compress?: boolean })
      : { dict: dataOrDict };
  const entries = options.dict ? [...options.dict.entries] : [];
  const setEntry = (name: string, value: PdfCosNode) => {
    const idx = entries.findIndex(e => e.key.decoded === name);
    if (idx >= 0) entries[idx] = { key: cosName(name), value };
    else entries.push({ key: cosName(name), value });
  };
  if (options.compress) {
    const compressed = encodeFlate(data);
    setEntry("Filter", cosName("FlateDecode"));
    setEntry("Length", cosNumber(compressed.length));
    return {
      kind: "stream",
      dict: { kind: "dict", entries },
      rawBytes: compressed,
      decodedBytes: data,
      span,
    };
  }
  setEntry("Length", cosNumber(data.length));
  return {
    kind: "stream",
    dict: { kind: "dict", entries },
    rawBytes: data,
    decodedBytes: data,
    span,
  };
}

export function dictGet(dict: PdfCosDict, key: string): PdfCosNode | undefined {
  // Last key wins per PDF recovery rules
  for (let i = dict.entries.length - 1; i >= 0; i--) {
    if (dict.entries[i]!.key.decoded === key) {
      return dict.entries[i]!.value;
    }
  }
  return undefined;
}

export function dictSet(dict: PdfCosDict, key: string, value: PdfCosNode): void {
  for (let i = dict.entries.length - 1; i >= 0; i--) {
    if (dict.entries[i]!.key.decoded === key) {
      dict.entries[i] = { key: cosName(key), value };
      return;
    }
  }
  dict.entries.push({ key: cosName(key), value });
}

export function dictDelete(dict: PdfCosDict, key: string): void {
  for (let i = dict.entries.length - 1; i >= 0; i--) {
    if (dict.entries[i]!.key.decoded === key) {
      dict.entries.splice(i, 1);
    }
  }
}

export function decodePdfString(node: PdfCosString): string {
  const bytes = node.bytes;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    }
    return out;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i + 1]! << 8) | bytes[i]!);
    }
    return out;
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}
