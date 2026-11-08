// Psiconv 0.9.9 parse_layout.c and Gnumeric psiconv-read.c; GPL-2.0-or-later.
import { SsconvertError } from "../contracts.js";
import type { ImportedValue } from "../workbook.js";
export interface PsionLayoutCursor {
  readonly at: number;
  u8(): number;
  u32(): number;
  characters(length: number): string;
}
export interface PsionCellLayout {
  readonly format: string;
  readonly style?: Readonly<Record<string, ImportedValue>>;
}
// Gnumeric casts psiconv's UCS2 font name to char*. The captured little-endian
// ABI sees only 'T' from the default Times New Roman name.
export const psionDefaultCharacter = Object.freeze({ fontName: "T", fontSize: 10, fontColor: "#000000", italic: false, bold: false, underline: false, strike: false });
function font(c: PsionLayoutCursor, applyAbi: boolean): string {
  const length = c.u8();
  if (length < 2) throw new SsconvertError("io", "Error while parsing Psion file.");
  const name = c.characters(length - 1); c.u8();
  if (!applyAbi) return name;
  const bytes: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const unit = name.charCodeAt(i), low = unit & 255, high = unit >> 8;
    if (!low) break;
    bytes.push(low); if (!high) break;
    bytes.push(high);
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); }
  catch { throw new SsconvertError("unsupported-feature", "ssconvert Psion invalid UTF-8 ABI font names are not qualified"); }
}
function color(c: PsionLayoutCursor): string {
  return "#" + [c.u8(), c.u8(), c.u8()].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** Paragraph attributes are structurally decoded but ignored by Gnumeric. */
export function parsePsionParagraphLayout(c: PsionLayoutCursor): void {
  const length = c.u32(), end = c.at + length;
  while (c.at < end) {
    const code = c.u8();
    if (code === 1) color(c);
    else if ([2, 3, 4, 7, 9, 10, 16, 22].includes(code)) c.u32();
    else if (code >= 17 && code <= 20) { c.u8(); c.u32(); color(c); c.u8(); }
    else if (code === 21) { c.u8(); c.u32(); c.characters(1); c.u8(); color(c); font(c, false); }
    else if (code === 23) { c.u32(); c.u8(); }
    else c.u8(); // Known booleans/justification and source unknown-code skip.
  }
  if (c.at !== end) throw new SsconvertError("io", "Error while parsing Psion file.");
}
export function parsePsionCharacterLayout(c: PsionLayoutCursor,
  inherited: Readonly<Record<string, ImportedValue>> = psionDefaultCharacter,
  applyFontAbi = true): Readonly<Record<string, ImportedValue>> {
  const length = c.u32(), end = c.at + length, style = { ...inherited };
  while (c.at < end) {
    const code = c.u8();
    if (code === 0x19) style.fontColor = color(c);
    else if (code === 0x1a) color(c); // Gnumeric deliberately ignores background.
    else if (code === 0x1c) { const size = c.u32(); style.fontSize = (size >= 2 ** 31 ? size - 2 ** 32 : size) / 20; }
    else if ([0x1d, 0x1e, 0x20, 0x21].includes(code)) style[({ 0x1d: "italic", 0x1e: "bold", 0x20: "underline", 0x21: "strike" } as Record<number, string>)[code]!] = !!c.u8();
    else if (code === 0x22) style.fontName = font(c, applyFontAbi);
    else c.u8(); // Unsupported super/sub and source unknown-code skip.
  }
  if (c.at !== end) throw new SsconvertError("io", "Error while parsing Psion file.");
  return style;
}
