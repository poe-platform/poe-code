import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { singleByteTables } from "../encoding/tables.js";
import { biffDbcsTables } from "../encoding/biff-dbcs-tables.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import type { RichTextRun } from "../workbook.js";

// Native gnm_xl_get_codepage accepts these exact spellings, not iconv's alias set.
const overrideCodepages: Readonly<Record<string, number>> = {
  "windows-1250": 1250, "windows-1251": 1251, "windows-1252": 1252,
  "windows-1254": 1254, "windows-1255": 1255, "windows-1256": 1256, "windows-1257": 1257,
  "windows-1258": 1258, "windows-936": 936
};
export function biffOverrideCodepage(encoding: string | undefined): number | undefined {
  return encoding === undefined ? undefined : overrideCodepages[encoding];
}
export function biffDecode(bytes: Uint8Array, codepage: number): string {
  const multibyte = biffDbcsTables[codepage];
  if (multibyte) {
    const characters: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const lead = bytes[i]!, single = multibyte.single[lead]!;
      if (single !== "\uffff") { characters.push(single); continue; }
      const trail = bytes[++i], character = trail === undefined ? undefined : multibyte.double[lead]?.[trail];
      if (character === undefined || character === "\uffff") invalidBiff("invalid or truncated DBCS character");
      characters.push(character);
    }
    return characters.join("");
  }
  const name = codepage === 1200 || codepage === 1201 ? "iso-8859-1" :
    codepage === 10000 ? "macintosh" : codepage >= 1250 && codepage <= 1258 ? `windows-${codepage}` : `cp${codepage}`;
  const table = singleByteTables[name];
  if (!table) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: BIFF codepage ${codepage}`);
  const characters: string[] = [];
  for (const byte of bytes) {
    const character = table[byte]!;
    if (character === "\uffff") invalidBiff("invalid codepage character");
    characters.push(character);
  }
  return characters.join("");
}

/** CONTINUE starts with a width flag only when it interrupts character data. */
export class BiffStrings {
  private part = 0;
  private offset = 0;
  constructor(private readonly parts: readonly Binary[], private readonly context: CapabilityContext,
    private readonly codepage: number) {}
  get consumedBytes(): number {
    return this.parts.slice(0, this.part).reduce((total, part) => total + part.bytes.length, 0) + this.offset;
  }
  private advance(): void {
    while (this.part < this.parts.length && this.offset === this.parts[this.part]!.bytes.length) {
      this.part++; this.offset = 0;
    }
    if (this.part >= this.parts.length) invalidBiff("truncated string/CONTINUE");
  }
  byte(): number { this.advance(); return this.parts[this.part]!.u8(this.offset++); }
  word(): number { const low = this.byte(); return low + this.byte() * 256; }
  dword(): number { const low = this.word(); return low + this.word() * 65536; }
  legacy(length: number): string {
    this.admit(length);
    const bytes = new Uint8Array(length); for (let i = 0; i < length; i++) bytes[i] = this.byte();
    return biffDecode(bytes, this.codepage);
  }
  private admit(length: number): void {
    this.context.signal.throwIfAborted();
    if (length > (this.context.limits.workbookTextBytes ?? this.context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF string limit exceeded");
  }
  unicode(length: number): { text: string; richText?: readonly RichTextRun[] } {
    this.admit(length * 3);
    const flags = this.byte();
    if (flags & 0xf2) invalidBiff("invalid Unicode string flags");
    let wide = !!(flags & 1);
    const runCount = flags & 8 ? this.word() : 0, extensionLength = flags & 4 ? this.dword() : 0;
    this.admit(runCount * 4 + extensionLength);
    const characters: string[] = [];
    for (let i = 0; i < length; i++) {
      this.context.signal.throwIfAborted();
      if (this.offset === this.parts[this.part]!.bytes.length) {
        this.advance(); const width = this.byte(); if (width > 1) invalidBiff("invalid CONTINUE string width"); wide = !!width;
      }
      const data = this.parts[this.part]!;
      data.check(this.offset, wide ? 2 : 1);
      characters.push(String.fromCharCode(wide ? data.u16(this.offset) : data.u8(this.offset)));
      this.offset += wide ? 2 : 1;
    }
    const runs: { start: number; font: number }[] = [];
    for (let i = 0; i < runCount; i++) {
      const start = this.word(), font = this.word();
      if (start > length || i && start < runs[i - 1]!.start) invalidBiff("invalid rich string run");
      runs.push({ start, font });
    }
    for (let i = 0; i < extensionLength; i++) this.byte();
    return { text: characters.join(""), ...(runs.length ? { richText: runs.map((run, index) => ({ start: run.start,
      end: runs[index + 1]?.start ?? length, attributes: { "biff-font-index": run.font } })) } : {}) };
  }
}
