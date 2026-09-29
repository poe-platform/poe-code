/** PDF.js CFF parser and path compiler; see THIRD_PARTY_NOTICES.md. */
export class Stream { constructor(bytes: Uint8Array); }
export interface CffDict { getByName(name: "FontMatrix"): number[] | undefined; getByName(name: string): unknown; setByName(name: string, value: unknown): void; privateDict?: CffDict; subrsIndex?: { objects: Uint8Array[] }; }
export interface CffFont {
  header: { major: number; minor: number; hdrSize: number; offSize: number };
  names: string[];
  strings: { count: number; get(index: number): string };
  topDict: CffDict;
  charset: { charset: Array<string | number> };
  encoding: { encoding: Record<number, number> } | null;
  charStrings: { objects: Uint8Array[] };
  globalSubrIndex: { objects: Uint8Array[] };
  widths: number[];
  isCIDFont: boolean;
  fdSelect: unknown;
  fdArray: unknown[];
}
export class CFFStrings { get(index: number): string; }
export class CFFParser {
  constructor(stream: Stream, properties: Record<string, unknown>, seacAnalysisEnabled: boolean);
  parse(): CffFont;
  parseCharsets(offset: number, count: number, strings: CFFStrings | null, cid: boolean): { predefined: boolean; charset: Array<string | number> };
  parseEncoding(offset: number, properties: Record<string, unknown>, strings: CFFStrings, charset: null): { encoding: Record<number, number> };
  parseFDSelect(offset: number, count: number): { format: number; fdSelect: number[] };
}
export class CFFCompiler { constructor(cff: CffFont); compile(): number[]; }
export class Type2Compiled {
  constructor(info: Record<string, unknown>, cmap: Array<{ start: number; end: number; idDelta: number }>, fontMatrix: number[]);
  compileGlyph(code: Uint8Array, glyphId: number): ArrayLike<number>;
}
export function getGlyphsUnicode(): Record<string, number>;
export function getDingbatsGlyphsUnicode(): Record<string, number>;
export const SymbolSetEncoding: string[];
export const ZapfDingbatsEncoding: string[];
export const DrawOPS: { moveTo: number; lineTo: number; curveTo: number; quadraticCurveTo: number; closePath: number };
export const WinAnsiEncoding: string[];
export function getMetrics(): Record<string, number | (() => Record<string, number>)>;

export function getEncoding(name: string): string[] | null;

export class StringStream extends Stream { constructor(value: string); }
export interface Type1Properties extends Record<string, unknown> {
  fontMatrix: number[];
  bbox: number[];
}
export class Type1Font {
  constructor(name: string, stream: Stream, properties: Type1Properties);
  data: number[];
  seacs: Map<number, number[]>;
  getCharset(): string[];
  getGlyphMapping(properties: Type1Properties): Map<number, number>;
}
export class Type1Parser {
  constructor(stream: Stream, encrypted: boolean, seacAnalysisEnabled: boolean);
  getToken(): string | null;
  readNumber(): number;
  readBoolean(): number;
  readNumberArray(): number[];
  extractFontHeader(properties: Record<string, unknown>): void;
  extractFontProgram(properties: Record<string, unknown>): Type1Program;
  extractCidKeyedFontProgram(properties: Record<string, unknown>): Type1Program | null;
}
export interface Type1Program {
  subrs: number[][];
  charstrings: Array<{ glyphName: string; width: number; charstring: number[] }>;
  properties: { privateData: Map<string, unknown> };
}
