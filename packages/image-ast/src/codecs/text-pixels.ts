import { parseColor, type RgbaImage, type SharpInputOptions } from "../ast.js";
import { FONT_5X7 } from "./font-5x7.js";

type Color = ReturnType<typeof parseColor>;
type TextSpec = NonNullable<SharpInputOptions["text"]>;
interface Character {
  code: number;
  fg: Color;
  bg: Color | undefined;
}
const white: Color = { r: 255, g: 255, b: 255, a: 255 };
function matches(text: string, at: number, value: string, end = text.length) {
  if (at + value.length > end) return false;
  for (let i = 0; i < value.length; i++) {
    const code = text.charCodeAt(at + i);
    if ((code >= 65 && code <= 90 ? code + 32 : code) !== value.charCodeAt(i)) return false;
  }
  return true;
}
function findTag(text: string, start: number, tag: string) {
  for (let at = text.indexOf("<", start); at >= 0; at = text.indexOf("<", at + 1))
    if (matches(text, at, tag)) return at;
  return -1;
}
function attribute(
  text: string,
  start: number,
  end: number,
  names: readonly string[]
): string | undefined {
  for (let at = start; at < end; at++)
    for (const name of names) {
      if (!matches(text, at, name, end)) continue;
      let p = at + name.length;
      while (p < end && text[p]!.trim() === "") p++;
      if (text[p++] !== "=") continue;
      while (p < end && text[p]!.trim() === "") p++;
      if (p >= end || (text[p] !== "'" && text[p] !== '"')) continue;
      const value = ++p;
      while (p < end && text[p] !== "'" && text[p] !== '"') p++;
      if (p > value && p < end) return text.slice(value, p);
    }
  return undefined;
}
/** Walk UTF-16 characters and style ranges without a materialized span list or stripped copy. */
function* characters(text: string): Generator<Character> {
  function* plain(start: number, end: number, fg: Color, bg?: Color): Generator<Character> {
    for (let at = start; at < end; at++) {
      if (text[at] === "<") {
        const close = text.indexOf(">", at + 1);
        if (close > at + 1 && close < end) {
          at = close;
          continue;
        }
      }
      yield { code: text.charCodeAt(at), fg, bg };
    }
  }
  let start = 0,
    search = 0;
  while (search < text.length) {
    const open = findTag(text, search, "<span");
    if (open < 0) break;
    const end = text.indexOf(">", open + 5);
    if (end < 0) break;
    const close = findTag(text, end + 1, "</span>");
    if (close < 0) break;
    if (open > start) yield* plain(start, open, white);
    const fg = attribute(text, open + 5, end, ["foreground", "fgcolor", "color"]),
      bg = attribute(text, open + 5, end, ["background", "bgcolor"]);
    const foreground = fg === undefined ? white : parseColor(fg, 255),
      background = bg === undefined ? undefined : parseColor(bg, 255);
    yield* plain(end + 1, close, foreground, background);
    start = close + 7;
    search = start;
  }
  if (start < text.length) yield* plain(start, text.length, white);
}

/** Shared sequential glyph raster, usable with caller buffers or retained storage. */
export class TextPixels {
  readonly metadata: Omit<RgbaImage, "data">;
  private readonly scale: number;
  private readonly charWidth: number;
  private readonly charHeight: number;
  private readonly text: string;
  private offset = 0;
  private glyphs: Generator<Character> | undefined;
  private glyph: Character | undefined;
  private glyphIndex = -1;
  constructor(spec: TextSpec, density?: number, signal?: AbortSignal) {
    if (!spec || typeof spec.text !== "string" || spec.text.length === 0)
      throw new Error("Expected a valid string to create an image with text.");
    if (spec.height !== undefined && spec.dpi !== undefined)
      throw new Error("Expected only one of dpi or height");
    this.text = spec.text;
    let count = 0;
    for (const ignored of characters(this.text)) {
      if (++count % 16384 === 0) signal?.throwIfAborted();
    }
    const total = Math.max(1, count),
      dpi =
        spec.dpi ??
        (spec.height ? Math.max(72, Math.round((spec.height / 9) * 72)) : (density ?? 72));
    this.scale = Math.max(1, Math.round(dpi / 72));
    this.charWidth = 6 * this.scale;
    this.charHeight = 9 * this.scale;
    const width = spec.width ?? Math.max(1, total * this.charWidth - this.scale),
      height = spec.height ?? Math.max(1, this.charHeight),
      autofitDpi = spec.dpi ?? Math.max(72, Math.round((height / 9) * 72)),
      rgba = Boolean(spec.rgba);
    this.metadata = {
      width,
      height,
      format: "raw",
      space: rgba ? "srgb" : "b-w",
      channels: rgba ? 4 : 1,
      depth: "uchar",
      density: autofitDpi,
      hasAlpha: rgba,
      textAutofitDpi: autofitDpi
    };
  }
  fill(bytes: Uint8Array) {
    const { width, height, hasAlpha } = this.metadata;
    for (let at = 0; at < bytes.length; at += 4) {
      const pixel = this.offset / 4,
        x = pixel % width,
        y = Math.floor(pixel / width);
      if (y >= height) throw new RangeError("Text pixel buffer exceeds raster");
      if (x === 0) {
        this.glyphs = y < this.charHeight ? characters(this.text) : undefined;
        this.glyph = undefined;
        this.glyphIndex = -1;
      }
      const index = Math.floor(x / this.charWidth);
      while (this.glyphs && this.glyphIndex < index) {
        this.glyph = this.glyphs.next().value;
        this.glyphIndex++;
        if (!this.glyph) this.glyphs = undefined;
      }
      let color: Color | undefined = hasAlpha && y < this.charHeight ? this.glyph?.bg : undefined;
      const gx = Math.floor((x % this.charWidth) / this.scale),
        gy = Math.floor(y / this.scale),
        code = this.glyph?.code;
      if (code !== undefined && code !== 32 && gx < 5 && gy >= 1 && gy < 8) {
        const glyph = Math.max(0, Math.min(94, code - 32));
        if (FONT_5X7[glyph * 5 + gx]! & (1 << (gy - 1))) color = hasAlpha ? this.glyph!.fg : white;
      }
      bytes[at] = color?.r ?? 0;
      bytes[at + 1] = color?.g ?? 0;
      bytes[at + 2] = color?.b ?? 0;
      bytes[at + 3] = color?.a ?? (hasAlpha ? 0 : 255);
      this.offset += 4;
    }
  }
}
