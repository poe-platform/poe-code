/** PDF.js CFF parser and path compiler; see THIRD_PARTY_NOTICES.md. */
export class Stream { constructor(bytes: Uint8Array); }
export interface CffDict { getByName(name: "FontMatrix"): number[] | undefined; getByName(name: string): unknown; setByName(name: string, value: unknown): void; privateDict?: CffDict; subrsIndex?: { objects: Uint8Array[] }; }
export interface CffFont {
  header: { major: number; minor: number; hdrSize: number; offSize: number };
  names: string[];
  strings: { count: number; get(index: number): string };
  topDict: CffDict;
  charset: { charset: string[] };
  charStrings: { objects: Uint8Array[] };
  globalSubrIndex: { objects: Uint8Array[] };
  widths: number[];
  isCIDFont: boolean;
  fdSelect: unknown;
  fdArray: unknown[];
}
export class CFFParser { constructor(stream: Stream, properties: Record<string, unknown>, seacAnalysisEnabled: boolean); parse(): CffFont; }
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
