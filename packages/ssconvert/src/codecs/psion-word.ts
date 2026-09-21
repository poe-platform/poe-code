// Psiconv 0.9.9 parse_driver.c, parse_word.c, parse_common.c; GPL-2.0-or-later.
import { SsconvertError } from "../contracts.js";
import type { ImportedValue } from "../workbook.js";
import { parsePsionCharacterLayout, parsePsionParagraphLayout, psionDefaultCharacter, type PsionLayoutCursor } from "./psion-layout.js";
import type { PsionParseJob } from "./psion-page.js";

export interface PsionWordCursor extends PsionLayoutCursor { u16(): number; x(): number; text(): string; }
export interface PsionWordHooks { page(offset: number): PsionParseJob; embedded(offset: number): PsionParseJob; }
type Character = Readonly<Record<string, ImportedValue>>;
function invalid(): never { throw new SsconvertError("io", "Error while parsing Psion file."); }
function unqualified(part: string): never { throw new SsconvertError("unsupported-feature", `ssconvert Psion Word ${part} is not qualified`); }

/** Embedded Word contents are parsed by psiconv but discarded by Gnumeric. */
export function* parsePsionWord(cursor: (offset: number) => PsionWordCursor, hooks: PsionWordHooks): PsionParseJob {
  const table = cursor(cursor(0).u32()), count = table.u8() >> 1, sections = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const id = table.u32(), offset = table.u32();
    if (id === 0x100000cd) invalid();
    sections.set(id, offset);
  }
  for (const id of [0x10000243, 0x10000089, 0x10000105, 0x10000104, 0x10000106]) if (!sections.get(id)) invalid();
  const status = cursor(sections.get(0x10000243)!);
  for (let i = 0; i < 6; i++) status.u8(); status.u32(); status.u32();
  const app = cursor(sections.get(0x10000089)!);
  if (app.u32() !== 0x1000007f || app.text().toLowerCase() !== "word.app") invalid();
  yield hooks.page(sections.get(0x10000105)!);

  const s = cursor(sections.get(0x10000104)!);
  parsePsionParagraphLayout(s);
  // The Gnumeric UCS2-to-char* ABI bug applies to Sheet cells only.
  const normal = parsePsionCharacterLayout(s, { ...psionDefaultCharacter, fontName: "Times New Roman" }, false);
  s.u32(); const hotkeys = s.u8(); for (let i = 0; i < hotkeys; i++) s.u32();
  const namedCount = s.u8(), named: Character[] = [];
  // Native leaves style fields uninitialized when there are excess hotkeys.
  if (hotkeys > namedCount) unqualified("excess style hotkeys");
  for (let i = 0; i < namedCount; i++) {
    s.text(); s.u32(); s.u32();
    named.push(parsePsionCharacterLayout(s, normal, false));
    parsePsionParagraphLayout(s);
  }
  for (let i = 0; i < namedCount; i++) s.u8();
  const style = (id: number): Character | undefined => id === 0 ? normal : named[255 - id];
  const text = cursor(sections.get(0x10000106)!), characters = text.characters(text.x());
  let paragraphs = 0;
  for (let i = 0; i < characters.length; i++) if (characters.charCodeAt(i) === 6 || i === characters.length - 1) paragraphs++;
  const layoutOffset = sections.get(0x10000143); if (!layoutOffset) return;
  const c = cursor(layoutOffset), styled = c.u16() !== 0, types = c.u8();
  const anonymous = new Map<number, Character>();
  function baseId(): number {
    if (!styled) return 0;
    const preview = cursor(c.at), length = preview.u32(); return cursor(preview.at + length).u8();
  }
  for (let i = 0; i < types; i++) {
    const id = c.u32(), inherited = style(baseId()); if (!inherited) invalid();
    parsePsionParagraphLayout(c); if (styled) c.u8();
    const character = parsePsionCharacterLayout(c, inherited, false);
    if (!anonymous.has(id)) anonymous.set(id, character);
  }
  const elements = c.u32();
  // Native indexes uninitialized inline counts (fewer elements) or constructs
  // paragraphs with uninitialized text pointers (more elements).
  if (elements !== paragraphs) unqualified("mismatched text/layout paragraph counts");
  const inlines: { count: number; character: Character }[] = [];
  for (let i = 0; i < elements; i++) {
    c.u32(); const reference = c.u8();
    if (reference) inlines.push({ count: 0, character: anonymous.get(reference) ?? normal });
    else {
      const inherited = style(baseId()) ?? normal;
      parsePsionParagraphLayout(c); if (styled) c.u8();
      inlines.push({ count: c.u32(), character: inherited });
    }
  }
  const total = c.u32(); let consumed = 0;
  for (const line of inlines) {
    const available = Math.min(line.count, total - consumed);
    for (let i = 0; i < available; i++, consumed++) {
      const type = c.u8(); c.u32(); parsePsionCharacterLayout(c, line.character, false);
      if (type === 1) { c.u32(); yield hooks.embedded(c.u32()); c.u32(); c.u32(); }
    }
  }
  // The native parser warns and ignores excess inline records. Do not infer
  // payload lengths or parse records not assigned to a paragraph.
}
